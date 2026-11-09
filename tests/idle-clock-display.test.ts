import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { ExternalDisplay, ExternalDisplays, type DisplayActivity } from "../src/external_display.ts";
import { createD200Display } from "../src/d200_display.ts";
import { encodePng, decodePng } from "../src/png.ts";
import { prepareDisplayImage } from "../src/display_image.ts";

const options = { enabled: true, url: "http://127.0.0.1:48000/emote", timeoutMs: 30000 };
const idle: DisplayActivity = { status: "idle", phase: "idle", activeSubagents: 0 };
const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) }).toString("base64");
const frame = (name = "idle.png", state = "idle") => ({ base64, state, frame: name, set: "gentleman" });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const headers = (call: RequestInit) => new Headers(call.headers);
const pixels = (call: RequestInit) => decodePng(Buffer.from(call.body as Uint8Array));
function virtualTime(t: TestContext) {
  let elapsed = 0;
  t.mock.method(performance, "now", () => elapsed);
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: new Date(2026, 10, 9, 23, 54, 57).getTime() });
  return { now: () => elapsed, async advance(ms: number) { elapsed += ms; t.mock.timers.tick(ms); await flush(); } };
}

// Explicit expected pixels, independent of the production clock renderer.
const digits: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "/": ["001", "001", "010", "100", "100"], ":": ["000", "010", "000", "010", "000"],
};
function assertText(data: Uint8Array, value: string, left: number, top: number, scale: number, ink: number[]) {
  for (let i = 0; i < value.length; i++) {
    const glyph = digits[value[i]!]!;
    for (let y = 0; y < 5 * scale; y++) for (let x = 0; x < 3 * scale; x++) {
      const offset = ((top + y) * 64 + left + i * 4 * scale + x) * 4;
      const expected = glyph[Math.floor(y / scale)]![Math.floor(x / scale)] === "1" ? ink : [0, 0, 0];
      assert.deepEqual([...data.slice(offset, offset + 4)], [...expected, 255], `${value} pixel ${i}/${x}/${y}`);
    }
  }
}

test("S1: ordinary PNG protocol remains unchanged through exactly five idle minutes, then resumes the remembered avatar", async t => {
  const clock = virtualTime(t), calls: RequestInit[] = [];
  const sender = new ExternalDisplay(options, async (_url, init) => { calls.push(init!); return new Response(); });
  try {
    sender.select(frame()); await flush();
    assert.deepEqual(Buffer.from(calls[0]!.body as Uint8Array), prepareDisplayImage(base64, { ...idle, state: "idle" }));
    await clock.advance(300000);
    assert.equal(calls.length, 1, "exactly five minutes is not more than five minutes");
    await clock.advance(1000);
    assert.equal(headers(calls.at(-1)!).get("X-Emote-State"), "clock");
    assert.equal(headers(calls.at(-1)!).get("X-Emote-Frame"), "clock.png");
    assert.equal(headers(calls.at(-1)!).get("X-Emote-Set"), "idle-clock");
    assert.equal(headers(calls.at(-1)!).get("X-Emote-Status"), "idle");
    assert.equal(headers(calls.at(-1)!).get("X-Emote-Phase"), "idle");
    assert.equal(headers(calls.at(-1)!).get("X-Emote-Active-Subagents"), "0");
    sender.select(frame("latest.png"));
    const busy: DisplayActivity = { status: "busy", phase: "thinking", activeSubagents: 0 };
    sender.updateActivity(busy); await flush();
    assert.equal(headers(calls.at(-1)!).get("X-Emote-Frame"), "latest.png");
    assert.deepEqual(Buffer.from(calls.at(-1)!.body as Uint8Array), prepareDisplayImage(base64, { ...busy, state: "idle" }));
    sender.updateActivity(idle); await flush();
    const count = calls.length;
    await clock.advance(300000); assert.equal(calls.length, count, "new idle period must start again");
    await clock.advance(1000); assert.equal(headers(calls.at(-1)!).get("X-Emote-State"), "clock");
  } finally { sender.dispose(); }
});

test("S2-S3: bottom walkers advance at most once per second even when source animation selects frames more often", async t => {
  const clock = virtualTime(t), calls: Array<{ at: number; init: RequestInit }> = [];
  const sender = new ExternalDisplay(options, async (_url, init) => { calls.push({ at: clock.now(), init: init! }); return new Response(); });
  try {
    sender.select(frame()); await flush(); await clock.advance(301000);
    assert.equal(headers(calls.at(-1)!.init).get("X-Emote-State"), "clock");
    const first = pixels(calls.at(-1)!.init);
    for (let i = 0; i < 8; i++) {
      await clock.advance(250); sender.select(frame(`animation_${i}.png`)); await flush();
    }
    const ambient = calls.filter(call => headers(call.init).get("X-Emote-State") === "clock");
    assert.equal(ambient.length, 3, "one initial clock plus two 1Hz updates");
    for (let i = 1; i < ambient.length; i++) assert.ok(ambient[i]!.at - ambient[i - 1]!.at >= 1000);
    const next = pixels(ambient[1]!.init);
    assert.deepEqual([next.width, next.height], [64, 64]);
    assert.notDeepEqual(next.data.slice(55 * 64 * 4), first.data.slice(55 * 64 * 4), "feet/positions advance in the bottom strip");
    assert.deepEqual(next.data.slice(0, 33 * 64 * 4), first.data.slice(0, 33 * 64 * 4), "walkers do not overlap date or hours");
    assert.ok([...next.data].every((value, index) => index % 4 !== 3 || value === 255));
  } finally { sender.dispose(); }
});

test("S4: clock PNG uses DD/MM/YYYY, 24-hour digits and 2x seconds, including midnight date rollover", async t => {
  const clock = virtualTime(t), calls: RequestInit[] = [];
  const sender = new ExternalDisplay(options, async (_url, init) => { calls.push(init!); return new Response(); });
  const assertFace = (date: string, hours: string, minutes: string, seconds: string) => {
    assert.equal(headers(calls.at(-1)!).get("X-Emote-State"), "clock");
    const image = pixels(calls.at(-1)!);
    assert.deepEqual([image.width, image.height], [64, 64]);
    assertText(image.data, date, 12, 1, 1, [147, 181, 160]);
    assertText(image.data, hours, 12, 9, 4, [242, 241, 220]);
    assertText(image.data, minutes, 12, 31, 4, [85, 189, 232]);
    assertText(image.data, seconds, 46, 33, 2, [241, 189, 101]);
    assertText(image.data, ":", 43, 35, 1, [241, 189, 101]);
  };
  try {
    sender.select(frame()); await flush(); await clock.advance(301000);
    assertFace("09/11/2026", "23", "59", "58");
    await clock.advance(1000); await clock.advance(1000);
    assertFace("10/11/2026", "00", "00", "00");
  } finally { sender.dispose(); }
});

test("busy/error, active subagents, detailed work and explicit previews reset the deadline; grandma remains eligible", async t => {
  const clock = virtualTime(t);
  for (const blocked of [
    { activity: { ...idle, status: "error" as const } },
    { activity: { ...idle, status: "busy" as const, phase: "thinking" as const } },
    { activity: { ...idle, phase: "waiting" as const } },
    { activity: { ...idle, activeSubagents: 1 } },
    { activity: { ...idle, workPhase: "planning" as const } },
    { activity: idle, state: "bye" },
  ]) {
    const calls: RequestInit[] = [];
    const sender = new ExternalDisplay(options, async (_url, init) => { calls.push(init!); return new Response(); });
    try {
      sender.updateActivity(blocked.activity); sender.select(frame("preview.png", blocked.state ?? "idle")); await flush();
      await clock.advance(301000);
      assert.ok(calls.every(call => headers(call).get("X-Emote-State") !== "clock"));
      sender.updateActivity(idle); sender.select(frame("grandma.png", "grandma")); await flush();
      await clock.advance(300000);
      assert.notEqual(headers(calls.at(-1)!).get("X-Emote-State"), "clock");
      await clock.advance(1000); assert.equal(headers(calls.at(-1)!).get("X-Emote-State"), "clock");
    } finally { sender.dispose(); }
  }
});

test("S5: clock reaches enabled simulator, LED and D200 independently without bypassing output pause or disabled config", async t => {
  const clock = virtualTime(t), calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(); };
  const group = new ExternalDisplays({ enabled: true, targets: [options, { ...options, url: "http://matrix.invalid/emote" }] }, fetcher);
  const d200 = createD200Display({ port: 48003, fetcher });
  const disabled = new ExternalDisplay({ ...options, enabled: false }, fetcher);
  try {
    group.setDebugEnabled(false); group.setDisplayEnabled(false); d200.setPaused(true);
    group.select(frame()); d200.select(frame()); disabled.select(frame());
    await clock.advance(301000); assert.equal(calls.length, 0);
    group.setDebugEnabled(true); group.setDisplayEnabled(true); d200.setPaused(false); await flush();
    assert.deepEqual(calls.map(call => call.url).sort(), [options.url, "http://matrix.invalid/emote", "http://127.0.0.1:48003/emote"].sort());
    assert.ok(calls.every(call => headers(call.init).get("X-Emote-State") === "clock"));
    group.setDebugEnabled(true); group.setDisplayEnabled(true); d200.setPaused(false); await flush();
    assert.equal(calls.length, 3, "repeated enable is idempotent");
    group.setDebugEnabled(false); group.setDisplayEnabled(false); d200.dispose();
    await clock.advance(5000); assert.equal(calls.length, 3);
    group.setDebugEnabled(true); await flush();
    assert.equal(calls.length, 4); assert.equal(calls.at(-1)!.url, options.url);
  } finally { group.dispose(); d200.dispose(); disabled.dispose(); }
});

test("clock delivery retains one active plus latest pending frame, then disposal aborts and prevents later ticks", async t => {
  const clock = virtualTime(t), calls: RequestInit[] = [], release: Array<() => void> = [];
  const sender = new ExternalDisplay(options, async (_url, init) => {
    calls.push(init!);
    if (headers(init!).get("X-Emote-State") !== "clock") return new Response();
    return new Promise(resolve => release.push(() => resolve(new Response())));
  });
  try {
    sender.select(frame()); await flush(); await clock.advance(301000);
    assert.equal(calls.length, 2); assert.equal(headers(calls[1]!).get("X-Emote-State"), "clock");
    for (let i = 0; i < 5; i++) await clock.advance(1000);
    assert.equal(calls.length, 2, "slow receiver never creates concurrent requests");
    release.shift()!(); await flush();
    assert.equal(calls.length, 3); assert.equal(headers(calls[2]!).get("X-Emote-Sequence"), "3");
    const latest = pixels(calls[2]!);
    assertText(latest.data, "03", 46, 33, 2, [241, 189, 101]);
    sender.updateActivity({ status: "busy", phase: "thinking", activeSubagents: 0 });
    sender.dispose(); assert.equal(calls[2]!.signal!.aborted, true);
    release.shift()!(); await flush(); await clock.advance(10000);
    sender.select(frame()); sender.updateActivity(idle); await flush();
    assert.equal(calls.length, 3, "no pending activity or periodic clock survives dispose");
  } finally { sender.dispose(); for (const done of release) done(); }
});

test("an enabled idle display can produce its clock without an available source sprite", async t => {
  const clock = virtualTime(t), calls: RequestInit[] = [];
  const sender = new ExternalDisplay(options, async (_url, init) => { calls.push(init!); return new Response(); });
  try {
    sender.updateActivity(idle); await clock.advance(300000); assert.equal(calls.length, 0);
    await clock.advance(1000); assert.equal(calls.length, 1);
    assert.equal(headers(calls[0]!).get("X-Emote-State"), "clock");
    assert.deepEqual([pixels(calls[0]!).width, pixels(calls[0]!).height], [64, 64]);
  } finally { sender.dispose(); }
});
