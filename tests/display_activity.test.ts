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

test("the optional work phase rides along, is omitted when absent and rejects invalid detail", () => {
  const snapshots: DisplayActivity[] = [];
  const tracker = new DisplayActivityTracker(activity => snapshots.push(activity));
  tracker.set("busy", "thinking");
  assert.deepEqual(snapshots.at(-1), { status: "busy", phase: "thinking", activeSubagents: 0 }, "no workPhase key when absent");

  tracker.setWorkPhase("planning");
  assert.deepEqual(snapshots.at(-1), { status: "busy", phase: "thinking", activeSubagents: 0, workPhase: "planning" });
  tracker.setWorkPhase("planning");
  assert.equal(snapshots.length, 2, "the same work phase is not re-emitted");

  tracker.setWorkPhase(null);
  assert.deepEqual(snapshots.at(-1), { status: "busy", phase: "thinking", activeSubagents: 0 }, "null clears and omits the field");

  // An invalid detail never mutates or emits, and never leaks into later activity.
  const before = snapshots.length;
  (tracker as any).setWorkPhase("scheming");
  assert.equal(snapshots.length, before);
  tracker.toolStart("read", "r");
  assert.ok(snapshots.slice(before).every(activity => activity.workPhase === undefined));

  tracker.reset();
  tracker.setWorkPhase("implementing");
  assert.deepEqual(tracker.snapshot(), { status: "idle", phase: "idle", activeSubagents: 0, workPhase: "implementing" }, "a destination enabled mid-session starts with the detail");
  tracker.reset();
  assert.deepEqual(snapshots.at(-1), { status: "idle", phase: "idle", activeSubagents: 0 }, "reset clears the work phase");
});
