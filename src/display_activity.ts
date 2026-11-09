import type { DisplayActivity } from "./external_display.ts";
import { isWorkPhase } from "./work_phase.ts";

export function isSubagentTool(name: string): boolean {
  return /^(?:mcp__.+?__)?subagent_(run|continue|reply)$/.test(name);
}

/** Counts observed in-flight calls, not detached jobs whose lifetime is unknown. */
export class DisplayActivityTracker {
  private subagents = new Set<string>();
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

  reset(): void {
    this.subagents.clear();
    this.workPhase = undefined;
    this.set("idle", "idle");
  }

  /** Current activity, so a destination enabled mid-session starts from the truth. */
  snapshot(): DisplayActivity {
    return { status: this.status, phase: this.phase, activeSubagents: this.subagents.size, ...(this.workPhase === undefined ? {} : { workPhase: this.workPhase }) };
  }

  private emit(): void {
    this.publish(this.snapshot());
  }
}
