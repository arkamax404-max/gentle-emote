import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture(child: string | undefined) {
  const root = mkdtempSync(join(tmpdir(), "emote-child-isolation-"));
  const keys = ["GENTLE_PI_AGENTS_CHILD", "PI_CODING_AGENT_DIR", "HOME", "USERPROFILE"];
  const saved = keys.map(key => process.env[key]);
  if (child === undefined) delete process.env.GENTLE_PI_AGENTS_CHILD;
  else process.env.GENTLE_PI_AGENTS_CHILD = child;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  const outputs = ["internal", "debug", "d200", "display"];
  const preferences = join(root, "agent", "extensions", "gentle-emote", "output-states");
  mkdirSync(preferences, { recursive: true });
  for (const output of outputs) writeFileSync(join(preferences, `${output}.json`), "true\n");
  const configDir = join(root, ".pi", "extensions", "gentle-emote");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({
    enabled: true,
    terminals: [{ match: "unknown", render: "ascii" }],
    externalDisplay: { enabled: true, targets: [
      { enabled: true, url: "http://127.0.0.1:8000/emote" },
      { enabled: true, url: "http://matrix.invalid/emote" },
    ] },
  }));
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init: init! }); return new Response(); };
  const handlers = new Map<string, Function[]>();
  const commands = new Map<string, any>();
  const widgets: unknown[] = [];
  let terminalSubscriptions = 0;
  const ctx = {
    hasUI: true, mode: "rpc", cwd: root, model: { id: "test" },
    sessionManager: { getSessionId: () => "child-isolation-session" },
    ui: {
      notify() {},
      setWidget(_key: string, factory: unknown) { widgets.push(factory); },
      onTerminalInput() { terminalSubscriptions++; return () => {}; },
    },
  };
  const { default: extension } = await import("../src/index.ts");
  extension({
    on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    registerCommand(name: string, command: unknown) { commands.set(name, command); },
    getThinkingLevel: () => "high",
  } as any);
  const emit = async (name: string, payload: unknown = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(payload, ctx);
  };
  return { requests, commands, widgets, handlers, ctx, emit,
    terminalSubscriptions: () => terminalSubscriptions,
    preferenceBytes: () => outputs.map(output => readFileSync(join(preferences, `${output}.json`), "utf8")),
    async dispose() {
      try { await emit("session_shutdown", { reason: "quit" }); }
      finally {
        globalThis.fetch = originalFetch;
        keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("RPC children emit no images or preference changes even with every saved output on", async () => {
  const lab = await fixture("1");
  try {
    const before = lab.preferenceBytes();
    await lab.emit("session_start");
    await lab.emit("agent_start");
    await lab.emit("tool_execution_start", { toolName: "read", toolCallId: "child-read" });
    await lab.emit("ui_prompt_start");
    await lab.emit("ui_prompt_end");
    for (const output of ["internal", "debug", "d200", "display"]) {
      await lab.commands.get("emote")?.handler(`${output}Off`, lab.ctx);
    }
    await tick();
    assert.equal(lab.requests.length, 0, "child must not send to loopback, LAN, or D200");
    assert.deepEqual(lab.widgets, [], "child must not install a terminal avatar");
    assert.equal(lab.terminalSubscriptions(), 0);
    assert.equal(lab.commands.size, 0, "child cannot change shared preferences via commands");
    assert.equal(lab.handlers.size, 0, "child does not register activity handlers");
    assert.deepEqual(lab.preferenceBytes(), before, "all saved On choices remain untouched");
  } finally { await lab.dispose(); }
});

for (const marker of [undefined, "0"]) {
  test(`primary RPC keeps image delivery and delegation when child marker is ${marker ?? "absent"}`, async () => {
    const lab = await fixture(marker);
    try {
      await lab.emit("session_start");
      await lab.emit("agent_start");
      await lab.emit("tool_execution_start", { toolName: "subagent_run", toolCallId: "parent-delegation", args: { agent: "gentle-ai-explore" } });
      await tick();
      assert.ok(lab.commands.has("emote"));
      assert.ok(lab.widgets.length > 0);
      for (const target of ["127.0.0.1:8000", "matrix.invalid", "127.0.0.1:8003"]) {
        assert.ok(lab.requests.some(request => request.url.includes(target)), `primary preserves ${target}`);
      }
      const headers = lab.requests.map(request => new Headers(request.init.headers));
      assert.ok(headers.some(header => header.get("X-Emote-Active-Subagents") === "1" && header.get("X-Emote-State") === "explore"));
      assert.deepEqual(lab.preferenceBytes(), ["true\n", "true\n", "true\n", "true\n"]);
    } finally { await lab.dispose(); }
  });
}
