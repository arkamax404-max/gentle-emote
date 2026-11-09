import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boot } from "./integration.test.ts";

const SESSION_ID = "integration-session";
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const change = (phase: string | null, source: string | null, sessionId = SESSION_ID) =>
  ({ schema: "gentle-pi.odd-phase/v1", sessionId, phase, source });
const end = (phase: unknown, extra: Record<string, unknown> = {}) => ({
  toolName: "gentle_odd_phase", toolCallId: "p", args: { phase }, ...extra,
});

interface Lab extends Awaited<ReturnType<typeof boot>> { calls: RequestInit[]; root: string }

/** Boots the extension with every output off (a configured localhost destination stays paused) and hands it to `fn`. */
async function withLab(fn: (lab: Lab) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "emote-status-"));
  const dir = join(root, ".pi", "extensions", "gentle-emote");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ externalDisplay: { enabled: true, url: "http://127.0.0.1:8000/emote" } }));
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => { calls.push(init!); return new Response(); };
  let lab: Lab | undefined;
  try {
    lab = { ...(await boot(root, [])), calls, root };
    await fn(lab);
  } finally {
    await lab?.shutdown();
    lab?.restore();
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
}

const lastNotice = (lab: Lab) => lab.notices.at(-1)!;

test("status after no phase reports the coarse snapshot with no source", async () => {
  await withLab(async (lab) => {
    await lab.commands.get("emote").handler("status", lab.ctx);
    assert.deepEqual(lastNotice(lab), {
      message: "[gentle-emote] status: PNG none selected yet; phase none (source: none); activity status=idle phase=idle activeSubagents=0",
      level: "info",
    });
  });
});

test("a selected exploring PNG is reported honestly without claiming a host phase", async () => {
  await withLab(async (lab) => {
    await lab.commands.get("emote").handler("exploring", lab.ctx);
    await flush();
    await lab.commands.get("emote").handler("status", lab.ctx);
    const message = lastNotice(lab).message;
    assert.match(message, /\bPNG state=exploring frame=exploring_\d\.png set=gentleman\b/);
    assert.match(message, /phase none \(source: none\)/, "the missing host phase is never inferred from the PNG");
    assert.match(message, /\bactivity status=idle phase=idle activeSubagents=0\b/);
    assert.equal(lastNotice(lab).level, "info");
  });
});

test("a successful gentle_odd_phase planning end reports the direct source", async () => {
  await withLab(async (lab) => {
    await lab.emit("tool_execution_start", { toolName: "gentle_odd_phase", toolCallId: "p", args: { phase: "planning" } });
    await lab.emit("tool_execution_end", end("planning", { isError: false }));
    await flush();
    await lab.commands.get("emote").handler("status", lab.ctx);
    const message = lastNotice(lab).message;
    assert.match(message, /phase planning \(source: direct\)/);
    assert.match(message, /\bPNG state=(?:tool|read|planning) frame=[^\s]+ set=gentleman\b/);
  });
});

test("the native bus phase wins over the direct fallback and survives a direct clear", async () => {
  await withLab(async (lab) => {
    lab.emitBus("gentle-pi:odd-phase/v1", change("implementing", "inferred"));
    await flush();
    await lab.emit("tool_execution_end", end("planning"));
    await flush();
    await lab.commands.get("emote").handler("status", lab.ctx);
    assert.match(lastNotice(lab).message, /phase implementing \(source: native\)/);
    await lab.emit("tool_execution_end", end("clear"));
    await flush();
    await lab.commands.get("emote").handler("status", lab.ctx);
    assert.match(lastNotice(lab).message, /phase implementing \(source: native\)/, "a direct clear never erases the native phase");
  });
});

test("clear drops the direct fallback and reports none honestly", async () => {
  await withLab(async (lab) => {
    await lab.emit("tool_execution_end", end("planning"));
    await flush();
    await lab.commands.get("emote").handler("status", lab.ctx);
    assert.match(lastNotice(lab).message, /phase planning \(source: direct\)/);
    await lab.emit("tool_execution_end", end("clear"));
    await flush();
    await lab.commands.get("emote").handler("status", lab.ctx);
    assert.match(lastNotice(lab).message, /phase none \(source: none\)/);
  });
});

test("status with all outputs off is a read-only diagnostic that captures the PNG without side effects", async () => {
  await withLab(async (lab) => {
    // Let the startup greeting settle so a later blink cannot race the snapshot.
    await sleep(3000);
    const configBefore = readFileSync(join(lab.root, ".pi", "extensions", "gentle-emote", "config.json"), "utf8");
    await lab.commands.get("emote").handler("exploring", lab.ctx);
    await flush();
    assert.equal(lab.calls.length, 0, "no destination is enabled, nothing is delivered");
    const writesBefore = lab.writes.length;
    await lab.commands.get("emote").handler("status", lab.ctx);
    const first = lastNotice(lab).message;
    assert.match(first, /\bPNG state=exploring frame=exploring_\d\.png set=gentleman\b/, "capture works with every output off");
    assert.equal(lab.calls.length, 0);
    assert.equal(lab.writes.length, writesBefore, "status sends no terminal graphics");
    await lab.commands.get("emote").handler("status", lab.ctx);
    const second = lastNotice(lab).message;
    assert.equal(second.replace(/^.*PNG /, "PNG ").replace(/;.*$/, ""), first.replace(/^.*PNG /, "PNG ").replace(/;.*$/, ""), "no frame transition happened between reports");
    assert.equal(lab.calls.length, 0);
    assert.equal(lab.writes.length, writesBefore);
    assert.equal(readFileSync(join(lab.root, ".pi", "extensions", "gentle-emote", "config.json"), "utf8"), configBefore, "config.json is never rewritten");
    const agentDir = process.env.PI_CODING_AGENT_DIR!;
    assert.ok(!existsSync(join(agentDir, "extensions", "gentle-emote", "output-states")), "the global output preference store is never written");
    assert.deepEqual(lastNotice(lab).level, "info");
  });
});

test("status tab-completes next to the existing commands", async () => {
  await withLab(async (lab) => {
    const emote = lab.commands.get("emote");
    assert.deepEqual(emote.getArgumentCompletions("stat").map((item: any) => item.value), ["status"]);
    assert.deepEqual(emote.getArgumentCompletions("internal").map((item: any) => item.value), ["internalOn", "internalOff"]);
    assert.deepEqual(emote.getArgumentCompletions("demo").map((item: any) => item.value), ["demo"]);
  });
});

test("existing commands keep their behavior alongside status", async () => {
  await withLab(async (lab) => {
    const emote = lab.commands.get("emote");
    await emote.handler("bogus-state", lab.ctx);
    const usage = lastNotice(lab);
    assert.equal(usage.level, "info");
    assert.ok(usage.message.startsWith("[gentle-emote] /emote <state>: "), "the usage notice keeps its shape");
    assert.ok(usage.message.includes(" status,"), "status is listed for discovery");
    assert.ok(usage.message.includes("demo,"), "the demo entry is unchanged");
    await emote.handler("demo", lab.ctx);
    await flush();
    await emote.handler("status", lab.ctx);
    assert.match(lastNotice(lab).message, /\bPNG state=hi frame=/, "the demo preview still drives PNG selection");
    await lab.commands.get("emote").handler("internalOn", lab.ctx);
    lab.widgets.render(100);
    assert.ok(lab.editor.render(100).join("").includes("\u{10EEEE}"), "internalOn still shows the avatar");
  });
});
