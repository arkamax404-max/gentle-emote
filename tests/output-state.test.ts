import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutputStateStore } from "../src/output_state.ts";

const OFF = { internal: false, debug: false, d200: false, display: false };

test("global output preferences default off and preserve each independent saved boolean", () => {
  const root = mkdtempSync(join(tmpdir(), "emote-output-state-"));
  const warnings: string[] = [];
  try {
    const first = new OutputStateStore(root);
    const second = new OutputStateStore(root);
    assert.deepEqual(first.load(message => warnings.push(message)), OFF);
    first.save("internal", true);
    second.save("display", true);
    first.save("debug", true);
    second.save("d200", true);
    first.save("display", false);
    assert.deepEqual(new OutputStateStore(root).load(message => warnings.push(message)), {
      internal: true, debug: true, d200: true, display: false,
    });
    assert.deepEqual(warnings, []);
    const dir = join(root, "extensions", "gentle-emote", "output-states");
    assert.deepEqual(readdirSync(dir).sort(), ["d200.json", "debug.json", "display.json", "internal.json"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("invalid or unreadable saved output state fails closed and is not overwritten", () => {
  const root = mkdtempSync(join(tmpdir(), "emote-output-invalid-"));
  const dir = join(root, "extensions", "gentle-emote", "output-states");
  mkdirSync(dir, { recursive: true });
  try {
    const store = new OutputStateStore(root);
    for (const text of ["{broken", "null", "1", '"true"']) {
      writeFileSync(join(dir, "display.json"), text);
      const warnings: string[] = [];
      assert.deepEqual(store.load(message => warnings.push(message)), OFF);
      assert.deepEqual(warnings, ["cannot read saved display state; output stays off"]);
      assert.throws(() => store.save("display", true));
      assert.equal(readFileSync(join(dir, "display.json"), "utf8"), text);
      assert.deepEqual(readdirSync(dir), ["display.json"], "no partial write or temporary remains");
    }
    rmSync(join(dir, "display.json"));
    mkdirSync(join(dir, "display.json"));
    const warnings: string[] = [];
    assert.deepEqual(store.load(message => warnings.push(message)), OFF);
    assert.equal(warnings.length, 1);
    assert.throws(() => store.save("display", true));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
