import { randomUUID } from "node:crypto";
import type { ExternalDisplayConfig } from "./types.ts";
import { prepareDisplayImage } from "./display_image.ts";
import { log } from "./log.ts";

export interface SelectedImage { base64: string; state: string; frame: string; set: string }
export type FrameSink = (image: SelectedImage) => void;
export interface DisplayActivity {
  status: "idle" | "busy" | "error";
  phase: "idle" | "thinking" | "responding" | "executing" | "waiting" | "compacting";
  activeSubagents: number;
}
type Selection = SelectedImage & { activity: DisplayActivity };
const IDENTIFIER = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;

/** Invalid options disable networking, never local rendering. Credentials are not supported. */
export function normalizeExternalDisplay(value: unknown): ExternalDisplayConfig | null {
  if (!value || typeof value !== "object") return null;
  const { enabled, url, timeoutMs = 1000, background, backgroundCoverage, outline } = value as ExternalDisplayConfig;
  if (outline !== undefined && (typeof outline !== "string" || !/^#[0-9a-f]{6}$/i.test(outline))) return null;
  if (backgroundCoverage !== undefined && (typeof backgroundCoverage !== "number" || !Number.isFinite(backgroundCoverage) || backgroundCoverage < 0 || backgroundCoverage > 1)) return null;
  if (background !== undefined && (typeof background !== "string" || !/^#[0-9a-f]{6}$/i.test(background))) return null;
  if (enabled !== true || typeof url !== "string" || typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) return null;
    return { enabled: true, url: parsed.href, timeoutMs, ...(background === undefined ? {} : { background }), ...(backgroundCoverage === undefined ? {} : { backgroundCoverage }), ...(outline === undefined ? {} : { outline }) };
  } catch { return null; }
}

/** Independent queues, timeouts and caches per destination; legacy URL stays supported. */
export class ExternalDisplays {
  private displays: ExternalDisplay[] = [];

  constructor(options: unknown, fetcher: typeof fetch = fetch, report: (message: string) => void = () => {}) {
    if (!options || typeof options !== "object") return;
    const config = options as ExternalDisplayConfig;
    if (config.enabled !== true) return;
    if (config.targets === undefined) {
      this.displays = [new ExternalDisplay(options, fetcher, report)];
      return;
    }
    if (!Array.isArray(config.targets) || config.targets.length > 8) {
      try { report("externalDisplay: targets must be an array of at most 8 destinations; disabled"); } catch { /* diagnostic only */ }
      return;
    }
    this.displays = config.targets.map((target, index) => new ExternalDisplay(
      target && typeof target === "object" ? { timeoutMs: config.timeoutMs, background: config.background, backgroundCoverage: config.backgroundCoverage, outline: config.outline, ...target } : null,
      fetcher,
      message => report(`destination ${index + 1}: ${message}`),
    ));
  }

  get enabled(): boolean { return this.displays.some(display => display.enabled); }

  select(image: SelectedImage): void { for (const display of this.displays) display.select(image); }
  updateActivity(activity: DisplayActivity): void { for (const display of this.displays) display.updateActivity(activity); }
  dispose(): void { for (const display of this.displays) display.dispose(); this.displays = []; }
}

/** Latest-frame delivery: one active request, one replaceable pending selection. */
export class ExternalDisplay {
  private options: ExternalDisplayConfig | null;
  private streamId = randomUUID();
  private sequence = 0n;
  private disposed = false;
  private active: AbortController | null = null;
  private pending: Selection | null = null;
  private selected: SelectedImage | null = null;
  private activity: DisplayActivity = { status: "idle", phase: "idle", activeSubagents: 0 };
  private lastKey = "";
  // Independent of terminal caches; at most 32 prepared sprite/label combinations.
  private cache = new Map<string, Buffer>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  private fetcher: typeof fetch;
  private report: (message: string) => void;

  constructor(options: unknown, fetcher: typeof fetch = fetch, report: (message: string) => void = () => {}) {
    this.fetcher = fetcher;
    this.report = report;
    this.options = normalizeExternalDisplay(options);
    if (options && (options as ExternalDisplayConfig).enabled && !this.options) this.warn("externalDisplay: invalid configuration; disabled");
  }

  get enabled(): boolean { return !!this.options && !this.disposed; }

  private warn(message: string) { try { this.report(message); } catch { /* sink diagnostics cannot break UI */ } }

  private deliveryDiagnostic(message: string): void {
    try { log(message); } catch { /* diagnostics must not affect delivery or UI */ }
  }

  updateActivity(activity: DisplayActivity): void {
    if (!Number.isSafeInteger(activity.activeSubagents) || activity.activeSubagents < 0) return;
    this.activity = { ...activity };
    if (this.selected) this.select(this.selected);
  }

  select(image: SelectedImage): void {
    if (!this.options || this.disposed) return;
    try {
      if (![image.state, image.frame, image.set].every(value => IDENTIFIER.test(value))) {
        this.warn("externalDisplay: unsupported frame identifier; skipped"); return;
      }
      this.selected = { ...image };
      const key = JSON.stringify([image.base64, image.state, image.frame, image.set, this.activity]);
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.pending = { ...image, activity: { ...this.activity } };
      if (!this.active) void this.drain();
    } catch { this.warn("externalDisplay: selection failed"); }
  }

  private async drain(): Promise<void> {
    const image = this.pending;
    if (!image || !this.options || this.disposed) return;
    this.pending = null;
    const controller = new AbortController();
    this.active = controller;
    this.timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const cacheKey = JSON.stringify([image.base64, image.activity.status, image.activity.phase, image.activity.activeSubagents]);
      let body = this.cache.get(cacheKey);
      if (!body) {
        body = prepareDisplayImage(image.base64, image.activity, this.options.background, this.options.backgroundCoverage, this.options.outline);
        if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(cacheKey, body);
      }
      if (this.sequence >= 99999999999999999999n) throw new Error("sequence exhausted");
      const response = await this.fetcher(this.options.url, {
        method: "POST", redirect: "error", signal: controller.signal, body,
        headers: {
          "Content-Type": "image/png", "X-Emote-Version": "1",
          "X-Emote-State": image.state, "X-Emote-Frame": image.frame, "X-Emote-Set": image.set,
          "X-Emote-Status": image.activity.status, "X-Emote-Phase": image.activity.phase,
          "X-Emote-Active-Subagents": String(image.activity.activeSubagents),
          "X-Emote-Stream-Id": this.streamId, "X-Emote-Sequence": String(++this.sequence),
        },
      });
      // Do not retain or consume receiver content; release its connection/body.
      await response.body?.cancel();
      if (!response.ok) this.deliveryDiagnostic("externalDisplay: receiver rejected frame");
    } catch { if (!this.disposed) this.deliveryDiagnostic("externalDisplay: delivery failed or timed out"); }
    finally {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.active = null;
      if (!this.disposed && this.pending) void this.drain();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    this.selected = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active?.abort();
    this.cache.clear();
    this.lastKey = "";
  }
}
