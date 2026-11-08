import type { DisplayActivity } from "./external_display.ts";

export function isSubagentTool(name: string): boolean {
  return /^(?:mcp__.+?__)?subagent_(run|continue|reply)$/.test(name);
}

/** Counts observed in-flight calls, not detached jobs whose lifetime is unknown. */
export class DisplayActivityTracker {
  private subagents = new Set<string>();
  private status: DisplayActivity["status"] = "idle";
  private phase: DisplayActivity["phase"] = "idle";

  private publish: (activity: DisplayActivity) => void;

  constructor(publish: (activity: DisplayActivity) => void) {
    this.publish = publish;
  }

  set(status: DisplayActivity["status"], phase: DisplayActivity["phase"]): void {
    this.status = status;
    this.phase = phase;
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
    this.set("idle", "idle");
  }

  private emit(): void {
    this.publish({ status: this.status, phase: this.phase, activeSubagents: this.subagents.size });
  }
}
