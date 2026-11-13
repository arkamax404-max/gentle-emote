import { encodePng } from "./png.ts";

const GLYPHS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "/": ["001", "001", "010", "100", "100"], ":": ["000", "010", "000", "010", "000"],
};
const INK = { white: [242, 241, 220], muted: [147, 181, 160], blue: [85, 189, 232],
  green: [184, 243, 91], skin: [244, 195, 140], amber: [241, 189, 101], path: [41, 75, 54] };

/** Selected bottom-promenade design: native pixels, local DD/MM/YYYY and 24h time. */
export function prepareIdleClockImage(nowMs: number, transparentBackground = false): Buffer {
  const now = new Date(nowMs);
  if (!Number.isFinite(now.getTime())) throw new Error("invalid idle clock time");
  const data = new Uint8Array(64 * 64 * 4);
  if (!transparentBackground) for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const rect = (left: number, top: number, width: number, height: number, ink: number[]) => {
    for (let y = Math.max(0, top); y < Math.min(64, top + height); y++) {
      for (let x = Math.max(0, left); x < Math.min(64, left + width); x++) {
        data.set([ink[0]!, ink[1]!, ink[2]!, 255], (y * 64 + x) * 4);
      }
    }
  };
  const text = (value: string, left: number, top: number, scale: number, ink: number[]) => {
    for (let i = 0; i < value.length; i++) {
      const glyph = GLYPHS[value[i]!];
      if (!glyph) continue;
      for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
        if (glyph[y]![x] === "1") rect(left + (i * 4 + x) * scale, top + y * scale, scale, scale, ink);
      }
    }
  };
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear()).padStart(4, "0")}`;
  text(date, Math.floor((64 - (date.length * 4 - 1)) / 2), 1, 1, INK.muted);
  text(pad(now.getHours()), 12, 9, 4, INK.white);
  text(pad(now.getMinutes()), 12, 31, 4, INK.blue);
  text(":", 43, 35, 1, INK.amber);
  text(pad(now.getSeconds()), 46, 33, 2, INK.amber);
  rect(0, 63, 64, 1, INK.path);
  for (let x = 0; x < 64; x += 8) rect(x, 63, 3, 1, INK.green);
  const step = Math.floor(nowMs / 1000);
  const rows = [" GGG ", "GGSS ", "  SS ", " BBB ", " BBB ", "  B  ",
    step % 2 ? " W W " : "  WW ", step % 2 ? "W   W" : " W W "];
  const colors: Record<string, number[]> = { G: INK.green, S: INK.skin, B: INK.blue, W: INK.white };
  for (const offset of [0, 40]) {
    const left = ((step * 2 + offset) % 80 + 80) % 80 - 8;
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y]!.length; x++) {
      const ink = colors[rows[y]![x]!];
      if (ink) rect(left + x + 1, 55 + y, 1, 1, ink);
    }
  }
  return encodePng({ width: 64, height: 64, data });
}
