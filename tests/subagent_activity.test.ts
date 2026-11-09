import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUBAGENT_NOTIFICATION_CHANNEL,
  SubagentTaskTracker,
  parseSubagentEvent,
} from "../src/subagent_activity.ts";
import { DisplayActivityTracker } from "../src/display_activity.ts";
import type { DisplayActivity } from "../src/external_display.ts";

const SESSION = "session-1";

/** A valid native notification, overridable per field for malformed cases. */
const notification = (overrides: Record<string, unknown> = {}) => ({
  source: "subagent",
  producerId: "producer-1",
  sessionId: SESSION,
  parentSessionId: SESSION,
  taskId: "task-1",
  status: "queued",
  runId: "producer-1:run-1",
  sequence: 1,
  event: "subagent.queued",
  occurredAt: 12.5,
  ...overrides,
});

/** Minimal bus shape matching pi.events.on; deliveries are synchronous. */
function bus() {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  return {
    handlers,
    on(channel: string, handler: (payload: unknown) => void) {
      handlers.set(channel, [...(handlers.get(channel) ?? []), handler]);
      return () => handlers.set(channel, (handlers.get(channel) ?? []).filter(h => h !== handler));
    },
    emit(channel: string, payload: unknown) {
      for (const handler of [...(handlers.get(channel) ?? [])]) handler(payload);
    },
  };
}

const terminal = (status: string, overrides: Record<string, unknown> = {}) =>
  notification({ status, event: `subagent.${status}`, ...overrides });

test("parseSubagentEvent validates the documented contract and rejects everything else", () => {
  assert.deepEqual(parseSubagentEvent(notification()), {
    producerId: "producer-1",
    sessionId: SESSION,
    taskId: "task-1",
    runId: "producer-1:run-1",
    status: "queued",
    sequence: 1,
  });
  for (const status of ["completed", "failed", "cancelled", "timed_out"]) {
    assert.equal(parseSubagentEvent(terminal(status))?.status, status, `${status} is a terminal status`);
  }
  assert.equal(parseSubagentEvent(terminal("waiting"))?.status, "waiting", "waiting is active");

  const rejects: Array<[string, unknown]> = [
    ["non-object payload", null],
    ["array payload", [notification()]],
    ["wrong source", notification({ source: "tool" })],
    ["missing source", notification({ source: undefined })],
    ["unknown status", notification({ status: "restarted", event: "subagent.restarted" })],
    ["status/event mismatch", notification({ event: "subagent.failed" })],
    ["empty producerId", notification({ producerId: "" })],
    ["non-string sessionId", notification({ sessionId: 7 })],
    ["missing taskId", notification({ taskId: undefined })],
    ["missing parentSessionId", notification({ parentSessionId: undefined })],
    ["mismatched parentSessionId", notification({ parentSessionId: "other-session" })],
    ["runId without producer prefix", notification({ runId: "other:run-1" })],
    ["bare producer-prefixed runId", notification({ runId: "producer-1:" })],
    ["zero sequence", notification({ sequence: 0 })],
    ["negative sequence", notification({ sequence: -2 })],
    ["non-integer sequence", notification({ sequence: 1.5 })],
    ["unsafe sequence", notification({ sequence: Number.MAX_SAFE_INTEGER + 1 })],
    ["negative occurredAt", notification({ occurredAt: -1 })],
    ["NaN occurredAt", notification({ occurredAt: Number.NaN })],
    ["infinite occurredAt", notification({ occurredAt: Number.POSITIVE_INFINITY })],
    ["non-number occurredAt", notification({ occurredAt: "12" })],
  ];
  for (const [label, payload] of rejects) {
    assert.equal(parseSubagentEvent(payload), null, label);
  }
});

test("queued/running/waiting count once and every terminal status decrements to zero", () => {
  let changes: Array<number | null> = [];
  const tracker = new SubagentTaskTracker(count => changes.push(count));
  const b = bus();
  tracker.attach(b, SESSION);
  assert.equal(tracker.activeCount(), null, "no observed lifecycle yet");

  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", sequence: 1 }));
  assert.equal(tracker.activeCount(), 1, "queued counts");
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", status: "running", event: "subagent.running", sequence: 2 }));
  assert.equal(tracker.activeCount(), 1, "running is still one task");
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", status: "waiting", event: "subagent.waiting", sequence: 3 }));
  assert.equal(tracker.activeCount(), 1, "waiting counts the same task once");
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t2", sequence: 1 }));
  assert.equal(tracker.activeCount(), 2, "two concurrent tasks");

  for (const [index, status] of ["completed", "failed", "cancelled", "timed_out"].entries()) {
    b.emit(SUBAGENT_NOTIFICATION_CHANNEL, terminal(status, { taskId: index < 2 ? "t2" : "t1", sequence: 10 + index }));
    assert.equal(tracker.activeCount(), index < 2 ? 1 : 0, `${status} decrements`);
  }
  assert.ok(changes.at(-1) === 0, "the count is published on every transition");
});

test("duplicate and out-of-order events never inflate, and terminals never resurrect", () => {
  let changes: Array<number | null> = [];
  const tracker = new SubagentTaskTracker(count => changes.push(count));
  const b = bus();
  tracker.attach(b, SESSION);

  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", sequence: 5 }));
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", sequence: 5 }), );
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", status: "running", event: "subagent.running", sequence: 3 }));
  assert.equal(tracker.activeCount(), 1, "duplicate and older sequences are ignored");
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t2", sequence: 4 }));
  assert.equal(tracker.activeCount(), 2);
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, terminal("completed", { taskId: "t2", sequence: 9 }));
  assert.equal(tracker.activeCount(), 1);
  // A stale or duplicated running event with a higher sequence after the terminal
  // must not resurrect the finished task (a continuation gets a new task id).
  const published = changes.length;
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t2", status: "running", event: "subagent.running", sequence: 30 }));
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t2", sequence: 31 }));
  assert.equal(tracker.activeCount(), 1, "a terminal identity is closed for good");
  assert.equal(changes.length, published, "resurrection attempts publish nothing");
  // A terminal for a task we never saw must not push the count negative.
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, terminal("cancelled", { taskId: "never-seen", sequence: 40 }));
  assert.equal(tracker.activeCount(), 1);
  assert.ok(tracker.activeCount()! >= 0, "the count never goes negative");
  assert.equal(changes.length, published, "an unknown-terminal event publishes no count change");
});

test("foreign-session, wrong-source and malformed events are no-ops", () => {
  let changes: Array<number | null> = [];
  const tracker = new SubagentTaskTracker(count => changes.push(count));
  const b = bus();
  tracker.attach(b, SESSION);
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", sessionId: "another-session" }));
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", source: "tool" }));
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", sequence: 0 }));
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, "subagent.running");
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, undefined);
  assert.equal(tracker.activeCount(), null, "nothing observed, counters unchanged");
  assert.deepEqual(changes, [], "no change was published");
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1" }));
  assert.equal(tracker.activeCount(), 1, "a valid event still works after the rejects");
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", sessionId: "another-session", sequence: 2 }));
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, terminal("completed", { taskId: "t1", sessionId: "another-session", sequence: 3 }));
  assert.equal(tracker.activeCount(), 1, "foreign completions cannot clear a local task");
  // The host contract enforces parentSessionId === sessionId: a mismatched
  // parent is malformed even when its sessionId is the current one.
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", status: "running", event: "subagent.running", sequence: 4, parentSessionId: "another-session" }));
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", sequence: 5, parentSessionId: "" }));
  assert.equal(tracker.activeCount(), 1, "mismatched-parent events cannot mutate the counter");
});

test("a session change forgets tasks and old-session events are ignored afterwards", () => {
  let changes: Array<number | null> = [];
  const tracker = new SubagentTaskTracker(count => changes.push(count));
  const b = bus();
  tracker.attach(b, SESSION);
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1" }));
  assert.equal(tracker.activeCount(), 1);

  tracker.setSession("session-2");
  assert.equal(tracker.activeCount(), null, "the new session starts unobserved");
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, terminal("completed", { taskId: "t1", sequence: 2 }));
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t2", sequence: 3 }));
  assert.equal(tracker.activeCount(), null, "old-session events cannot repopulate");

  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t3", sessionId: "session-2", parentSessionId: "session-2", sequence: 4 }));
  assert.equal(tracker.activeCount(), 1, "the new session's own events count");

  tracker.attach(b, "session-3");
  assert.equal(tracker.activeCount(), null, "re-attaching with a new session re-scopes");
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t3", sessionId: "session-2", parentSessionId: "session-2", sequence: 5 }));
  assert.equal(tracker.activeCount(), null);
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t4", sessionId: "session-3", parentSessionId: "session-3", sequence: 6 }));
  assert.equal(tracker.activeCount(), 1);
});

test("dispose unsubscribes, clears the count and ignores later events", () => {
  let changes: Array<number | null> = [];
  const tracker = new SubagentTaskTracker(count => changes.push(count));
  const b = bus();
  tracker.attach(b, SESSION);
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1" }));
  assert.equal(tracker.activeCount(), 1);

  tracker.dispose();
  assert.equal(tracker.activeCount(), null);
  assert.deepEqual(changes.at(-1), null);
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", status: "completed", event: "subagent.completed", sequence: 2 }));
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t2", sequence: 3 }));
  assert.equal(tracker.activeCount(), null);
  assert.equal(changes.length, 2, "no change published after dispose");
});

test("the display falls back to tool calls without the bus and native tasks win once observed", () => {
  const snapshots: DisplayActivity[] = [];
  const display = new DisplayActivityTracker(activity => snapshots.push(activity));
  const tracker = new SubagentTaskTracker(count => display.setNativeSubagents(count));
  const b = bus();
  tracker.attach(b, SESSION);

  // No native event yet: the historical call-based behavior stays byte-for-byte.
  display.toolStart("subagent_run", "call-1");
  assert.equal(display.snapshot().activeSubagents, 1);
  display.toolStart("mcp__gentle__subagent_continue", "call-2");
  assert.equal(display.snapshot().activeSubagents, 2);
  display.toolEnd("call-1", true);
  assert.equal(display.snapshot().activeSubagents, 1);
  display.toolEnd("call-2", false);
  assert.equal(display.snapshot().activeSubagents, 0);
  display.reset();
  assert.equal(display.snapshot().activeSubagents, 0);

  // Once the native lifecycle is observed its count is authoritative and is
  // not summed with open tool calls.
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t1", sequence: 1 }));
  assert.equal(display.snapshot().activeSubagents, 1);
  display.toolStart("subagent_run", "call-3");
  assert.equal(display.snapshot().activeSubagents, 1, "native is authoritative, calls are not summed");
  display.toolEnd("call-3", false);
  assert.equal(display.snapshot().activeSubagents, 1);
  display.reset();
  assert.equal(display.snapshot().activeSubagents, 1, "the native count survives turn resets (agent boundaries)");
  display.set("idle", "idle");
  assert.equal(display.snapshot().activeSubagents, 1);

  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, terminal("completed", { taskId: "t1", sequence: 2 }));
  assert.equal(display.snapshot().activeSubagents, 0);
  // An invalid native count never mutates the snapshot.
  display.setNativeSubagents(-1);
  display.setNativeSubagents(1.5);
  assert.equal(display.snapshot().activeSubagents, 0);

  // A session change clears the native count back to the call-based fallback.
  b.emit(SUBAGENT_NOTIFICATION_CHANNEL, notification({ taskId: "t9", sequence: 3 }));
  tracker.setSession("session-2");
  assert.equal(display.snapshot().activeSubagents, 0, "fallback shows the (empty) call counter again");
  display.toolStart("subagent_run", "call-4");
  assert.equal(display.snapshot().activeSubagents, 1, "call-based counting resumes after the session change");
});

test("a host without a usable bus keeps the call-based fallback untouched", () => {
  const snapshots: DisplayActivity[] = [];
  const display = new DisplayActivityTracker(activity => snapshots.push(activity));
  const tracker = new SubagentTaskTracker(count => display.setNativeSubagents(count));
  tracker.attach(undefined, SESSION);
  tracker.attach({ on: "not-a-function" }, SESSION);
  tracker.setSession("session-2");
  display.toolStart("subagent_run", "call-1");
  assert.equal(display.snapshot().activeSubagents, 1);
  display.toolEnd("call-1", false);
  assert.equal(display.snapshot().activeSubagents, 0);
  assert.equal(tracker.activeCount(), null);
  tracker.dispose();
});
