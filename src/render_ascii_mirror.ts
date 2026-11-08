import { join } from "node:path";
import { AsciiRenderer } from "./render_ascii.ts";
import { BaseImageRenderer } from "./render_image.ts";
import { EMOTE_STATES } from "./types.ts";
import type { EmoteState, EmotesConfig, FrameTransform } from "./types.ts";
import type { FrameSink } from "./external_display.ts";

/** Reuses PNG selection without encoding, writing or repainting terminal images. */
class ImageFrameSelector extends BaseImageRenderer {
  protected cursorAdvances = false;
  constructor() { super(1); }
  protected encode(): null { return null; }
  protected show(): boolean { return true; }
  dispose() { this.frameMap.clear(); this.setFrameSink(null); this.resetCache(); }
}

/** PNG animation drives the external display; the terminal remains text-only. */
export class MirroredAsciiRenderer extends AsciiRenderer {
  private images = new ImageFrameSelector();
  private mirroring = false;

  setFrameSink(sink: FrameSink | null) {
    this.mirroring = sink !== null;
    if (!sink) this.images.dispose();
    this.images.setFrameSink(sink);
  }

  loadFrames(setDir: string, extDir: string, transform?: FrameTransform) {
    super.loadFrames(setDir, extDir);
    if (!this.mirroring) return;
    this.images.loadFrames(setDir, extDir, transform);
    // An explicitly text-only set still has a graphical external companion.
    if (!this.hasImages()) this.images.loadFrames(join(extDir, "emotes", "gentleman"), extDir, transform);
  }

  private hasImages(): boolean {
    return EMOTE_STATES.some(state => this.images.getFrameFiles(state).length > 0);
  }

  private localFallback(state: EmoteState): boolean {
    if (super.getFrameFiles(state).length) return super.showRandomFrame(state);
    const rest = ["grandma", "bye", "yolo", "super-yolo"].includes(state);
    return super.showRandomFrame(rest ? "idle" : "tool");
  }

  getFrameFiles(state: EmoteState): string[] {
    const files = this.images.getFrameFiles(state);
    return files.length ? files : super.getFrameFiles(state);
  }

  getCycleFrameCount(state: EmoteState): number {
    return this.images.getCycleFrameCount(state) || super.getCycleFrameCount(state);
  }

  showFrame(state: EmoteState, name: string, force = false): boolean {
    const image = this.images.showFrame(state, name, force);
    const text = super.showFrame(state, name, force);
    if (image && !text) this.localFallback(name === "fail.png" ? "failure" : state);
    return image || text;
  }

  showRandomFrame(state: EmoteState, force = false): boolean {
    const image = this.images.showRandomFrame(state, force);
    const text = super.showRandomFrame(state, force);
    if (image && !text) this.localFallback(state);
    return image || text;
  }

  showCycleFrame(state: EmoteState, index: number): boolean {
    const image = this.images.showCycleFrame(state, index);
    const text = super.showCycleFrame(state, index);
    if (image && !text) this.localFallback(state);
    return image || text;
  }

  showTalkFrame(config: EmotesConfig): boolean {
    const image = this.images.showTalkFrame(config);
    const text = super.showTalkFrame(config);
    return image || text;
  }

  showTalkCloseFrame(): boolean {
    const image = this.images.showTalkCloseFrame();
    const text = super.showTalkCloseFrame();
    return image || text;
  }

  resetCache() { super.resetCache(); this.images.resetCache(); }
  dispose() { super.dispose(); this.images.dispose(); this.mirroring = false; }
}
