import { randomUUID } from "node:crypto";
import type { ExternalDisplayConfig } from "./types.ts";
import { prepareDisplayImage } from "./display_image.ts";
import { IdleClock, IDLE_CLOCK_TICK_MS } from "./idle_clock.ts";
import { prepareIdleClockImage } from "./idle_clock_image.ts";
import { isWorkPhase } from "./work_phase.ts";
import { log } from "./log.ts";

export interface SelectedImage { base64: string; state: string; frame: string; set: string }
export type FrameSink = (image: SelectedImage) => void;
export interface DisplayActivity {
  status: "idle" | "busy" | "error";
  phase: "idle" | "thinking" | "responding" | "executing" | "waiting" | "compacting";
  activeSubagents: number;
  /** The host's detailed ODD work phase, when Gentle Shell published one. Optional: omitted when absent. */
  workPhase?: "authorizing" | "exploring" | "researching" | "deciding" | "planning" | "implementing" | "checking" | "closing";
}
type Selection = SelectedImage & { activity: DisplayActivity; clockAt?: number };
const IDENTIFIER = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;

/** Invalid options disable networking, never local rendering. Credentials are not supported. */
export function normalizeExternalDisplay(value: unknown): ExternalDisplayConfig | null {
  if (!value || typeof value !== "object") return null;
  const { enabled, url, timeoutMs = 1000, transparentBackground, background, backgroundCoverage, outline } = value as ExternalDisplayConfig;
  if (transparentBackground !== undefined && typeof transparentBackground !== "boolean") return null;
  if (outline !== undefined && (typeof outline !== "string" || !/^#[0-9a-f]{6}$/i.test(outline))) return null;
  if (backgroundCoverage !== undefined && (typeof backgroundCoverage !== "number" || !Number.isFinite(backgroundCoverage) || backgroundCoverage < 0 || backgroundCoverage > 1)) return null;
  if (background !== undefined && (typeof background !== "string" || !/^#[0-9a-f]{6}$/i.test(background))) return null;
  if (enabled !== true || typeof url !== "string" || typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) return null;
    return { enabled: true, url: parsed.href, timeoutMs, ...(transparentBackground === undefined ? {} : { transparentBackground }), ...(background === undefined ? {} : { background }), ...(backgroundCoverage === undefined ? {} : { backgroundCoverage }), ...(outline === undefined ? {} : { outline }) };
  } catch { return null; }
}

/** Match configured loopback destinations, never arbitrary LAN hosts or substrings. */
export function isLoopbackDisplayUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host);
  } catch { return false; }
}

/** Independent queues, timeouts and caches per destination; legacy URL stays supported. */
export class ExternalDisplays {
  private displays: ExternalDisplay[] = [];

  constructor(options: unknown, fetcher: typeof fetch = fetch, report: (message: string) => void = () => {}, sessionId: string | null = null) {
    if (!options || typeof options !== "object") return;
    const config = options as ExternalDisplayConfig;
    if (config.enabled !== true) return;
    if (config.targets === undefined) {
      this.displays = [new ExternalDisplay(options, fetcher, report, sessionId)];
      return;
    }
    if (!Array.isArray(config.targets) || config.targets.length > 8) {
      try { report("externalDisplay: targets must be an array of at most 8 destinations; disabled"); } catch { /* diagnostic only */ }
      return;
    }
    this.displays = config.targets.map((target, index) => new ExternalDisplay(
      target && typeof target === "object" ? { timeoutMs: config.timeoutMs, transparentBackground: config.transparentBackground, background: config.background, backgroundCoverage: config.backgroundCoverage, outline: config.outline, ...target } : null,
      fetcher,
      message => report(`destination ${index + 1}: ${message}`),
      sessionId,
    ));
  }

  get enabled(): boolean { return this.displays.some(display => display.enabled); }

  /** Pause only configured loopback destinations; never enables disabled config. */
  setDebugEnabled(enabled: boolean): number {
    let count = 0;
    for (const display of this.displays) {
      if (!display.local) continue;
      display.setPaused(!enabled);
      count++;
    }
    return count;
  }

  /** LED/ESP32 destinations are the configured non-loopback targets. */
  setDisplayEnabled(enabled: boolean): number {
    let count = 0;
    for (const display of this.displays) {
      if (!display.enabled || display.local) continue;
      display.setPaused(!enabled);
      count++;
    }
    return count;
  }

  select(image: SelectedImage): void { for (const display of this.displays) display.select(image); }
  updateActivity(activity: DisplayActivity): void { for (const display of this.displays) display.updateActivity(activity); }
  dispose(): void { for (const display of this.displays) display.dispose(); this.displays = []; }
}

/** Latest-frame delivery: one active request, one replaceable pending selection. */
export class ExternalDisplay {
  private options: ExternalDisplayConfig | null;
  private streamId = randomUUID();
  private sequence = 0n;
  // Capture identity for this sender lifetime: queued frames cannot change sessions.
  private readonly sessionId: string | null;
  private heartbeatUrl: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatPending = false;
  private hasFrame = false;
  private disposed = false;
  private paused = false;
  private active: AbortController | null = null;
  private pending: Selection | null = null;
  private selected: SelectedImage | null = null;
  private activity: DisplayActivity = { status: "idle", phase: "idle", activeSubagents: 0 };
  private lastKey = "";
  // Independent of terminal caches; at most 32 prepared avatar/clock images.
  private cache = new Map<string, Buffer>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private idleClock = new IdleClock(performance.now());
  private lastClockQueuedAt: number | null = null;

  private fetcher: typeof fetch;
  private report: (message: string) => void;

  constructor(options: unknown, fetcher: typeof fetch = fetch, report: (message: string) => void = () => {}, sessionId: string | null = null) {
    this.fetcher = fetcher;
    this.report = report;
    this.sessionId = typeof sessionId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(sessionId) ? sessionId : null;
    this.options = normalizeExternalDisplay(options);
    if (this.options) {
      this.clockTimer = setInterval(() => this.queueLatest(), IDLE_CLOCK_TICK_MS);
      this.clockTimer.unref?.();
      const url = new URL(this.options.url);
      if (this.sessionId && url.pathname === "/emote" && !url.search) {
        url.pathname = "/emote/heartbeat";
        this.heartbeatUrl = url.href;
        this.heartbeatTimer = setInterval(() => {
          if (this.disposed || this.paused || !this.hasFrame || !this.heartbeatUrl) return;
          this.heartbeatPending = true;
          if (!this.active) void this.drain();
        }, 5000);
        this.heartbeatTimer.unref?.();
      }
    }
    if (options && (options as ExternalDisplayConfig).enabled && !this.options) this.warn("externalDisplay: invalid configuration; disabled");
  }

  get enabled(): boolean { return !!this.options && !this.disposed; }

  get local(): boolean { return !!this.options && isLoopbackDisplayUrl(this.options.url); }

  setPaused(paused: boolean): void {
    if (this.disposed || paused === this.paused) return;
    this.paused = paused;
    this.lastKey = "";
    this.lastClockQueuedAt = null;
    if (paused) {
      this.pending = null;
      this.heartbeatPending = false;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.active?.abort();
    } else {
      this.queueLatest();
    }
  }

  private warn(message: string) { try { this.report(message); } catch { /* sink diagnostics cannot break UI */ } }

  private deliveryDiagnostic(message: string): void {
    try { log(message); } catch { /* diagnostics must not affect delivery or UI */ }
  }

  updateActivity(activity: DisplayActivity): void {
    if (!Number.isSafeInteger(activity.activeSubagents) || activity.activeSubagents < 0) return;
    // A present but invalid detail rejects the whole update; a valid or absent one is stored.
    if (activity.workPhase !== undefined && !isWorkPhase(activity.workPhase)) return;
    const { workPhase, ...rest } = activity;
    this.activity = rest as DisplayActivity;
    if (isWorkPhase(workPhase)) this.activity.workPhase = workPhase;
    this.idleClock.update(this.activity, performance.now(), this.selected?.state);
    this.queueLatest();
  }

  select(image: SelectedImage): void {
    if (!this.options || this.disposed) return;
    try {
      if (![image.state, image.frame, image.set].every(value => IDENTIFIER.test(value))) {
        this.warn("externalDisplay: unsupported frame identifier; skipped"); return;
      }
      this.selected = { ...image };
      this.idleClock.update(this.activity, performance.now(), image.state);
      this.queueLatest();
    } catch { this.warn("externalDisplay: selection failed"); }
  }

  /** Overlay only the external delivery; retain the avatar for activity/resume. */
  private queueLatest(): void {
    if (!this.options || this.disposed || this.paused) return;
    try {
      const now = performance.now();
      const ambient = this.idleClock.isActive(now);
      if (ambient && this.lastClockQueuedAt !== null && now - this.lastClockQueuedAt < IDLE_CLOCK_TICK_MS) return;
      if (!ambient) this.lastClockQueuedAt = null;
      const clockAt = ambient ? Math.floor(Date.now() / 1000) * 1000 : undefined;
      const image = ambient
        ? { base64: "", state: "clock", frame: "clock.png", set: "idle-clock" }
        : this.selected;
      if (!image) return;
      const key = JSON.stringify([image.base64, image.state, image.frame, image.set, this.activity, clockAt]);
      if (key === this.lastKey) return;
      this.lastKey = key;
      if (ambient) this.lastClockQueuedAt = now;
      this.pending = { ...image, activity: { ...this.activity }, ...(clockAt === undefined ? {} : { clockAt }) };
      if (!this.active) void this.drain();
    } catch { this.warn("externalDisplay: selection failed"); }
  }

  private async drain(): Promise<void> {
    const image = this.pending;
    if ((!image && !this.heartbeatPending) || !this.options || this.disposed || this.paused) return;
    const heartbeat = !image;
    this.pending = null;
    if (heartbeat) this.heartbeatPending = false;
    const controller = new AbortController();
    this.active = controller;
    this.timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      let body: Buffer | undefined;
      const headers: Record<string, string> = { "X-Emote-Version": "1", "X-Emote-Stream-Id": this.streamId };
      if (this.sessionId) headers["X-Emote-Session-Id"] = this.sessionId;
      if (image) {
        // Keep the same preparation and cache policy for legacy and session images.
        const cacheKey = image.clockAt === undefined
          ? JSON.stringify([image.base64, image.state, image.activity.status, image.activity.phase, image.activity.activeSubagents, image.activity.workPhase])
          : `idle-clock:${image.clockAt}`;
        body = this.cache.get(cacheKey);
        if (!body) {
          body = image.clockAt === undefined
            ? prepareDisplayImage(image.base64, { ...image.activity, state: image.state }, this.options.background, this.options.backgroundCoverage, this.options.outline, this.options.transparentBackground)
            : prepareIdleClockImage(image.clockAt, this.options.transparentBackground);
          if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(cacheKey, body);
        }
        Object.assign(headers, {
          "Content-Type": "image/png", "X-Emote-State": image.state,
          "X-Emote-Frame": image.frame, "X-Emote-Set": image.set,
          "X-Emote-Status": image.activity.status, "X-Emote-Phase": image.activity.phase,
          "X-Emote-Active-Subagents": String(image.activity.activeSubagents),
          ...(image.activity.workPhase === undefined ? {} : { "X-Emote-Work-Phase": image.activity.workPhase }),
        });
      }
      const limit = this.sessionId ? 18446744073709551615n : 99999999999999999999n;
      if (this.sequence >= limit) throw new Error("sequence exhausted");
      headers["X-Emote-Sequence"] = String(++this.sequence);
      if (image) this.hasFrame = true;
      const response = await this.fetcher(heartbeat ? this.heartbeatUrl! : this.options.url, {
        method: "POST", redirect: "error", signal: controller.signal, body, headers,
      });
      // Do not retain or consume receiver content; release its connection/body.
      await response.body?.cancel();
      // Older PNG receivers may not implement lifecycle routes. Probe only once.
      if (heartbeat && response.status === 404) this.heartbeatUrl = null;
      else if (!response.ok) this.deliveryDiagnostic("externalDisplay: receiver rejected frame");
    } catch { if (!this.disposed) this.deliveryDiagnostic("externalDisplay: delivery failed or timed out"); }
    finally {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.active = null;
      if (!this.disposed && (this.pending || this.heartbeatPending)) void this.drain();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatPending = false;
    this.pending = null;
    this.selected = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active?.abort();
    this.cache.clear();
    this.lastKey = "";
  }
}
