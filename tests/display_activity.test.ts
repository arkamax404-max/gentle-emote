import { test } from "node:test";
import assert from "node:assert/strict";
import { DisplayActivityTracker } from "../src/display_activity.ts";
import type { DisplayActivity } from "../src/external_display.ts";

test("tracks concurrent subagent calls by ID, ignores other tools and resets", () => {
  const snapshots: DisplayActivity[] = [];
  const tracker = new DisplayActivityTracker(activity => snapshots.push(activity));
  tracker.toolStart("subagent_run", "a");
  tracker.toolStart("subagent_run", "a");
  tracker.toolStart("mcp__gentle__subagent_continue", "b");
  tracker.toolStart("read", "c");
  assert.equal(snapshots.at(-1)!.activeSubagents, 2);
  tracker.toolEnd("c", false);
  assert.equal(snapshots.at(-1)!.activeSubagents, 2);
  tracker.toolEnd("a", true);
  assert.deepEqual(snapshots.at(-1), { status: "error", phase: "executing", activeSubagents: 1 });
  tracker.toolEnd("b", false);
  assert.deepEqual(snapshots.at(-1), { status: "busy", phase: "thinking", activeSubagents: 0 });
  tracker.reset();
  assert.deepEqual(snapshots.at(-1), { status: "idle", phase: "idle", activeSubagents: 0 });
});
