import { decodePng, encodePng } from "./png.ts";

/** Raw post-accent sprite, not the terminal border; opaque black LED canvas. */
export function prepareDisplayImage(base64: string): Buffer {
  const source = decodePng(Buffer.from(base64, "base64"));
  if (source.width < 1 || source.height < 1) throw new Error("empty display image");
  const scale = Math.min(1, 64 / source.width, 64 / source.height);
  const width = Math.max(1, Math.floor(source.width * scale));
  const height = Math.max(1, Math.floor(source.height * scale));
  const left = Math.floor((64 - width) / 2), top = Math.floor((64 - height) / 2);
  const data = new Uint8Array(64 * 64 * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (Math.floor(y * source.height / height) * source.width + Math.floor(x * source.width / width)) * 4;
    const dst = ((top + y) * 64 + left + x) * 4;
    for (let c = 0; c < 3; c++) data[dst + c] = Math.round(source.data[src + c]! * source.data[src + 3]! / 255);
  }
  return encodePng({ width: 64, height: 64, data });
}
