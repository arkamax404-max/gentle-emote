/**
 * Consumer side of the Gentle Shell native subagent task lifecycle bus
 * (lib/notification-events.ts in the host repository, channel
 * `gentle-pi:notification:source`). The host publishes every task transition
 * for its own session: statuses `queued`/`running`/`waiting` are ACTIVE,
 * `completed`/`failed`/`cancelled`/`timed_out` are TERMINAL. Restore is
 * silent — there is no snapshot, replay or current-tasks API — so tasks that
 * were queued before subscription are unknown until their next emitted
 * transition, and a reload starts unobserved.
 *
 * This module only observes content-free task identities (producerId, runId,
 * taskId) and statuses: never transcript text, tool arguments or paths.
 */

export const SUBAGENT_NOTIFICATION_CHANNEL = "gentle-pi:notification:source";

const ACTIVE_STATUSES = ["queued", "running", "waiting"] as const;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "timed_out"] as const;

export type SubagentTaskStatus =
  | (typeof ACTIVE_STATUSES)[number]
  | (typeof TERMINAL_STATUSES)[number];

export interface ParsedSubagentEvent {
  producerId: string;
  sessionId: string;
  taskId: string;
  runId: string;
  status: SubagentTaskStatus;
  sequence: number;
}

/** A nonempty host identifier string; narrows the value for real type checking. */
function identity(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Validates a native notification against the documented contract. Anything
 * else — wrong source, a parentSessionId that differs from the event's own
 * sessionId, unknown status, a status/event mismatch, a runId that does not
 * belong to the producer, a non-positive or unsafe sequence, a
 * missing or non-finite occurredAt — is rejected with null and must never
 * mutate consumer state.
 */
export function parseSubagentEvent(payload: unknown): ParsedSubagentEvent | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { source, producerId, sessionId, parentSessionId, taskId, runId, status, event, sequence, occurredAt } =
    payload as Record<string, unknown>;
  if (source !== "subagent") return null;
  if (!identity(producerId) || !identity(sessionId) || !identity(parentSessionId) || !identity(taskId) || !identity(runId)) return null;
  if (parentSessionId !== sessionId) return null;
  const statusText = typeof status === "string" ? status : "";
  if (!(ACTIVE_STATUSES as readonly string[]).includes(statusText) && !(TERMINAL_STATUSES as readonly string[]).includes(statusText)) return null;
  if (event !== `subagent.${statusText}`) return null;
  if (!runId.startsWith(`${producerId}:`) || runId === `${producerId}:`) return null;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence <= 0) return null;
  if (typeof occurredAt !== "number" || !Number.isFinite(occurredAt) || occurredAt < 0) return null;
  return { producerId, sessionId, taskId, runId, status: statusText as SubagentTaskStatus, sequence };
}

/** Minimal shape of the shared pi.events bus; only the subscription is needed. */
export interface NotificationBus {
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export type NativeSubagentCount = number | null;

/**
 * Tracks the active native subagent tasks of one session. The count is keyed
 * by task identity (producerId + taskId, so host instances cannot collide)
 * with the last accepted sequence per identity: duplicates and older updates
 * are ignored, and once a terminal was accepted the identity is closed for
 * good — a later event can never resurrect it (continuations get a new task
 * id). A terminal for an unknown task is a no-op that never goes negative.
 *
 * The reported count is null until a genuine native event was observed for
 * the current session, so hosts without this bus keep the call-based
 * fallback. Only an actual session change (or dispose) forgets the tasks;
 * turn boundaries leave them alone.
 */
export class SubagentTaskTracker {
  private tasks = new Map<string, number>(); // identity -> last accepted sequence
  private terminal = new Set<string>(); // identities whose terminal already landed
  private bus: NotificationBus | null = null;
  private sessionId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private observed = false;

  private readonly onChange: (count: NativeSubagentCount) => void;

  constructor(onChange: (count: NativeSubagentCount) => void) {
    this.onChange = onChange;
  }

  /** Active native task count, or null while no lifecycle was observed for this session. */
  activeCount(): NativeSubagentCount {
    return this.observed ? this.tasks.size : null;
  }

  /** Subscribe and scope to a session; safe to call again with the same session. */
  attach(bus: unknown, sessionId: string | null | undefined): void {
    const candidate = bus as NotificationBus | null | undefined;
    if (!candidate || typeof candidate.on !== "function") return;
    this.unsubscribe?.();
    this.disposed = false;
    this.bus = candidate;
    this.adoptSession(sessionId);
    this.unsubscribe = this.bus.on(SUBAGENT_NOTIFICATION_CHANNEL, payload => {
      if (this.disposed) return;
      this.apply(payload);
    });
  }

  /** Re-scope to a (possibly newly known) session; a real change forgets every task. */
  setSession(sessionId: string | null | undefined): void {
    if (this.disposed || !this.bus) return;
    this.adoptSession(sessionId);
  }

  /** Stop observing; the count reports null again and later events are ignored. */
  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.bus = null;
    this.forgetTasks();
  }

  private forgetTasks(): void {
    this.tasks.clear();
    this.terminal.clear();
    const wasObserved = this.observed;
    this.observed = false;
    if (wasObserved) this.onChange(null);
  }

  private adoptSession(sessionId: string | null | undefined): void {
    const next = sessionId ?? null;
    if (next === this.sessionId) return;
    this.sessionId = next;
    this.forgetTasks();
  }

  private apply(payload: unknown): void {
    const parsed = parseSubagentEvent(payload);
    if (!parsed || this.sessionId === null || parsed.sessionId !== this.sessionId) return;
    const key = `${parsed.producerId}\u0000${parsed.taskId}`;
    if (this.terminal.has(key)) return;
    const last = this.tasks.get(key);
    if (last !== undefined && parsed.sequence <= last) return;
    const before = this.observed ? this.tasks.size : null;
    this.observed = true;
    if ((ACTIVE_STATUSES as readonly string[]).includes(parsed.status)) {
      this.tasks.set(key, parsed.sequence);
    } else {
      this.tasks.delete(key);
      this.terminal.add(key);
    }
    // Publish only real changes: duplicates, older updates and terminals for
    // unknown tasks never move the count (and never go negative).
    if (this.tasks.size !== before) this.onChange(this.tasks.size);
  }
}
