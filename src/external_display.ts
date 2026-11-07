import { randomUUID } from "node:crypto";
import type { ExternalDisplayConfig } from "./types.ts";
import { prepareDisplayImage } from "./display_image.ts";

export interface SelectedImage { base64: string; state: string; frame: string; set: string }
export type FrameSink = (image: SelectedImage) => void;
const IDENTIFIER = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;

/** Invalid options disable networking, never local rendering. Credentials are not supported. */
export function normalizeExternalDisplay(value: unknown): ExternalDisplayConfig | null {
  if (!value || typeof value !== "object") return null;
  const { enabled, url, timeoutMs = 1000 } = value as ExternalDisplayConfig;
  if (enabled !== true || typeof url !== "string" || typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) return null;
    return { enabled: true, url: parsed.href, timeoutMs };
  } catch { return null; }
}

/** Latest-frame delivery: one active request, one replaceable pending selection. */
export class ExternalDisplay {
  private options: ExternalDisplayConfig | null;
  private streamId = randomUUID();
  private sequence = 0n;
  private disposed = false;
  private active: AbortController | null = null;
  private pending: SelectedImage | null = null;
  private lastKey = "";
  // Independent of terminal caches; at most 32 post-accent sprites.
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

  private warn(message: string) { try { this.report(message); } catch { /* sink diagnostics cannot break UI */ } }

  select(image: SelectedImage): void {
    if (!this.options || this.disposed) return;
    try {
      if (![image.state, image.frame, image.set].every(value => IDENTIFIER.test(value))) {
        this.warn("externalDisplay: unsupported frame identifier; skipped"); return;
      }
      const key = JSON.stringify([image.base64, image.state, image.frame, image.set]);
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.pending = { ...image };
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
      let body = this.cache.get(image.base64);
      if (!body) {
        body = prepareDisplayImage(image.base64);
        if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(image.base64, body);
      }
      if (this.sequence >= 99999999999999999999n) throw new Error("sequence exhausted");
      const response = await this.fetcher(this.options.url, {
        method: "POST", redirect: "error", signal: controller.signal, body,
        headers: {
          "Content-Type": "image/png", "X-Emote-Version": "1",
          "X-Emote-State": image.state, "X-Emote-Frame": image.frame, "X-Emote-Set": image.set,
          "X-Emote-Stream-Id": this.streamId, "X-Emote-Sequence": String(++this.sequence),
        },
      });
      // Do not retain or consume receiver content; release its connection/body.
      await response.body?.cancel();
      if (!response.ok) this.warn("externalDisplay: receiver rejected frame");
    } catch { if (!this.disposed) this.warn("externalDisplay: delivery failed or timed out"); }
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active?.abort();
    this.cache.clear();
    this.lastKey = "";
  }
}
