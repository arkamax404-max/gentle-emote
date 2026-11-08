import { test } from "node:test";
import assert from "node:assert/strict";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLACEHOLDER = "\u{10EEEE}";

/** Loads the extension against a fake Pi and a real pi-tui component tree (Ghostty, no multiplexer). */
async function boot(cwd = "/tmp", outputs = ["internalOn", "debugOn", "displayOn"], profile?: string) {
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentRoot = profile ?? mkdtempSync(join(tmpdir(), "emote-profile-"));
  for (const key of ["TMUX", "ZELLIJ", "ZELLIJ_SESSION_NAME", "KITTY_WINDOW_ID", "TERM_PROGRAM"]) delete process.env[key];
  process.env.GHOSTTY_RESOURCES_DIR = "/usr/share/ghostty";
  process.env.PI_CODING_AGENT_DIR = agentRoot;

  const notices: Array<{ message: string; level: string }> = [];
  const writes: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: string | Uint8Array, ...args: any[]) => {
    // Node's test runner writes binary protocol messages here too; never swallow them.
    if (typeof chunk !== "string") return (realWrite as any)(chunk, ...args);
    writes.push(chunk);
    return true;
  };

  const handlers = new Map<string, Function[]>();
  const commands = new Map<string, any>();
  const pi = {
    on: (event: string, handler: Function) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    registerCommand: (name: string, options: any) => commands.set(name, options),
    getThinkingLevel: () => "high",
  };
  const emit = async (event: string, payload: any = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
  };

  const widgets = new Container();
  const editor = new Container();
  // Same shape as Gentle Shell's float prompt: hint row, input row, blank panel row.
  editor.addChild({ render: (width: number) => [`┃ waiting for input`.padEnd(width), `┃ > `.padEnd(width), `┃`.padEnd(width)] } as any);
  const tui = { children: [widgets, editor], requestRender() {}, getFocusedComponent: () => null };
  const ctx = {
    hasUI: true,
    cwd,
    model: { id: "claude-test" },
    ui: {
      notify(message: string, level: string) { notices.push({ message, level }); },
      onTerminalInput: () => () => {},
      setWidget: (_key: string, factory: any) => { widgets.clear(); if (factory) widgets.addChild(factory(tui, {})); },
    },
  };

  const { default: extension } = await import("../src/index.ts");
  extension(pi as any);
  await emit("session_start");
  for (const output of outputs) await commands.get("emote").handler(output, ctx);
  const shutdown = async () => {
    if (shutDown) return;
    shutDown = true;
    await emit("session_shutdown", { reason: "quit" });
  };
  let shutDown = false;
  return { emit, widgets, editor, writes, notices, shutdown, commands, ctx, restore: () => {
    (process.stdout as any).write = realWrite;
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    if (!profile) rmSync(agentRoot, { recursive: true, force: true });
  } };
}

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

test("session wiring mirrors image selections and prompt overlays, shutdown stops delivery", async () => {
  const root = mkdtempSync(join(tmpdir(), "emote-session-"));
  const dir = join(root, ".pi", "extensions", "gentle-emote");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ externalDisplay: { enabled: true, url: "http://127.0.0.1:8000/emote" } }));
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => { calls.push(init!); return new Response(); };
  let lab: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    lab = await boot(root);
    await lab.emit("tool_execution_start", { toolName: "bash" });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(calls.length > 0);
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-State"), "tool");
    await lab.emit("ui_prompt_start");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-State"), "ask");
    await lab.emit("ui_prompt_end");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(new Headers(calls.at(-1)!.headers).get("X-Emote-State"), "tool");
    await lab.shutdown();
    const count = calls.length;
    await lab.emit("tool_execution_start", { toolName: "read" });
    assert.equal(calls.length, count);
  } finally {
    await lab?.shutdown(); lab?.restore(); globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test("ASCII-only terminal still POSTs animated PNGs, prompt overlays and model set changes", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const root = mkdtempSync(join(tmpdir(), "emote-ascii-session-"));
  const dir = join(root, ".pi", "extensions", "gentle-emote");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    externalDisplay: { enabled: true, targets: [
      { enabled: true, url: "http://localhost:8000/emote" },
      { enabled: true, url: "http://matrix/emote" },
    ] },
    terminals: [{ match: "ghostty", render: "ascii" }], cycleMs: 15,
    emotes: [{ model: "next", "emote-set": "gentleman-yolo" }],
  }));
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(); };
  let lab: Awaited<ReturnType<typeof boot>> | undefined;
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  try {
    lab = await boot(root);
    await lab.emit("tool_execution_start", { toolName: "read", toolCallId: "read-1" });
    t.mock.timers.tick(450);
    await tick();
    const readCalls = calls.filter(call => new Headers(call.init.headers).get("X-Emote-State") === "read");
    assert.ok(new Set(readCalls.map(call => new Headers(call.init.headers).get("X-Emote-Frame"))).size > 1);
    assert.ok(readCalls.some(call => call.url.includes("localhost")) && readCalls.some(call => call.url.includes("matrix")));
    lab.widgets.render(100); // Install the text gutter before rendering the editor.
    assert.ok(lab.editor.render(100).join("\n").includes(".------."), "local output remains ASCII");
    assert.ok(!lab.writes.some(write => write.includes("\x1b_G") || write.includes("1337;File=")), "no image protocol writes");
    await lab.emit("ui_prompt_start"); await tick();
    assert.equal(new Headers(calls.at(-1)!.init.headers).get("X-Emote-State"), "ask");
    await lab.emit("ui_prompt_end"); await tick();
    assert.equal(new Headers(calls.at(-1)!.init.headers).get("X-Emote-State"), "read");
    const command = lab.commands.get("emote");
    await command.handler("internalOff", lab.ctx); await tick();
    lab.widgets.render(100);
    assert.ok(!lab.editor.render(100).join("\n").includes(".------."));
    await lab.emit("model_select", { model: { id: "next" } }); await tick();
    assert.equal(new Headers(calls.at(-1)!.init.headers).get("X-Emote-Set"), "gentleman-yolo");
    await command.handler("internalOn", lab.ctx); await tick();
    lab.widgets.render(100);
    assert.ok(lab.editor.render(100).join("\n").includes(".------."), "ASCII avatar is restored");
    await lab.shutdown();
    const count = calls.length;
    await lab.emit("tool_execution_start", { toolName: "write" }); await tick();
    assert.equal(calls.length, count);
  } finally {
    await lab?.shutdown(); lab?.restore(); globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test("internalOff removes the terminal avatar but preserves PNG POSTs and internalOn restores it", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const root = mkdtempSync(join(tmpdir(), "emote-visibility-"));
  const dir = join(root, ".pi", "extensions", "gentle-emote");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    externalDisplay: { enabled: true, targets: [
      { enabled: true, url: "http://localhost:8000/emote" },
      { enabled: true, url: "http://matrix/emote" },
    ] },
  }));
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(); };
  let lab: Awaited<ReturnType<typeof boot>> | undefined;
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  try {
    lab = await boot(root);
    await lab.emit("tool_execution_start", { toolName: "read", toolCallId: "r" }); await tick();
    lab.widgets.render(100);
    assert.ok(lab.editor.render(100).join("\n").includes(PLACEHOLDER));
    const command = lab.commands.get("emote");
    assert.deepEqual(command.getArgumentCompletions("internal").map((item: any) => item.value), ["internalOn", "internalOff"]);
    await command.handler("internalOff", lab.ctx); await tick();
    assert.deepEqual(lab.widgets.render(100), []);
    assert.ok(!lab.editor.render(100).join("\n").includes(PLACEHOLDER), "gutter is removed");
    const writes = lab.writes.length;
    const start = calls.length;
    await lab.emit("tool_execution_start", { toolName: "write", toolCallId: "w" });
    t.mock.timers.tick(240); await tick();
    const hidden = calls.slice(start).filter(call => new Headers(call.init.headers).get("X-Emote-State") === "write");
    assert.ok(hidden.some(call => call.url.includes("localhost")) && hidden.some(call => call.url.includes("matrix")));
    assert.ok(new Set(hidden.map(call => new Headers(call.init.headers).get("X-Emote-Frame"))).size > 1);
    await lab.emit("ui_prompt_start"); await tick();
    assert.equal(new Headers(calls.at(-1)!.init.headers).get("X-Emote-State"), "ask");
    await lab.emit("ui_prompt_end"); await tick();
    await command.handler("internalOff", lab.ctx); // Idempotent.
    assert.equal(lab.writes.length, writes, "no terminal graphics are transmitted while hidden");
    assert.deepEqual(command.getArgumentCompletions("debug").map((item: any) => item.value), ["debugOn", "debugOff"]);
    const localBefore = calls.filter(call => call.url.includes("localhost")).length;
    const deviceBefore = calls.filter(call => call.url.includes("matrix")).length;
    await command.handler("debugOff", lab.ctx);
    await lab.emit("tool_execution_start", { toolName: "bash", toolCallId: "b" }); await tick();
    assert.equal(calls.filter(call => call.url.includes("localhost")).length, localBefore);
    const deviceAfter = calls.filter(call => call.url.includes("matrix")).length;
    assert.ok(deviceAfter > deviceBefore, "ESP32 keeps updating with both local outputs off");
    await command.handler("debugOn", lab.ctx); await tick();
    assert.equal(calls.filter(call => call.url.includes("localhost")).length, localBefore + 1);
    assert.equal(calls.filter(call => call.url.includes("matrix")).length, deviceAfter, "ESP32 stream is untouched by debugOn");
    assert.equal(lab.writes.length, writes, "debug commands do not show the internal avatar");
    await command.handler("internalOn", lab.ctx); await tick();
    lab.widgets.render(100);
    assert.ok(lab.editor.render(100).join("\n").includes(PLACEHOLDER));
    assert.ok(lab.writes.length > writes, "graphics resume when re-enabled");
  } finally {
    await lab?.shutdown(); lab?.restore(); globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test("the framed avatar sits beside the prompt, which grows to the frame height", async () => {
  const lab = await boot();
  try {
    await lab.emit("tool_execution_start", { toolName: "bash" });
    assert.deepEqual(lab.widgets.render(100), [], "beside-editor leaves no row above the prompt");

    const lines = lab.editor.render(100).map(plain);
    for (const line of lines) assert.ok(visibleWidth(line) <= 100);
    assert.equal(lines.length, 4, "frameRows (4): the frame and the prompt share the same height");
    assert.ok(lines.every((line) => line.startsWith(PLACEHOLDER)), "the framed image fills every row, no text border rows");
    assert.ok(lines[0]!.includes("waiting for input"), "the prompt is not pushed down: it grows instead");
    assert.ok(lines.slice(2).every((line) => line.includes("┃")), "the blank panel row fills the extra height");
    assert.ok(lab.writes.some((w) => /a=T,f=100,q=2,U=1,i=\d+,c=\d+,r=4/.test(w)), "the frame image is sent 4 rows tall");

    const emote = lab.commands.get("emote");
    assert.ok(emote, "/emote is registered");
    const completions = await emote.getArgumentCompletions("gr");
    assert.deepEqual(completions.map((item: any) => item.value), ["grandma"]);
    const before = lab.writes.length;
    await emote.handler("grandma", lab.ctx);
    assert.ok(lab.writes.length > before, "/emote grandma swaps the frame without the model");

    // The image itself travels out of band as a kitty virtual placement.
    assert.ok(lab.writes.some((w) => w.includes("\x1b_Ga=T") && w.includes("U=1")));
    assert.ok(!lab.writes.some((w) => w.startsWith("\x1bPtmux;")), "no tmux wrapping outside tmux");

    await lab.shutdown();
    assert.ok(!lab.editor.render(100)[0]!.includes(PLACEHOLDER), "shutdown restores the plain prompt");
  } finally {
    await lab.shutdown();
    lab.restore();
  }
});

test("/emote d200Off stops the D200 stream without touching config", async () => {
  const root = mkdtempSync(join(tmpdir(), "emote-d200-"));
  const dir = join(root, ".pi", "extensions", "gentle-emote");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({}));
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(); };
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  let lab: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    lab = await boot(root);
    const emote = lab.commands.get("emote");
    assert.ok(emote, "/emote is registered");

    const completions = await emote.getArgumentCompletions("d200");
    assert.deepEqual(completions.map((item: any) => item.value), ["d200On", "d200Off"]);

    await lab.emit("tool_execution_start", { toolName: "bash" });
    await flush();
    assert.equal(calls.length, 0, "nothing is delivered before d200On");

    await emote.handler("d200On", lab.ctx);
    await lab.emit("tool_execution_start", { toolName: "read" });
    await flush();
    assert.ok(calls.length > 0, "d200On mirrors frames");
    assert.ok(calls.every((call) => call.url === "http://127.0.0.1:8003/emote"));
    assert.equal(new Headers(calls.at(-1)!.init.headers).get("X-Emote-Version"), "1");

    const delivered = calls.length;
    await emote.handler("d200Off", lab.ctx);
    await lab.emit("tool_execution_start", { toolName: "write" });
    await flush();
    assert.equal(calls.length, delivered, "d200Off stops delivery");

    // Output preferences are stored separately; the project's config stays unchanged.
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), {});
  } finally {
    await lab?.shutdown(); lab?.restore(); globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});


test("all outputs default off; independent global switches survive project changes and restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "emote-global-"));
  const profile = join(root, "profile");
  const config = { externalDisplay: { enabled: true, targets: [
    { enabled: true, url: "http://localhost:8000/emote" },
    { enabled: true, url: "http://matrix/emote" },
    { enabled: false, url: "http://disabled/emote" },
  ] } };
  for (const project of ["a", "b"]) {
    const dir = join(root, project, ".pi", "extensions", "gentle-emote");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  }
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(); };
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  let lab: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    lab = await boot(join(root, "a"), [], profile);
    await lab.emit("tool_execution_start", { toolName: "read" }); await flush();
    lab.widgets.render(100);
    assert.equal(calls.length, 0, "configured destinations are silent before explicit On");
    assert.ok(!lab.editor.render(100).join("").includes(PLACEHOLDER));
    assert.ok(!lab.writes.some(write => write.includes("\x1b_G") || write.includes("1337;File=")), "no initial graphics");
    const emote = lab.commands.get("emote");
    assert.deepEqual(emote.getArgumentCompletions("display").map((item: any) => item.value), ["displayOn", "displayOff"]);
    await emote.handler("displayOn", lab.ctx); await flush();
    assert.deepEqual(calls, ["http://matrix/emote"], "displayOn resumes latest frame only on ESP32");
    calls.length = 0;
    await emote.handler("debugOn", lab.ctx); await flush();
    assert.deepEqual(calls, ["http://localhost:8000/emote"]);
    await emote.handler("d200On", lab.ctx); await flush();
    calls.length = 0;
    await emote.handler("displayOff", lab.ctx);
    await lab.emit("tool_execution_start", { toolName: "write" }); await flush();
    assert.ok(calls.includes("http://localhost:8000/emote"));
    assert.ok(calls.includes("http://127.0.0.1:8003/emote"));
    assert.ok(!calls.includes("http://matrix/emote"), "displayOff leaves both local destinations active");
    await emote.handler("internalOn", lab.ctx);
    lab.widgets.render(100);
    assert.ok(lab.editor.render(100).join("").includes(PLACEHOLDER));
    await emote.handler("displayOn", lab.ctx); await flush();
    await lab.shutdown(); lab.restore(); lab = undefined;
    calls.length = 0;
    lab = await boot(join(root, "b"), [], profile);
    await lab.emit("tool_execution_start", { toolName: "read" }); await flush();
    lab.widgets.render(100);
    assert.ok(lab.editor.render(100).join("").includes(PLACEHOLDER), "global internalOn survives restart in another project");
    assert.ok(calls.includes("http://localhost:8000/emote"));
    assert.ok(calls.includes("http://127.0.0.1:8003/emote"));
    assert.ok(calls.includes("http://matrix/emote"), "global displayOn survives restart");
    assert.ok(!calls.includes("http://disabled/emote"), "On never enables disabled destinations");
    for (const output of ["internalOff", "debugOff", "d200Off", "displayOff"]) await lab.commands.get("emote").handler(output, lab.ctx);
    await lab.shutdown(); lab.restore(); lab = undefined;
    calls.length = 0;
    lab = await boot(join(root, "a"), [], profile);
    await lab.emit("tool_execution_start", { toolName: "read" }); await flush();
    lab.widgets.render(100);
    assert.deepEqual(calls, [], "all saved Off states survive restart");
    assert.ok(!lab.editor.render(100).join("").includes(PLACEHOLDER));
    for (const project of ["a", "b"]) assert.deepEqual(JSON.parse(readFileSync(join(root, project, ".pi", "extensions", "gentle-emote", "config.json"), "utf8")), config);
  } finally {
    await lab?.shutdown(); lab?.restore(); globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});


test("failed global save reports an error and leaves the active output and saved data unchanged", async () => {
  const root = mkdtempSync(join(tmpdir(), "emote-save-failure-"));
  const profile = join(root, "profile");
  let lab: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    lab = await boot(root, ["internalOn"], profile);
    lab.widgets.render(100);
    assert.ok(lab.editor.render(100).join("").includes(PLACEHOLDER));
    const path = join(profile, "extensions", "gentle-emote", "output-states", "internal.json");
    writeFileSync(path, "invalid-json");
    const before = lab.writes.length;
    await lab.commands.get("emote").handler("internalOff", lab.ctx);
    lab.widgets.render(100);
    assert.ok(lab.editor.render(100).join("").includes(PLACEHOLDER));
    assert.equal(lab.writes.length, before);
    assert.deepEqual(lab.notices.at(-1), {
      message: "[gentle-emote] cannot save global internal state; output unchanged", level: "error",
    });
    assert.equal(readFileSync(path, "utf8"), "invalid-json");
  } finally {
    await lab?.shutdown(); lab?.restore();
    rmSync(root, { recursive: true, force: true });
  }
});
