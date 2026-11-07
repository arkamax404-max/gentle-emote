import { test } from "node:test";
import assert from "node:assert/strict";
import { ExternalDisplay, normalizeExternalDisplay } from "../src/external_display.ts";
import { encodePng, decodePng } from "../src/png.ts";
import { ITermRenderer } from "../src/render_iterm.ts";
import { KittyUnicodeRenderer } from "../src/render_kitty_unicode.ts";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const options = { enabled: true, url: "http://127.0.0.1:8000/emote", timeoutMs: 1000 };
const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) }).toString("base64");
const frame = (name = "idle.png") => ({ base64, state: "idle", frame: name, set: "gentleman" });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const renderer of [new ITermRenderer(10), new KittyUnicodeRenderer(10, false, 4)]) {
  test(`${renderer.constructor.name} preserves local output and mirrors all selection paths post-transform`, async () => {
    const originalWrite = process.stdout.write;
    (process.stdout as any).write = () => true;
    const selected: any[] = [];
    const requests: RequestInit[] = [];
    const sender = new ExternalDisplay(options, async (_url, init) => { requests.push(init!); return new Response(); });
    try {
      const dir = join(import.meta.dirname, "..", "emotes", "gentleman");
      renderer.setFrameSink(image => { selected.push(image); sender.select(image); });
      renderer.loadFrames(dir, dir, () => base64);
      assert.equal(renderer.showFrame("idle", "idle.png"), true);
      const local = renderer.getRenderedFrame(); assert.ok(local);
      renderer.resetCache(); renderer.showFrame("idle", "idle.png", true);
      process.stdout.write = originalWrite;
      await tick(); assert.equal(requests.length, 1, "forced redraw is not a visual change");
      (process.stdout as any).write = () => true;
      assert.equal(renderer.getRenderedFrame()?.kind, local.kind);
      renderer.showRandomFrame("think");
      renderer.showTalkFrame({ talk: { weights: { "talk_close.png": 1 } } });
      renderer.showTalkCloseFrame();
      renderer.showCycleFrame("read", 0);
      renderer.showFrame("verify", "fail.png", true);
      assert.deepEqual(selected.map(image => image.state), ["idle", "idle", "think", "talk", "talk", "read", "verify"]);
      assert.ok(selected.every(image => image.base64 === base64 && image.set === "gentleman"));
      assert.equal(selected.at(-1).frame, "fail.png");
      assert.equal(renderer.showFrame("idle", "missing.png"), false);
      renderer.setFrameSink(() => { throw Error("sink"); });
      assert.equal(renderer.showFrame("idle", "idle.png"), true, "sink exceptions cannot break local avatar");
      renderer.setFrameSink(null);
      renderer.loadFrames(dir, dir);
      renderer.showFrame("idle", "idle.png", true);
      assert.ok(renderer.getRenderedFrame(), "unmodified assets still render locally");
      assert.notEqual(readFileSync(join(dir, "idle", "idle.png")).toString("base64"), base64);
    } finally { sender.dispose(); renderer.dispose(); process.stdout.write = originalWrite; }
  });
}

test("disabled and invalid configuration make zero calls; timeout defaults and boundaries", () => {
  let calls = 0;
  for (const input of [undefined, null, {}, { ...options, enabled: false }, { ...options, enabled: "true" }, { ...options, url: "ftp://host" }, { ...options, url: "relative" }, { ...options, url: "http://user:pass@host" }, ...[NaN, Infinity, 0, -1, 30001, "1000"].map(timeoutMs => ({ ...options, timeoutMs }))]) {
    const sender = new ExternalDisplay(input, async () => { calls++; return new Response(); });
    sender.select(frame()); sender.dispose();
  }
  assert.equal(calls, 0);
  assert.deepEqual(normalizeExternalDisplay({ enabled: true, url: options.url }), options);
  for (const timeoutMs of [1, 30000]) assert.equal(normalizeExternalDisplay({ ...options, timeoutMs })?.timeoutMs, timeoutMs);
});

test("raw PNG protocol, image+metadata dedup, bounded latest pending, invalid IDs", async () => {
  const calls: RequestInit[] = [];
  const done: Array<() => void> = [];
  const reports: string[] = [];
  const sender = new ExternalDisplay(options, (url, init) => {
    assert.equal(String(url), options.url);
    calls.push(init!);
    return new Promise(resolve => done.push(() => resolve(new Response())));
  }, message => reports.push(message));
  sender.select(frame());
  sender.select(frame());
  sender.select(frame("middle.png"));
  sender.select(frame("latest.png"));
  assert.equal(calls.length, 1);
  const first = calls[0]!;
  assert.equal(first.method, "POST"); assert.equal(first.redirect, "error");
  const headers = new Headers(first.headers);
  assert.equal(headers.get("Content-Type"), "image/png");
  assert.equal(headers.get("X-Emote-Version"), "1");
  assert.equal(headers.get("X-Emote-State"), "idle");
  assert.equal(headers.get("X-Emote-Frame"), "idle.png");
  assert.equal(headers.get("X-Emote-Set"), "gentleman");
  assert.match(headers.get("X-Emote-Stream-Id")!, /^[0-9a-f-]{36}$/);
  assert.equal(headers.get("X-Emote-Sequence"), "1");
  assert.deepEqual([decodePng(Buffer.from(first.body as Uint8Array)).width, decodePng(Buffer.from(first.body as Uint8Array)).height], [64, 64]);
  done.shift()!(); await tick();
  assert.equal(calls.length, 2);
  assert.equal(new Headers(calls[1]!.headers).get("X-Emote-Frame"), "latest.png");
  assert.equal(new Headers(calls[1]!.headers).get("X-Emote-Sequence"), "2");
  for (const bad of ["../secret.png", "é.png", "x\r\ny", "x\n", "a".repeat(129)]) sender.select(frame(bad));
  assert.equal(reports.length, 5);
  done.shift()!(); await tick();
  sender.select(frame("latest.png")); assert.equal(calls.length, 2);
  sender.select({ ...frame("latest.png"), state: "think" }); assert.equal(calls.length, 3);
  sender.dispose(); done.shift()!(); await tick(); assert.equal(calls.length, 3);
});

test("dedup identity includes post-accent image and set, streams are per sender", async () => {
  const calls: RequestInit[] = [];
  const fetcher: typeof fetch = async (_url, init) => { calls.push(init!); return new Response(); };
  const sender = new ExternalDisplay(options, fetcher);
  const other = new ExternalDisplay(options, fetcher);
  try {
    sender.select(frame()); await tick();
    sender.select(frame()); await tick(); assert.equal(calls.length, 1);
    const recolored = { ...frame(), base64: encodePng({ width: 1, height: 1, data: new Uint8Array([0, 255, 0, 255]) }).toString("base64") };
    sender.select(recolored); await tick(); assert.equal(calls.length, 2);
    assert.notDeepEqual(calls[0]!.body, calls[1]!.body);
    sender.select({ ...recolored, set: "gentleman-yolo" }); await tick(); assert.equal(calls.length, 3);
    other.select(frame()); await tick();
    assert.notEqual(new Headers(calls[0]!.headers).get("X-Emote-Stream-Id"), new Headers(calls[3]!.headers).get("X-Emote-Stream-Id"));
    assert.equal(new Headers(calls[3]!.headers).get("X-Emote-Sequence"), "1");
  } finally { sender.dispose(); other.dispose(); }
});

test("failures never escape; timeout aborts; disposal aborts and drops pending", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: AbortSignal[] = [];
  const sender = new ExternalDisplay({ ...options, timeoutMs: 5 }, (_url, init) => {
    signals.push(init!.signal!);
    return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
  }, () => { throw new Error("broken logger"); });
  sender.select(frame()); sender.select(frame("next.png"));
  t.mock.timers.tick(5);
  await tick();
  assert.equal(signals.length, 2); assert.ok(signals[0]!.aborted);
  sender.select(frame("pending.png")); sender.dispose(); sender.dispose();
  assert.ok(signals[1]!.aborted);
  await tick(); sender.select(frame("after.png")); assert.equal(signals.length, 2);
  for (const fetcher of [() => { throw Error("sync"); }, async () => { throw Error("offline"); }, async () => new Response(null, { status: 500 })]) {
    const failing = new ExternalDisplay(options, fetcher);
    assert.doesNotThrow(() => failing.select(frame())); await tick(); failing.dispose();
  }
});
