import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { agentDir, EXTENSION_NAME } from "./emotes.ts";

export const OUTPUTS = ["internal", "debug", "d200", "display"] as const;
export type Output = typeof OUTPUTS[number];
export type OutputStates = Record<Output, boolean>;

/** Global preferences are separate from layered config and from each other. */
export class OutputStateStore {
  private dir: string;

  constructor(root = agentDir()) {
    this.dir = join(root, "extensions", EXTENSION_NAME, "output-states");
  }

  private path(output: Output): string { return join(this.dir, `${output}.json`); }

  private read(output: Output): boolean {
    let text: string;
    try { text = readFileSync(this.path(output), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    const value: unknown = JSON.parse(text);
    if (typeof value !== "boolean") throw new Error(`invalid saved ${output} state`);
    return value;
  }

  load(report: (message: string) => void): OutputStates {
    const states = { internal: false, debug: false, d200: false, display: false };
    for (const output of OUTPUTS) {
      try { states[output] = this.read(output); }
      catch { report(`cannot read saved ${output} state; output stays off`); }
    }
    return states;
  }

  save(output: Output, enabled: boolean): void {
    // Do not silently overwrite corrupt or unreadable preferences.
    this.read(output);
    mkdirSync(this.dir, { recursive: true });
    const temporary = `${this.path(output)}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(enabled)}\n`, { flag: "wx" });
      renameSync(temporary, this.path(output));
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
