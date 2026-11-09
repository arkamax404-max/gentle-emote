import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ODD_PHASE_CHANGE_EVENT,
  ODD_PHASE_CHANGE_SCHEMA,
  ODD_PHASE_CURRENT_EVENT,
  ODD_PHASE_CURRENT_SCHEMA,
  WORK_PHASES,
  WorkPhaseTracker,
  isWorkPhase,
  parseWorkPhaseSnapshot,
} from "../src/work_phase.ts";
import type { WorkPhase } from "../src/work_phase.ts";

const SNAPSHOT = { schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s1", phase: "planning", source: "explicit" };

function fakeBus() {
  const handlers = new Map<string, Array<(data: unknown) => void>>();
  const sent: Array<{ channel: string; payload: any }> = [];
  const bus = {
    emit: (channel: string, payload: unknown) => { sent.push({ channel, payload }); },
    on: (channel: string, handler: (data: unknown) => void) => {
      handlers.set(channel, [...(handlers.get(channel) ?? []), handler]);
      return () => handlers.set(channel, (handlers.get(channel) ?? []).filter(existing => existing !== handler));
    },
  };
  return {
    bus,
    sent,
    handlers,
    emitChange: (payload: unknown) => { for (const handler of handlers.get(ODD_PHASE_CHANGE_EVENT) ?? []) handler(payload); },
  };
}

test("the phase set matches the host ODD phases", () => {
  assert.deepEqual([...WORK_PHASES], [
    "authorizing", "exploring", "researching", "deciding", "planning", "implementing", "checking", "closing",
  ]);
  assert.equal(isWorkPhase("planning"), true);
  assert.equal(isWorkPhase("thinking"), false);
  assert.equal(isWorkPhase(null), false);
});

test("only the documented snapshot shape is accepted", () => {
  for (const phase of WORK_PHASES) {
    assert.deepEqual(
      parseWorkPhaseSnapshot({ ...SNAPSHOT, phase, source: "inferred" }),
      { sessionId: "s1", phase, source: "inferred" },
      phase,
    );
    assert.deepEqual(
      parseWorkPhaseSnapshot({ ...SNAPSHOT, phase, source: "explicit" }),
      { sessionId: "s1", phase, source: "explicit" },
      phase,
    );
  }
  assert.deepEqual(parseWorkPhaseSnapshot({ ...SNAPSHOT, phase: null, source: null }), { sessionId: "s1", phase: null, source: null });
  for (const bad of [
    undefined, null, "snapshot", 42, [], {},
    { ...SNAPSHOT, schema: "gentle-pi.odd-phase/v2" },
    { ...SNAPSHOT, schema: ODD_PHASE_CURRENT_SCHEMA },
    { phase: "planning", source: "explicit" },
    { ...SNAPSHOT, sessionId: "" },
    { ...SNAPSHOT, sessionId: 7 },
    { ...SNAPSHOT, phase: "scheming" },
    { schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s1", phase: "planning" },
    { ...SNAPSHOT, source: "guessed" },
    { ...SNAPSHOT, phase: null, source: "explicit" },
    { ...SNAPSHOT, phase: "planning", source: null },
    { schema: ODD_PHASE_CHANGE_SCHEMA },
  ] as unknown[]) {
    assert.equal(parseWorkPhaseSnapshot(bad), null, JSON.stringify(bad));
  }
});

test("change events for the attached session update and clear the phase; everything else never mutates", () => {
  const changes: Array<WorkPhase | null> = [];
  const tracker = new WorkPhaseTracker(phase => changes.push(phase));
  const fake = fakeBus();
  tracker.attach(fake.bus, "s1");
  assert.equal(tracker.current(), null);

  fake.emitChange({ ...SNAPSHOT, phase: "implementing", source: "inferred" });
  assert.equal(tracker.current(), "implementing");
  assert.deepEqual(changes, ["implementing"]);

  // The same phase with a different source does not re-notify: nothing visible changed.
  fake.emitChange({ ...SNAPSHOT, phase: "implementing", source: "explicit" });
  assert.deepEqual(changes, ["implementing"]);

  fake.emitChange({ ...SNAPSHOT, phase: null, source: null });
  assert.equal(tracker.current(), null);
  assert.deepEqual(changes, ["implementing", null]);

  // Foreign sessions, malformed phases, mismatched clears and wrong schemas never mutate.
  fake.emitChange({ ...SNAPSHOT, phase: "implementing", source: "inferred" });
  assert.equal(tracker.current(), "implementing");
  fake.emitChange({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "other", phase: "closing", source: "explicit" });
  fake.emitChange({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "other", phase: null, source: null });
  fake.emitChange({ ...SNAPSHOT, phase: "scheming", source: "inferred" });
  fake.emitChange({ ...SNAPSHOT, phase: null, source: "explicit" });
  fake.emitChange({ schema: "gentle-pi.odd-phase/v2", sessionId: "s1", phase: null, source: null });
  fake.emitChange(undefined);
  assert.equal(tracker.current(), "implementing");
  assert.deepEqual(changes, ["implementing", null, "implementing"]);

  // A clear after the re-set above is a real change; clearing again is not.
  fake.emitChange({ ...SNAPSHOT, phase: null, source: null });
  assert.deepEqual(changes, ["implementing", null, "implementing", null]);
  fake.emitChange({ ...SNAPSHOT, phase: null, source: null });
  assert.deepEqual(changes, ["implementing", null, "implementing", null]);
});

test("the handshake request is synchronous and stale, foreign or disposed answers are ignored", () => {
  const changes: Array<WorkPhase | null> = [];
  const tracker = new WorkPhaseTracker(phase => changes.push(phase));
  const fake = fakeBus();
  tracker.attach(fake.bus, "s1");
  const request = fake.sent.find(entry => entry.channel === ODD_PHASE_CURRENT_EVENT)!.payload;
  assert.equal(request.schema, ODD_PHASE_CURRENT_SCHEMA);
  assert.equal(request.sessionId, "s1");
  assert.equal(typeof request.respond, "function");

  request.respond({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s1", phase: "checking", source: "explicit" });
  assert.equal(tracker.current(), "checking");

  // A newer request invalidates the previous responder.
  tracker.setSession("s1");
  const newer = fake.sent.at(-1)!.payload;
  assert.equal(newer.schema, ODD_PHASE_CURRENT_SCHEMA);
  request.respond({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s1", phase: "closing", source: "explicit" });
  assert.equal(tracker.current(), "checking", "a stale handshake answer cannot override the current state");
  newer.respond({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s1", phase: "closing", source: "explicit" });
  assert.equal(tracker.current(), "closing");

  // A change event observed after the request also invalidates its pending answer.
  fake.emitChange({ ...SNAPSHOT, phase: "planning", source: "inferred" });
  assert.equal(tracker.current(), "planning");
  newer.respond({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s1", phase: "closing", source: "explicit" });
  assert.equal(tracker.current(), "planning", "a late handshake answer cannot undo a newer change event");

  newer.respond({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "elsewhere", phase: "authorizing", source: "explicit" });
  assert.equal(tracker.current(), "planning");

  tracker.dispose();
  newer.respond({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s1", phase: "authorizing", source: "explicit" });
  assert.equal(tracker.current(), null, "a disposed tracker never applies late answers");
  assert.deepEqual(changes, ["checking", "closing", "planning"]);
});

test("a CURRENT handshake null clears a stored phase; stale or disposed responders cannot clear", () => {
  const changes: Array<WorkPhase | null> = [];
  const tracker = new WorkPhaseTracker(phase => changes.push(phase));
  const fake = fakeBus();
  tracker.attach(fake.bus, "s1");
  const first = fake.sent.find(entry => entry.channel === ODD_PHASE_CURRENT_EVENT)!.payload;

  // The host answers null for "no state"; with nothing stored there is nothing to clear.
  first.respond(null);
  assert.deepEqual(changes, []);

  first.respond({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s1", phase: "checking", source: "explicit" });
  assert.equal(tracker.current(), "checking");

  // A newer request invalidates the first responder: its null answer cannot clear.
  tracker.setSession("s1");
  const newer = fake.sent.at(-1)!.payload;
  first.respond(null);
  assert.equal(tracker.current(), "checking", "a stale handshake answer cannot clear");

  // The current responder's null clears the stored phase exactly once.
  newer.respond(null);
  assert.equal(tracker.current(), null);
  assert.deepEqual(changes, ["checking", null]);
  newer.respond(null);
  assert.deepEqual(changes, ["checking", null], "a repeated null answer is a no-op when nothing is stored");

  // The change channel stays strict: a bare null broadcast never clears or mutates.
  fake.emitChange(null);
  fake.emitChange(undefined);
  assert.deepEqual(changes, ["checking", null]);
  assert.equal(tracker.current(), null);

  tracker.dispose();
  newer.respond(null);
  assert.equal(tracker.current(), null);
  assert.deepEqual(changes, ["checking", null], "a disposed responder cannot clear");
});

test("re-attaching re-scopes the session and replaces the subscription; dispose unsubscribes", () => {
  const changes: Array<WorkPhase | null> = [];
  const tracker = new WorkPhaseTracker(phase => changes.push(phase));
  const fake = fakeBus();
  tracker.attach(fake.bus, "s1");
  tracker.attach(fake.bus, "s2");
  assert.equal(fake.handlers.get(ODD_PHASE_CHANGE_EVENT)!.length, 1, "the previous subscription was removed");

  fake.emitChange({ ...SNAPSHOT, phase: "planning", source: "explicit" });
  assert.equal(tracker.current(), null, "the previous session id no longer applies");
  fake.emitChange({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s2", phase: "exploring", source: "inferred" });
  assert.equal(tracker.current(), "exploring");

  tracker.dispose();
  assert.equal(fake.handlers.get(ODD_PHASE_CHANGE_EVENT)!.length, 0);
  fake.emitChange({ schema: ODD_PHASE_CHANGE_SCHEMA, sessionId: "s2", phase: "planning", source: "inferred" });
  assert.equal(tracker.current(), null);
  assert.deepEqual(changes, ["exploring"], "only real phase changes notify");
});

test("a missing or malformed bus and throwing emits never break the tracker", () => {
  const tracker = new WorkPhaseTracker(() => {});
  tracker.attach(undefined, "s1");
  tracker.attach(null, "s1");
  tracker.attach({}, "s1");
  tracker.attach({ on: "no" }, "s1");
  tracker.attach({ on: () => () => {} }, "s1");
  tracker.attach({ emit: () => {} }, "s1");
  assert.equal(tracker.current(), null);
  tracker.attach({ emit: () => { throw Error("bus down"); }, on: () => () => {} }, "s1");
  tracker.setSession("s1");
  assert.equal(tracker.current(), null);
  tracker.dispose();
});
