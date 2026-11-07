import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePng, decodePng } from "../src/png.ts";
import { prepareDisplayImage } from "../src/display_image.ts";

const pixel = (image: ReturnType<typeof decodePng>, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
test("64x64 opaque black canvas centers without enlargement and composites alpha", () => {
  const png = encodePng({ width: 2, height: 1, data: new Uint8Array([200, 100, 50, 128, 255, 0, 0, 0]) });
  const image = decodePng(prepareDisplayImage(png.toString("base64")));
  assert.deepEqual([image.width, image.height], [64, 64]);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    assert.deepEqual(pixel(image, x, y), x === 31 && y === 31 ? [100, 50, 25, 255] : [0, 0, 0, 255]);
  }
});
test("oversize downscales proportionally with nearest-neighbor", () => {
  const data = new Uint8Array(128 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) data.set([x, y, 30, 255], (y * 128 + x) * 4);
  const image = decodePng(prepareDisplayImage(encodePng({ width: 128, height: 64, data }).toString("base64")));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) assert.deepEqual(pixel(image, x, y), y >= 16 && y < 48 ? [x * 2, (y - 16) * 2, 30, 255] : [0, 0, 0, 255]);
});
