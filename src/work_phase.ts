/**
 * Consumer side of the Gentle Shell ODD phase bus (docs/gentle-shell.md
 * "ODD phase bus" in the host repository, lib/odd-phase.ts). The host
 * publishes every real phase change for its own active session and answers
 * a synchronous current-phase handshake with the same snapshot shape. This
 * module only observes that signal — no second set of tool heuristics — and
 * treats it as display detail: without Gentle Shell the emote keeps its
 * coarse activity labels.
 */

export const ODD_PHASE_CHANGE_EVENT = "gentle-pi:odd-phase/v1";
export const ODD_PHASE_CHANGE_SCHEMA = "gentle-pi.odd-phase/v1";
export const ODD_PHASE_CURRENT_EVENT = "gentle-pi:odd-phase-current/v1";
export const ODD_PHASE_CURRENT_SCHEMA = "gentle-pi.odd-phase-current/v1";

/** The eight host ODD phases, or null at turn and session boundaries. */
export const WORK_PHASES = [
  "authorizing",
  "exploring",
  "researching",
  "deciding",
  "planning",
  "implementing",
  "checking",
  "closing",
] as const;

export type WorkPhase = (typeof WORK_PHASES)[number];
export type WorkPhaseSource = "explicit" | "inferred";

export function isWorkPhase(value: unknown): value is WorkPhase {
  return typeof value === "string" && (WORK_PHASES as readonly string[]).includes(value);
}

/** Minimal shape of the shared pi.events bus; both methods are checked at runtime. */
export interface WorkPhaseBus {
  emit(channel: string, payload: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface ParsedWorkPhaseSnapshot {
  sessionId: string;
  phase: WorkPhase | null;
  source: WorkPhaseSource | null;
}

/**
 * Validates a change event or handshake answer against the documented
 * contract. Anything else — wrong schema, missing or empty session id,
 * unknown phase or source, a clear that keeps a source, a phase without a
 * source — is rejected with null and must never mutate consumer state.
 */
export function parseWorkPhaseSnapshot(payload: unknown): ParsedWorkPhaseSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const { schema, sessionId, phase, source } = payload as Record<string, unknown>;
  if (schema !== ODD_PHASE_CHANGE_SCHEMA) return null;
  if (typeof sessionId !== "string" || sessionId === "") return null;
  if (phase === null && source === null) return { sessionId, phase: null, source: null };
  if (isWorkPhase(phase) && (source === "explicit" || source === "inferred")) {
    return { sessionId, phase, source };
  }
  return null;
}

/**
 * Keeps the current ODD work phase for this session. Snapshots from other
 * sessions and malformed payloads never mutate the state; the phase clears
 * at turn and session boundaries via the host's published clear and the
 * tracker's own reset, so a stale phase cannot leak across turns.
 */
export class WorkPhaseTracker {
  private snapshot: { phase: WorkPhase; source: WorkPhaseSource } | null = null;
  private bus: WorkPhaseBus | null = null;
  private sessionId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  // Bumped by every newer observation so an older pending handshake answer can never win.
  private generation = 0;
  private disposed = false;

  private readonly onChange: (phase: WorkPhase | null) => void;

  constructor(onChange: (phase: WorkPhase | null) => void) {
    this.onChange = onChange;
  }

  current(): WorkPhase | null {
    return this.snapshot?.phase ?? null;
  }

  /** Subscribe to change events and recover the host's current state with the handshake. */
  attach(bus: unknown, sessionId: string | null | undefined): void {
    const candidate = bus as WorkPhaseBus | null | undefined;
    if (!candidate || typeof candidate.on !== "function" || typeof candidate.emit !== "function") return;
    this.unsubscribe?.();
    this.disposed = false;
    this.bus = candidate;
    this.adoptSession(sessionId);
    this.unsubscribe = this.bus.on(ODD_PHASE_CHANGE_EVENT, payload => {
      if (this.disposed) return;
      this.generation++;
      this.apply(payload);
    });
    this.requestCurrent();
  }

  /** Re-scope to a (possibly newly known) session and recover the current state; safe mid-session. */
  setSession(sessionId: string | null | undefined): void {
    if (this.disposed || !this.bus) return;
    this.adoptSession(sessionId);
    this.requestCurrent();
  }

  /** Ask the host for its current snapshot; the synchronous answer must still be current. */
  requestCurrent(): void {
    if (this.disposed || !this.bus || !this.sessionId) return;
    const generation = ++this.generation;
    const sessionId = this.sessionId;
    try {
      this.bus.emit(ODD_PHASE_CURRENT_EVENT, {
        schema: ODD_PHASE_CURRENT_SCHEMA,
        sessionId,
        respond: (payload: unknown) => {
          // A disposed tracker or a superseded request owns nothing anymore.
          if (this.disposed || generation !== this.generation) return;
          if (payload === null) {
            // The host answers null for "no state": a stored phase must not outlive
            // that answer. An answer with nothing stored clears nothing. A bare null
            // on the change channel stays rejected — only handshake null means this.
            if (this.snapshot) {
              this.snapshot = null;
              this.onChange(null);
            }
            return;
          }
          this.apply(payload);
        },
      });
    } catch { /* the bus is display-only; failures never surface */ }
  }

  /** Stop observing and invalidate pending handshake answers. */
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.bus = null;
    this.snapshot = null;
  }

  private adoptSession(sessionId: string | null | undefined): void {
    const next = sessionId ?? null;
    if (next === this.sessionId) return;
    this.sessionId = next;
    if (this.snapshot) {
      this.snapshot = null;
      this.onChange(null);
    }
  }

  private apply(payload: unknown): void {
    const parsed = parseWorkPhaseSnapshot(payload);
    if (!parsed || parsed.sessionId !== this.sessionId) return;
    const next = parsed.phase === null ? null : { phase: parsed.phase, source: parsed.source! };
    if ((this.snapshot?.phase ?? null) === (next?.phase ?? null)) {
      // Same visible phase: refresh the source silently, nothing to redraw.
      if (next) this.snapshot = next;
      return;
    }
    this.snapshot = next;
    this.onChange(next ? next.phase : null);
  }
}
