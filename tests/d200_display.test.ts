import { test } from "node:test";
import assert from "node:assert/strict";
import { D200_PORT, createD200Display, d200Url, resolveD200Port } from "../src/d200_display.ts";
import { encodePng } from "../src/png.ts";

// A real 64x64 frame: the sender composites the PNG before POSTing it.
const framePng = encodePng({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(255) });
const image = { base64: framePng.toString("base64"), state: "think", frame: "think.png", set: "gentleman" };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function recorder() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response();
  };
  return { calls, fetcher: fetcher as unknown as typeof fetch };
}

test("the D200 destination defaults to 127.0.0.1:8003", () => {
  assert.equal(D200_PORT, 8003);
  assert.equal(resolveD200Port({}), 8003);
  assert.equal(d200Url(), "http://127.0.0.1:8003/emote");
  assert.equal(d200Url(8123), "http://127.0.0.1:8123/emote");
});

test("the port can be overridden for tests and invalid values fall back", () => {
  assert.equal(resolveD200Port({ GENTLE_EMOTE_D200_PORT: "9000" }), 9000);
  for (const value of ["", "0", "abc", "70000", "-1"]) assert.equal(resolveD200Port({ GENTLE_EMOTE_D200_PORT: value }), 8003, value);
});

test("a D200 display posts protocol v1 frames to the key receiver", async () => {
  const { calls, fetcher } = recorder();
  const display = createD200Display({ fetcher });
  try {
    assert.equal(display.enabled, true);
    assert.equal(display.local, true);
    display.select(image);
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8003/emote");
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "image/png");
    assert.equal(headers["X-Emote-Version"], "1");
    assert.equal(headers["X-Emote-State"], "think");
    assert.equal(headers["X-Emote-Frame"], "think.png");
    assert.equal(headers["X-Emote-Set"], "gentleman");
    assert.ok(Buffer.isBuffer(calls[0].init.body));
  } finally {
    display.dispose();
  }
});

test("identical selections are deduplicated and a new frame is sent", async () => {
  const { calls, fetcher } = recorder();
  const display = createD200Display({ fetcher });
  try {
    display.select(image);
    display.select(image);
    await flush();
    assert.equal(calls.length, 1);
    display.select({ ...image, frame: "think_blink.png" });
    await flush();
    assert.equal(calls.length, 2);
  } finally {
    display.dispose();
  }
});

test("activity changes resend the same frame with new labels", async () => {
  const { calls, fetcher } = recorder();
  const display = createD200Display({ fetcher });
  try {
    display.select(image);
    await flush();
    display.updateActivity({ status: "busy", phase: "executing", activeSubagents: 2 });
    await flush();
    assert.equal(calls.length, 2);
    assert.equal((calls[1].init.headers as Record<string, string>)["X-Emote-Status"], "busy");
    assert.equal((calls[1].init.headers as Record<string, string>)["X-Emote-Active-Subagents"], "2");
  } finally {
    display.dispose();
  }
});

test("the D200 mirror carries the detailed work phase header", async () => {
  const { calls, fetcher } = recorder();
  const display = createD200Display({ fetcher });
  try {
    display.select(image);
    await flush();
    display.updateActivity({ status: "busy", phase: "executing", activeSubagents: 0, workPhase: "checking" });
    await flush();
    assert.equal(calls.length, 2);
    const headers = calls[1]!.init.headers as Record<string, string>;
    assert.equal(headers["X-Emote-Phase"], "executing");
    assert.equal(headers["X-Emote-Work-Phase"], "checking");
  } finally {
    display.dispose();
  }
});

test("disposing the D200 display stops delivery", async () => {
  const { calls, fetcher } = recorder();
  const display = createD200Display({ fetcher });
  display.select(image);
  await flush();
  display.dispose();
  display.select({ ...image, frame: "read.png" });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(display.enabled, false);
});
