import { test } from "node:test";
import assert from "node:assert/strict";
import { ExternalDisplay, ExternalDisplays, normalizeExternalDisplay, isLoopbackDisplayUrl } from "../src/external_display.ts";
import { encodePng, decodePng } from "../src/png.ts";
import { drawDisplayText } from "../src/display_text.ts";
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

test("multiple destinations deliver independently when one is stalled or fails", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let release: (() => void) | undefined;
  const sender = new ExternalDisplays({ enabled: true, timeoutMs: 1000, targets: [
    { enabled: true, url: "http://localhost:8000/emote" },
    { enabled: true, url: "http://gentle-matrix.local/emote", timeoutMs: 500 },
    { enabled: false, url: "http://disabled/emote" },
  ] }, async (url, init) => {
    calls.push({ url: String(url), init: init! });
    if (String(url).includes("localhost")) return new Promise(resolve => { release = () => resolve(new Response()); });
    return new Response(null, { status: 503 });
  });
  try {
    sender.select(frame()); await tick();
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 2 }); await tick();
    assert.equal(calls.filter(call => call.url.includes("localhost")).length, 1);
    const device = calls.filter(call => call.url.includes("gentle-matrix"));
    assert.equal(device.length, 2, "device keeps delivering while simulator is stalled");
    assert.equal(new Headers(device[1]!.init.headers).get("X-Emote-Active-Subagents"), "2");
    assert.ok(calls.every(call => !call.url.includes("disabled")));
    sender.dispose();
    assert.ok(calls.every(call => call.init.signal!.aborted || call.url.includes("gentle-matrix")));
    release?.(); await tick();
    sender.select(frame("after.png")); assert.equal(calls.length, 3);
  } finally { sender.dispose(); release?.(); }
});

test("multi-destination configuration preserves legacy and safely disables invalid targets", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url) => { calls.push(String(url)); return new Response(); };
  for (const input of [
    { ...options, enabled: false, targets: [{ ...options }] },
    { ...options, targets: [] },
    { ...options, targets: "invalid" },
    { ...options, targets: Array(9).fill(options) },
  ]) {
    const group = new ExternalDisplays(input, fetcher);
    group.select(frame()); await tick(); group.dispose();
  }
  assert.deepEqual(calls, []);
  const group = new ExternalDisplays(options, fetcher);
  group.select(frame()); await tick(); group.dispose();
  assert.deepEqual(calls, [options.url]);
});

test("background inherits per target, overrides independently, and rejects invalid colors", async () => {
  for (const background of [null, 123, "gray", "#fff", "#000000\r\n"]) {
    assert.equal(normalizeExternalDisplay({ ...options, background }), null);
  }
  for (const backgroundCoverage of [NaN, Infinity, -1, 1.1, "0.75", null]) {
    assert.equal(normalizeExternalDisplay({ ...options, backgroundCoverage }), null);
  }
  const calls: RequestInit[] = [];
  const group = new ExternalDisplays({ ...options, background: "#404040", targets: [
    { ...options }, { ...options, background: "#000000" },
  ] }, async (_url, init) => { calls.push(init!); return new Response(); });
  try {
    const transparent = encodePng({ width: 1, height: 1, data: new Uint8Array(4) }).toString("base64");
    group.select({ ...frame(), base64: transparent }); await tick();
    assert.equal(calls.length, 2);
    const center = (19 * 64 + 31) * 4;
    const images = calls.map(call => decodePng(Buffer.from(call.body as Uint8Array)));
    assert.deepEqual([...images[0]!.data.slice(center, center + 4)], [64, 64, 64, 255]);
    assert.deepEqual([...images[1]!.data.slice(center, center + 4)], [0, 0, 0, 255]);
    for (const image of images) assert.deepEqual([...image.data.slice(0, 4)], [0, 0, 0, 255]);
  } finally { group.dispose(); }
});

test("outline inherits per destination and rejects invalid colors", async () => {
  for (const outline of [null, 123, "white", "#fff"]) assert.equal(normalizeExternalDisplay({ ...options, outline }), null);
  const calls: RequestInit[] = [];
  const sender = new ExternalDisplays({ ...options, outline: "#ffffff", targets: [
    { ...options }, { ...options, outline: "#000000" },
  ] }, async (_url, init) => { calls.push(init!); return new Response(); });
  try {
    sender.select(frame()); await tick();
    assert.equal(calls.length, 2);
    const index = (18 * 64 + 30) * 4;
    const images = calls.map(call => decodePng(Buffer.from(call.body as Uint8Array)));
    assert.deepEqual([...images[0]!.data.slice(index, index + 4)], [255, 255, 255, 255]);
    assert.deepEqual([...images[1]!.data.slice(index, index + 4)], [0, 0, 0, 255]);
  } finally { sender.dispose(); }
});

test("debug target detection matches only loopback hosts", () => {
  for (const url of ["http://localhost:8000/emote", "http://localhost./emote", "http://sim.localhost/emote", "http://127.0.0.1/emote", "http://127.5.6.7/emote", "http://[::1]:8000/emote"]) assert.equal(isLoopbackDisplayUrl(url), true, url);
  for (const url of ["invalid", "http://192.168.1.227/emote", "http://localhost.example/emote", "http://example.com/localhost", "http://gentle-matrix.local/emote"]) assert.equal(isLoopbackDisplayUrl(url), false, url);
});

test("debugOff pauses only localhost and debugOn sends the latest frame without resetting ESP32", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sender = new ExternalDisplays({ ...options, targets: [options, { ...options, url: "http://matrix/emote" }] }, async (url, init) => {
    calls.push({ url: String(url), init: init! }); return new Response();
  });
  const local = () => calls.filter(call => call.url === options.url);
  const device = () => calls.filter(call => call.url.includes("matrix"));
  try {
    sender.select(frame()); await tick();
    const stream = new Headers(device()[0]!.init.headers).get("X-Emote-Stream-Id");
    assert.equal(sender.setDebugEnabled(false), 1);
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 2 });
    sender.select(frame("latest.png")); await tick();
    assert.equal(local().length, 1);
    assert.ok(device().length > 1);
    const deviceCount = device().length;
    sender.setDebugEnabled(true); await tick();
    assert.equal(local().length, 2);
    const resumed = new Headers(local()[1]!.init.headers);
    assert.equal(resumed.get("X-Emote-Frame"), "latest.png");
    assert.equal(resumed.get("X-Emote-Active-Subagents"), "2");
    assert.equal(resumed.get("X-Emote-Phase"), "executing");
    assert.equal(resumed.get("X-Emote-Sequence"), "2");
    assert.equal(device().length, deviceCount, "debugOn sends nothing extra to ESP32");
    assert.ok(device().every(call => new Headers(call.init.headers).get("X-Emote-Stream-Id") === stream));
    sender.setDebugEnabled(true); await tick();
    assert.equal(local().length, 2, "repeated debugOn is idempotent");
  } finally { sender.dispose(); }
});

test("debugOff aborts active local requests and drops pending frames; disabled config stays disabled", async () => {
  const calls: RequestInit[] = [];
  const sender = new ExternalDisplays(options, async (_url, init) => {
    calls.push(init!);
    if (calls.length === 1) return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(Error("aborted"))));
    return new Response();
  });
  try {
    sender.select(frame()); sender.select(frame("discard.png"));
    sender.setDebugEnabled(false);
    assert.ok(calls[0]!.signal!.aborted);
    sender.select(frame("latest.png"));
    sender.setDebugEnabled(true); await tick();
    assert.equal(calls.length, 2);
    assert.equal(new Headers(calls[1]!.headers).get("X-Emote-Frame"), "latest.png");
  } finally { sender.dispose(); }
  for (const config of [{ ...options, enabled: false }, { ...options, targets: [{ ...options, enabled: false }] }]) {
    const disabled = new ExternalDisplays(config, async () => { throw Error("must not fetch"); });
    assert.equal(disabled.setDebugEnabled(true), 0);
    assert.equal(disabled.enabled, false);
    disabled.dispose();
  }
});

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

test("activity-only updates resend unchanged sprites and snapshot the latest pending metadata", async () => {
  const calls: RequestInit[] = [];
  const done: Array<() => void> = [];
  const sender = new ExternalDisplay(options, async (_url, init) => {
    calls.push(init!);
    return new Promise(resolve => done.push(() => resolve(new Response())));
  });
  try {
    sender.select(frame());
    sender.updateActivity({ status: "busy", phase: "thinking", activeSubagents: 0 });
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 2 });
    assert.equal(calls.length, 1);
    assert.equal(new Headers(calls[0]!.headers).get("X-Emote-Phase"), "idle");
    done.shift()!(); await tick();
    const headers = new Headers(calls[1]!.headers);
    assert.equal(headers.get("X-Emote-Status"), "busy");
    assert.equal(headers.get("X-Emote-Phase"), "executing");
    assert.equal(headers.get("X-Emote-Active-Subagents"), "2");
    assert.notDeepEqual(calls[0]!.body, calls[1]!.body, "activity labels change the delivered PNG");
    done.shift()!(); await tick();
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 2 });
    assert.equal(calls.length, 2);
  } finally { sender.dispose(); }
});

test("work phase metadata stays additive, validated and deduplicated without overriding a selected state label", async () => {
  const calls: RequestInit[] = [];
  const sender = new ExternalDisplay(options, async (_url, init) => { calls.push(init!); return new Response(); });
  try {
    sender.select(frame());
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 0, workPhase: "implementing" });
    await tick();
    let headers = new Headers(calls.at(-1)!.headers);
    assert.equal(headers.get("X-Emote-Phase"), "executing", "the coarse header is preserved exactly");
    assert.equal(headers.get("X-Emote-Work-Phase"), "implementing");
    assert.ok(!JSON.stringify(calls.at(-1)!.headers).includes("undefined"));

    sender.updateActivity({ status: "busy", phase: "thinking", activeSubagents: 0 });
    await tick();
    headers = new Headers(calls.at(-1)!.headers);
    assert.equal(headers.get("X-Emote-Work-Phase"), null, "no header without a detail");

    // The detail is part of the dedup identity. select() delivered once, then each
    // distinct activity (executing+detail, thinking plain, thinking+detail) resends.
    sender.updateActivity({ status: "busy", phase: "thinking", activeSubagents: 0, workPhase: "planning" });
    await tick();
    assert.equal(calls.length, 4);
    sender.updateActivity({ status: "busy", phase: "thinking", activeSubagents: 0, workPhase: "planning" });
    await tick();
    assert.equal(calls.length, 4, "an identical work phase is deduplicated");

    // An invalid work phase never mutates the stored activity.
    const before = calls.length;
    sender.updateActivity({ status: "busy", phase: "thinking", activeSubagents: 0, workPhase: "scheming" } as any);
    await tick();
    assert.equal(calls.length, before);
    sender.select(frame("detail.png")); await tick();
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-Work-Phase"), "planning");

    // Both requests have the same selected idle state and busy (0) top row.
    // Coarse/host metadata still changes HTTP headers, but not the selected label.
    const selectedIdle = calls.at(-1)!.body;
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 0, workPhase: "implementing" });
    await tick();
    assert.deepEqual(calls.at(-1)!.body, selectedIdle, "coarse and work phase changes do not relabel the selected idle state");
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-State"), "idle");
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-Phase"), "executing");
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-Work-Phase"), "implementing");
    const withImplementing = calls.at(-1)!.body;
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 0, workPhase: "planning" });
    await tick();
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-Work-Phase"), "planning");
    assert.deepEqual(calls.at(-1)!.body, selectedIdle, "a different detail keeps the selected label PNG");
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 0, workPhase: "implementing" });
    await tick();
    assert.deepEqual(calls.at(-1)!.body, withImplementing, "revisiting metadata keeps the same selected label PNG");
  } finally { sender.dispose(); }
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

test("unreachable receivers, timeouts and HTTP errors never produce UI warnings", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const warnings: string[] = [];
  for (const fetcher of [
    () => { throw Error("connection refused"); },
    async () => { throw Error("DNS resolution failed"); },
    async () => new Response(null, { status: 503 }),
  ]) {
    const sender = new ExternalDisplay(options, fetcher, message => warnings.push(message));
    sender.select(frame()); await tick(); sender.dispose();
  }
  const stalled = new ExternalDisplay({ ...options, timeoutMs: 5 }, async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(Error("timeout")));
  }), message => warnings.push(message));
  try {
    stalled.select(frame()); t.mock.timers.tick(5); await tick();
    assert.deepEqual(warnings, []);
    const invalid = new ExternalDisplay({ ...options, url: "invalid" }, fetch, message => warnings.push(message));
    assert.equal(warnings.length, 1, "configuration errors remain visible");
    invalid.dispose();
  } finally { stalled.dispose(); }
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

test("write displays WRITING while preserving the original sender metadata", async () => {
  const calls: RequestInit[] = [];
  const sender = new ExternalDisplay(options, async (_url, init) => { calls.push(init!); return new Response(); });
  try {
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 2, workPhase: "planning" });
    sender.select({ base64, state: "write", frame: "write.png", set: "gentleman" });
    await tick();
    assert.equal(calls.length, 1);
    const request = calls[0]!;
    const headers = new Headers(request.headers);
    assert.equal(headers.get("Content-Type"), "image/png");
    assert.equal(headers.get("X-Emote-Version"), "1");
    assert.equal(headers.get("X-Emote-State"), "write");
    assert.equal(headers.get("X-Emote-Frame"), "write.png");
    assert.equal(headers.get("X-Emote-Set"), "gentleman");
    assert.equal(headers.get("X-Emote-Status"), "busy");
    assert.equal(headers.get("X-Emote-Phase"), "executing");
    assert.equal(headers.get("X-Emote-Work-Phase"), "planning");
    assert.equal(headers.get("X-Emote-Active-Subagents"), "2");
    assert.equal(headers.get("X-Emote-Sequence"), "1");
    assert.match(headers.get("X-Emote-Stream-Id")!, /^[0-9a-f-]{36}$/);

    const image = decodePng(Buffer.from(request.body as Uint8Array));
    assert.deepEqual([image.width, image.height], [64, 64]);
    const expected = new Uint8Array(64 * 64 * 4);
    for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
    drawDisplayText(expected, "WRITING", 54, [224, 224, 224]);
    assert.deepEqual(image.data.slice(54 * 64 * 4, 59 * 64 * 4), expected.slice(54 * 64 * 4, 59 * 64 * 4));
  } finally { sender.dispose(); }
});

test("the selected state recomposes the PNG label and the cache keys it without changing headers", async () => {
  const calls: RequestInit[] = [];
  const sender = new ExternalDisplay(options, async (_url, init) => { calls.push(init!); return new Response(); });
  try {
    sender.updateActivity({ status: "busy", phase: "executing", activeSubagents: 0 });
    sender.select({ base64, state: "explore", frame: "explore.png", set: "gentleman" });
    await tick();
    const ordinaryExplore = calls.at(-1)!.body;
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-State"), "explore");
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-Phase"), "executing");

    // Identical sprite bytes with two ordinary selected states need distinct labels.
    sender.select({ base64, state: "build", frame: "explore.png", set: "gentleman" });
    await tick();
    assert.equal(calls.length, 2);
    const ordinaryBuild = calls.at(-1)!.body;
    assert.notDeepEqual(ordinaryExplore, ordinaryBuild, "ordinary selected states change the rendered label bytes");
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-State"), "build");
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-Phase"), "executing", "the coarse header stays");

    // The prepared-PNG cache must distinguish ordinary states even with identical sprites.
    sender.select({ base64, state: "explore", frame: "explore.png", set: "gentleman" });
    await tick();
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.at(-1)!.body, ordinaryExplore, "the cached explore label recomposes identically");
    sender.select({ base64, state: "build", frame: "explore.png", set: "gentleman" });
    await tick();
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.at(-1)!.body, ordinaryBuild, "the cached build label recomposes identically");
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-State"), "build");
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-Phase"), "executing");
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-Work-Phase"), null);
  } finally { sender.dispose(); }
});
