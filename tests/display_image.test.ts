import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePng, decodePng } from "../src/png.ts";
import { prepareDisplayImage } from "../src/display_image.ts";

const pixel = (image: ReturnType<typeof decodePng>, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
test("64x64 opaque canvas centers in a 48x40 top viewport and composites alpha", () => {
  const png = encodePng({ width: 2, height: 1, data: new Uint8Array([200, 100, 50, 128, 255, 0, 0, 0]) });
  const image = decodePng(prepareDisplayImage(png.toString("base64")));
  assert.deepEqual([image.width, image.height], [64, 64]);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    assert.deepEqual(pixel(image, x, y), x === 31 && y === 19 ? [100, 50, 25, 255] : [0, 0, 0, 255]);
  }
});
test("status and phase fit below the untouched avatar for every activity", () => {
  const data = new Uint8Array(48 * 40 * 4).fill(255);
  const base64 = encodePng({ width: 48, height: 40, data }).toString("base64");
  const plain = decodePng(prepareDisplayImage(base64));
  for (const status of ["idle", "busy", "error"] as const) {
    for (const phase of ["idle", "thinking", "responding", "executing", "waiting", "compacting"] as const) {
      const image = decodePng(prepareDisplayImage(base64, { status, phase }));
      assert.deepEqual([image.width, image.height], [64, 64]);
      assert.deepEqual(image.data.slice(0, 40 * 64 * 4), plain.data.slice(0, 40 * 64 * 4));
      for (const top of [44, 54]) {
        let lit = 0;
        for (let y = top; y < top + 5; y++) for (let x = 0; x < 64; x++) {
          if (pixel(image, x, y).slice(0, 3).some(channel => channel > 0)) lit++;
        }
        assert.ok(lit > 0, `${status}/${phase} has text at row ${top}`);
      }
      for (let y = 59; y < 64; y++) for (let x = 0; x < 64; x++) {
        assert.deepEqual(pixel(image, x, y), [0, 0, 0, 255]);
      }
    }
  }
  assert.notDeepEqual(
    prepareDisplayImage(base64, { status: "busy", phase: "thinking" }),
    prepareDisplayImage(base64, { status: "busy", phase: "executing" }),
  );
});

test("agent count and parentheses are yellow while status retains its color", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }).toString("base64");
  for (const [status, color] of [["idle", [128, 224, 160]], ["busy", [255, 208, 96]], ["error", [255, 96, 96]]] as const) {
    const image = decodePng(prepareDisplayImage(base64, { status, phase: "idle", activeSubagents: 2 }));
    const left = Math.floor((64 - ((status.length + 4) * 4 - 1)) / 2);
    let yellow = 0;
    for (let y = 44; y < 49; y++) for (let x = 0; x < 64; x++) {
      const rgba = pixel(image, x, y);
      if (!rgba.slice(0, 3).some(value => value > 0)) continue;
      if (x >= left + (status.length + 1) * 4) {
        assert.deepEqual(rgba, [255, 255, 0, 255]);
        yellow++;
      } else assert.deepEqual(rgba, [...color, 255]);
    }
    assert.ok(yellow > 0);
  }
});

test("agent count changes only the status row and large counts stay bounded", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) }).toString("base64");
  const render = (activeSubagents: number) => decodePng(prepareDisplayImage(base64, { status: "busy", phase: "executing", activeSubagents }));
  const zero = render(0);
  for (const count of [1, 2, 9, 10, 123, 999, 1000, Number.MAX_SAFE_INTEGER]) {
    const image = render(count);
    assert.deepEqual(image.data.slice(0, 44 * 64 * 4), zero.data.slice(0, 44 * 64 * 4));
    assert.notDeepEqual(image.data.slice(44 * 64 * 4, 49 * 64 * 4), zero.data.slice(44 * 64 * 4, 49 * 64 * 4));
    assert.deepEqual(image.data.slice(49 * 64 * 4), zero.data.slice(49 * 64 * 4));
  }
  assert.deepEqual(render(1000), render(Number.MAX_SAFE_INTEGER));
});

test("custom background composites transparency but preserves opaque black artwork", () => {
  const png = encodePng({ width: 3, height: 1, data: new Uint8Array([
    200, 100, 50, 128, 255, 0, 0, 0, 0, 0, 0, 255,
  ]) });
  const image = decodePng(prepareDisplayImage(png.toString("base64"), undefined, "#404040"));
  assert.deepEqual(pixel(image, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 29, 19), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 33, 19), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 31, 40), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 31, 63), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 30, 19), [132, 82, 57, 255]);
  assert.deepEqual(pixel(image, 31, 19), [64, 64, 64, 255]);
  assert.deepEqual(pixel(image, 32, 19), [0, 0, 0, 255]);
  assert.throws(() => prepareDisplayImage(png.toString("base64"), undefined, "gray"));
});

test("static background coverage dims only transparent sprite pixels without temporal changes", () => {
  const base64 = encodePng({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) }).toString("base64");
  const body = prepareDisplayImage(base64, undefined, "#383838", 0.75);
  const image = decodePng(body);
  let gray = 0;
  for (let y = 16; y < 24; y++) for (let x = 28; x < 36; x++) {
    const rgba = pixel(image, x, y);
    if (rgba[0] === 56) { gray++; assert.deepEqual(rgba, [56, 56, 56, 255]); }
    else assert.deepEqual(rgba, [0, 0, 0, 255]);
  }
  assert.equal(gray, 48);
  assert.deepEqual(body, prepareDisplayImage(base64, undefined, "#383838", 0.75));
  const opaque = encodePng({ width: 1, height: 1, data: new Uint8Array([120, 80, 40, 255]) }).toString("base64");
  assert.deepEqual(prepareDisplayImage(opaque, undefined, "#383838", 0.75), prepareDisplayImage(opaque, undefined, "#383838", 1));
  assert.throws(() => prepareDisplayImage(base64, undefined, "#383838", -1));
});

test("white outline follows the external silhouette without filling holes or touching labels", () => {
  const data = new Uint8Array(5 * 5 * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
    if (x !== 2 || y !== 2) data.set([200, 80, 40, 255], (y * 5 + x) * 4);
  }
  const base64 = encodePng({ width: 5, height: 5, data }).toString("base64");
  const activity = { status: "busy", phase: "thinking", activeSubagents: 0 } as const;
  const plain = decodePng(prepareDisplayImage(base64, activity));
  const outlined = decodePng(prepareDisplayImage(base64, activity, "#000000", 1, "#ffffff"));
  assert.deepEqual(pixel(outlined, 31, 19), [0, 0, 0, 255], "enclosed hole stays black");
  assert.deepEqual(pixel(outlined, 30, 18), [200, 80, 40, 255], "artwork stays intact");
  assert.deepEqual(pixel(outlined, 29, 17), [255, 255, 255, 255]);
  assert.deepEqual(pixel(outlined, 33, 21), [255, 255, 255, 255]);
  assert.deepEqual(pixel(outlined, 28, 17), [0, 0, 0, 255], "outline is only one pixel");
  assert.deepEqual(outlined.data.slice(41 * 64 * 4), plain.data.slice(41 * 64 * 4));
});

test("alpha silhouettes preserve opaque black artwork and outline only the sprite", () => {
  const data = new Uint8Array(3 * 3 * 4);
  data.set([0, 0, 0, 255], (1 * 3 + 1) * 4);
  const base64 = encodePng({ width: 3, height: 3, data }).toString("base64");
  const image = decodePng(prepareDisplayImage(base64, undefined, "#000000", 1, "#ffffff"));
  assert.deepEqual(pixel(image, 31, 19), [0, 0, 0, 255]);
  for (let y = 18; y <= 20; y++) for (let x = 30; x <= 32; x++) {
    if (x !== 31 || y !== 19) assert.deepEqual(pixel(image, x, y), [255, 255, 255, 255]);
  }
  assert.throws(() => prepareDisplayImage(base64, undefined, "#000000", 1, "white"));
});

test("oversize downscales proportionally with nearest-neighbor", () => {
  const data = new Uint8Array(128 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) data.set([x, y, 30, 255], (y * 128 + x) * 4);
  const image = decodePng(prepareDisplayImage(encodePng({ width: 128, height: 64, data }).toString("base64")));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) assert.deepEqual(pixel(image, x, y), x >= 8 && x < 56 && y >= 8 && y < 32 ? [Math.floor((x - 8) * 128 / 48), Math.floor((y - 8) * 64 / 24), 30, 255] : [0, 0, 0, 255]);
});
