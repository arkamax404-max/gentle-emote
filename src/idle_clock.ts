import type { DisplayActivity } from "./external_display.ts";

export const IDLE_CLOCK_DELAY_MS = 5 * 60 * 1000;
export const IDLE_CLOCK_TICK_MS = 1000;

/** Monotonic elapsed time, independent of local clock or timezone adjustments. */
export class IdleClock {
  private idleSince: number | null;

  constructor(now: number) { this.idleSince = now; }

  update(activity: DisplayActivity, now: number, state?: string): void {
    const eligible = activity.status === "idle" && activity.phase === "idle"
      && activity.activeSubagents === 0 && activity.workPhase === undefined
      && (state === undefined || state === "idle" || state === "grandma");
    if (!eligible) this.idleSince = null;
    else if (this.idleSince === null) this.idleSince = now;
  }

  isActive(now: number): boolean {
    return this.idleSince !== null && now - this.idleSince > IDLE_CLOCK_DELAY_MS;
  }
}
