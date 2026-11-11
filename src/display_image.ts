import { decodePng, encodePng } from "./png.ts";
import { drawDisplayOutline } from "./display_outline.ts";
import { drawDisplayText } from "./display_text.ts";
import { isWorkPhase } from "./work_phase.ts";
import { EMOTE_STATES } from "./types.ts";
import type { DisplayActivity } from "./external_display.ts";

// Display copy only: frame identifiers, commands and metadata keep their names.
const actionLabels = new Map<string, string>([
  ["think", "thinking"], ["talk", "talking"], ["read", "reading"],
  ["write", "writing"], ["compact", "compacting"], ["ask", "asking"],
  ["delegate", "delegating"], ["remember", "remembering"],
  ["explore", "exploring"], ["build", "building"], ["verify", "verifying"],
  ["judge", "judging"], ["review", "reviewing"],
]);

/** Raw post-accent sprite, not the terminal border; composite onto an opaque LED canvas. */
export function prepareDisplayImage(base64: string, activity?: Pick<DisplayActivity, "status" | "phase"> & Partial<Pick<DisplayActivity, "activeSubagents" | "workPhase"> & { state?: string }>, background = "#000000", backgroundCoverage = 1, outline?: string): Buffer {
  if (outline !== undefined && !/^#[0-9a-f]{6}$/i.test(outline)) throw new Error("invalid display outline");
  if (!Number.isFinite(backgroundCoverage) || backgroundCoverage < 0 || backgroundCoverage > 1) throw new Error("invalid background coverage");
  if (!/^#[0-9a-f]{6}$/i.test(background)) throw new Error("invalid display background");
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const rgb = [1, 3, 5].map(offset => parseInt(background.slice(offset, offset + 2), 16));
  const source = decodePng(Buffer.from(base64, "base64"));
  if (source.width < 1 || source.height < 1) throw new Error("empty display image");
  const scale = Math.min(1, 48 / source.width, 40 / source.height);
  const width = Math.max(1, Math.floor(source.width * scale));
  const height = Math.max(1, Math.floor(source.height * scale));
  const left = Math.floor((64 - width) / 2), top = Math.floor((40 - height) / 2);
  const data = new Uint8Array(64 * 64 * 4);
  const occupied = outline ? new Uint8Array(64 * 41) : null;
  // Native sprites are opaque with black backdrops. Custom alpha sprites retain
  // opaque black artwork in their mask; opaque sprites use black as the matte.
  const hasTransparency = !!outline && source.data.some((value, index) => index % 4 === 3 && value < 255);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  // Apply the configured background only inside the source PNG's drawn bounds.
  // Outer padding and the label area remain black.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (Math.floor(y * source.height / height) * source.width + Math.floor(x * source.width / width)) * 4;
    const dst = ((top + y) * 64 + left + x) * 4;
    const alpha = source.data[src + 3]! / 255;
    if (occupied && alpha > 0 && (hasTransparency || source.data[src] || source.data[src + 1] || source.data[src + 2])) occupied[dst / 4] = 1;
    // A fixed, canvas-anchored pattern: no frame-to-frame brightness switching.
    const covered = bayer[((top + y) % 4) * 4 + (left + x) % 4]! < Math.round(backgroundCoverage * 16);
    for (let c = 0; c < 3; c++) data[dst + c] = Math.round(source.data[src + c]! * alpha + (covered ? rgb[c]! : 0) * (1 - alpha));
  }
  if (occupied && outline) drawDisplayOutline(data, occupied, [1, 3, 5].map(offset => parseInt(outline.slice(offset, offset + 2), 16)));
  if (activity) {
    const color = activity.status === "error" ? [255, 96, 96] : activity.status === "busy" ? [255, 208, 96] : [128, 224, 160];
    const count = activity.activeSubagents ?? 0;
    // Both coarse labels idle while subagents run: show SUBAGENTS / RUNNING
    // on the display only, without changing the underlying activity.
    const running = activity.status === "idle" && activity.phase === "idle" && count > 0;
    const statusLabel = running ? "SUBAGENTS" : activity.status === "error" && activity.phase === "idle" ? "IDLE" : activity.status;
    const label = `${statusLabel} (${count > 999 ? "999+" : count})`;
    drawDisplayText(data, label, 44, index => index > statusLabel.length ? [255, 255, 0] : color);
    // Use the selected frame's registered demo name under any coarse/host phase.
    // Without a registered selection, retain the host detail fallback only for
    // thinking/executing; RUNNING still takes precedence over every selected state.
    const coarse = activity.phase;
    const detailed = activity.state !== undefined && (EMOTE_STATES as readonly string[]).includes(activity.state)
      ? activity.state
      : isWorkPhase(activity.workPhase) && (coarse === "thinking" || coarse === "executing")
        ? activity.workPhase
        : coarse;
    drawDisplayText(data, running ? "RUNNING" : (actionLabels.get(detailed) ?? detailed), 54, [224, 224, 224]);
  }
  return encodePng({ width: 64, height: 64, data });
}
