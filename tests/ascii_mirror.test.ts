import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { MirroredAsciiRenderer } from "../src/render_ascii_mirror.ts";
import { AsciiRenderer } from "../src/render_ascii.ts";
import { encodePng } from "../src/png.ts";
import type { SelectedImage } from "../src/external_display.ts";

const root = join(import.meta.dirname, "..");
const dir = join(root, "emotes", "gentleman");

test("ASCII terminal selects transformed PNG frames for every external animation path without graphics output", () => {
  const renderer = new MirroredAsciiRenderer();
  const selected: SelectedImage[] = [];
  const transformed = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 255, 0, 255]) }).toString("base64");
  let repaints = 0;
  renderer.setTui({ requestRender() { repaints++; } } as any);
  renderer.setFrameSink(image => selected.push(image));
  renderer.loadFrames(dir, root, () => transformed);
  try {
    assert.ok(renderer.getFrameFiles("idle").includes("idle.png"));
    assert.equal(renderer.showFrame("idle", "idle.png"), true);
    assert.equal(renderer.showRandomFrame("think"), true);
    assert.equal(renderer.showCycleFrame("read", 1), true);
    assert.equal(renderer.showTalkFrame({}), true);
    assert.equal(renderer.showTalkCloseFrame(), true);
    assert.equal(renderer.showFrame("verify", "fail.png"), true);
    assert.equal(renderer.showCycleFrame("ask", 0), true);
    assert.equal(renderer.showCycleFrame("super-yolo", 0), true);
    assert.deepEqual(selected.map(image => image.state), ["idle", "think", "read", "talk", "talk", "verify", "ask", "super-yolo"]);
    assert.ok(selected.every(image => image.base64 === transformed && image.set === "gentleman"));
    assert.equal(renderer.getRenderedFrame()?.kind, "text");
    assert.ok(repaints > 0);
    const count = selected.length;
    assert.equal(renderer.showFrame("verify", "missing.png"), false);
    assert.equal(selected.length, count);
    renderer.setFrameSink(() => { throw Error("receiver failed"); });
    assert.equal(renderer.showFrame("idle", "idle.png"), true);
    assert.equal(renderer.getRenderedFrame()?.kind, "text");
    renderer.setFrameSink(null);
    renderer.loadFrames(dir, root);
    renderer.showCycleFrame("read", 0);
    assert.equal(selected.length, count);
    assert.ok(!renderer.getFrameFiles("idle").includes("idle.png"));
  } finally { renderer.dispose(); }
});

test("text-only sets use the shipped PNG companion and local ASCII selection stays unchanged when disabled", () => {
  const asciiDir = join(root, "emotes", "ascii-bot");
  const renderer = new MirroredAsciiRenderer();
  const plain = new AsciiRenderer();
  const selected: SelectedImage[] = [];
  try {
    renderer.loadFrames(asciiDir, root);
    plain.loadFrames(asciiDir, root);
    assert.deepEqual(renderer.getFrameFiles("idle"), plain.getFrameFiles("idle"));
    renderer.showFrame("idle", "default"); plain.showFrame("idle", "default");
    assert.deepEqual(renderer.getRenderedFrame(), plain.getRenderedFrame());
    renderer.setFrameSink(image => selected.push(image));
    renderer.loadFrames(asciiDir, root);
    renderer.showFrame("idle", "idle.png");
    assert.equal(selected.length, 1);
    assert.equal(selected[0]!.set, "gentleman");
    assert.equal(renderer.getRenderedFrame()?.kind, "text");
    renderer.dispose();
    renderer.showCycleFrame("read", 0);
    assert.equal(selected.length, 1, "disposal detaches the PNG sink");
  } finally { renderer.dispose(); plain.dispose(); }
});
