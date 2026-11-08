import type { EmoteState, EmotesConfig, FrameTransform } from "./types.ts";
import type { TUI } from "@earendil-works/pi-tui";

/**
 * A rendered frame — either an image sequence (Kitty/iTerm2) or plain text lines.
 *
 * For image frames:
 * - `cursorAdvances`: whether the terminal cursor moves past the image after rendering.
 *   Kitty with moveCursor=false does NOT advance; iTerm2 always advances.
 *   The widget uses this to decide whether to add padding after the image sequence.
 */
export type RenderedFrame =
  | { kind: "image"; sequence: string; rows: number; cursorAdvances: boolean; padMode?: "spaces" | "skip" }
  | { kind: "text"; lines: string[] }
  | { kind: "placeholder"; lines: string[]; rows: number; cols: number; framed: boolean };

/**
 * Renderer interface — abstracts how emote frames are loaded, stored, and displayed.
 *
 * Implementations:
 * - ImageRenderer (render_image.ts): Kitty/iTerm2 image protocols
 * - AsciiRenderer (render_ascii.ts): plain text fallback
 * - MirroredAsciiRenderer (render_ascii_mirror.ts): local ASCII + PNG selections for POST
 */
export interface Renderer {
  /** Observe selected post-accent sprites independently of terminal repaint caching. */
  setFrameSink?(sink: import("./external_display.ts").FrameSink | null): void;
  /** Set the TUI reference for requesting re-renders. */
  setTui(tui: TUI | null): void;

  /** Load frames for an emote set, optionally rewriting each PNG (accent recolor). */
  loadFrames(emoteSetDir: string, extDir: string, transform?: FrameTransform): void;

  /** Sorted frame file names for a state (empty when the state has no frames). */
  getFrameFiles(state: EmoteState): string[];

  /** Get the current rendered frame (for the widget to read). */
  getRenderedFrame(): RenderedFrame | null;

  /** Show a specific named frame for a state. Returns false if not found. */
  showFrame(state: EmoteState, name: string, force?: boolean): boolean;

  /** Show a random frame for a state. Returns false if no frames. */
  showRandomFrame(state: EmoteState, force?: boolean): boolean;

  /** Show a weighted-random talk frame using emotes config. */
  showTalkFrame(emotesConfig: EmotesConfig): boolean;

  /** Show the talk close/rest frame. */
  showTalkCloseFrame(): boolean;

  /** Show a cycling frame for a state (read/write/tool). */
  showCycleFrame(state: EmoteState, index: number): boolean;

  /** Get number of cycle frames for a state. */
  getCycleFrameCount(state: EmoteState): number;

  /** Clean up resources (delete images, etc). */
  dispose(): void;

  /** Reset cached state so next show is forced. */
  resetCache(): void;
}
