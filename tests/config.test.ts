import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLayeredConfig } from "../src/config.ts";
import { normalizeExternalDisplay } from "../src/external_display.ts";

test("external display defaults off, layered fields merge, existing size and terminal behavior preserved", () => {
  const root = mkdtempSync(join(tmpdir(), "emote-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const ext = join(root, "extension"), agent = join(root, "agent"), project = join(root, "project");
  const userConfig = join(agent, "extensions", "gentle-emote");
  const localConfig = join(project, ".pi", "extensions", "gentle-emote");
  for (const dir of [ext, userConfig, localConfig]) mkdirSync(dir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    assert.deepEqual(loadLayeredConfig(ext, project).config.externalDisplay, { enabled: false, url: "", timeoutMs: 1000 });
    writeFileSync(join(ext, "config.json"), JSON.stringify({ externalDisplay: { enabled: true, url: "http://127.0.0.1:8000/emote" }, size: 12 }));
    writeFileSync(join(userConfig, "config.json"), JSON.stringify({ externalDisplay: { timeoutMs: 500 }, terminals: [{ match: "tmux", render: "ascii" }] }));
    writeFileSync(join(localConfig, "config.json"), JSON.stringify({ externalDisplay: { url: "https://localhost/emote" }, size: 14 }));
    const { config, userConfiguredTerminals } = loadLayeredConfig(ext, project);
    assert.deepEqual(normalizeExternalDisplay(config.externalDisplay), { enabled: true, url: "https://localhost/emote", timeoutMs: 500 });
    assert.equal(config.size, 14);
    assert.equal(config.terminals.find(entry => entry.match === "tmux")?.render, "ascii");
    assert.ok(userConfiguredTerminals.has("tmux"));
    const simulator = { enabled: true, url: "http://127.0.0.1:8000/emote" };
    const device = { enabled: true, url: "http://gentle-matrix.local/emote", timeoutMs: 750 };
    writeFileSync(join(userConfig, "config.json"), JSON.stringify({ externalDisplay: { targets: [simulator, device] } }));
    writeFileSync(join(localConfig, "config.json"), JSON.stringify({ externalDisplay: { targets: [device] } }));
    assert.deepEqual(loadLayeredConfig(ext, project).config.externalDisplay.targets, [device], "project array replaces user destinations");
    writeFileSync(join(localConfig, "config.json"), JSON.stringify({ externalDisplay: null }));
    const invalid = loadLayeredConfig(ext, project).config;
    assert.equal(normalizeExternalDisplay(invalid.externalDisplay), null);
    assert.equal(invalid.size, 12);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
