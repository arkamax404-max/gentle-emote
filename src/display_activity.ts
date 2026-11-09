import type { DisplayActivity } from "./external_display.ts";
import { isWorkPhase } from "./work_phase.ts";

export function isSubagentTool(name: string): boolean {
  return /^(?:mcp__.+?__)?subagent_(run|continue|reply)$/.test(name);
}

/**
 * Counts the parent session's activity. Active subagents come from the native
 * task lifecycle bus once observed (setNativeSubagents); before that — or on
 * hosts without the bus — it falls back to counting observed in-flight
 * subagent tool calls, the historical behavior.
 */
export class DisplayActivityTracker {
  private subagents = new Set<string>();
  /**
   * The host bus's active native subagent task count, or null to fall back to
   * observed subagent tool calls (hosts without the native bus). Once the
   * native lifecycle was observed the count is authoritative and is not summed
   * with tool calls; it survives turn resets (agent boundaries, compaction) and
   * only a session change clears it back to null.
   */
  private nativeSubagents: number | null = null;
  private status: DisplayActivity["status"] = "idle";
  private phase: DisplayActivity["phase"] = "idle";
  private workPhase: DisplayActivity["workPhase"];

  private publish: (activity: DisplayActivity) => void;

  constructor(publish: (activity: DisplayActivity) => void) {
    this.publish = publish;
  }

  set(status: DisplayActivity["status"], phase: DisplayActivity["phase"]): void {
    this.status = status;
    this.phase = phase;
    this.emit();
  }

  /**
   * The host's detailed ODD phase, or null to clear it. An invalid detail is
   * never stored or emitted: the last valid work phase keeps applying.
   */
  setWorkPhase(workPhase: unknown): void {
    if (workPhase !== null && !isWorkPhase(workPhase)) return;
    const next = workPhase ?? undefined;
    if (next === this.workPhase) return;
    this.workPhase = next;
    this.emit();
  }

  toolStart(name: string, id: string): void {
    if (isSubagentTool(name)) this.subagents.add(id);
    this.set("busy", "executing");
  }

  toolEnd(id: string, error: boolean): void {
    this.subagents.delete(id);
    this.set(error ? "error" : "busy", this.subagents.size ? "executing" : "thinking");
  }

  /**
   * The native task count from the subagent lifecycle bus, or null to fall
   * back to observed subagent tool calls. An invalid count never mutates.
   */
  setNativeSubagents(count: number | null): void {
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) return;
    if (count === this.nativeSubagents) return;
    this.nativeSubagents = count;
    this.emit();
  }

  reset(): void {
    this.subagents.clear();
    this.workPhase = undefined;
    this.set("idle", "idle");
  }

  /** Current activity, so a destination enabled mid-session starts from the truth. */
  snapshot(): DisplayActivity {
    return { status: this.status, phase: this.phase, activeSubagents: this.nativeSubagents ?? this.subagents.size, ...(this.workPhase === undefined ? {} : { workPhase: this.workPhase }) };
  }

  private emit(): void {
    this.publish(this.snapshot());
  }
}
