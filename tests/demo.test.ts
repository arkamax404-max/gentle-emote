import { test } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./integration.test.ts";
import { WORK_PHASES } from "../src/work_phase.ts";

test("/emote demo visits all eight ODD phases without publishing activity or losing original scenes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let lab: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    lab = await boot(undefined, []);
    const emote = lab.commands.get("emote");
    await emote.handler("demo", lab.ctx);
    const seen: string[] = [];
    // Sample each step immediately, before short holds can return to idle.
    for (let step = 0; step < 31; step++) {
      if (step > 0) t.mock.timers.tick(3500);
      await emote.handler("status", lab.ctx);
      const notice = lab.notices.at(-1)!;
      assert.equal(notice.level, "info");
      assert.match(notice.message, /; phase none \(source: none\); activity status=idle phase=idle activeSubagents=0$/);
      const state = notice.message.match(/status: PNG state=([^ ]+)/)?.[1];
      if (state) seen.push(state);
    }
    assert.deepEqual(seen.filter(state => (WORK_PHASES as readonly string[]).includes(state)), [...WORK_PHASES]);
    // The shipped fail* frame filter selects no failure PNG; retain that behavior.
    const original = [
      "hi", "think", "talk", "read", "tool", "delegate", "explore", "build", "verify", "judge", "review", "jira",
      "write", "jobs", "remember", "ask", "success", "compact", "yolo", "super-yolo", "grandma", "bye",
    ];
    assert.deepEqual(seen.filter(state => original.includes(state)), original);
    await emote.handler("idle", lab.ctx);
    await emote.handler("status", lab.ctx);
    assert.match(lab.notices.at(-1)!.message, /PNG state=idle .*; phase none \(source: none\); activity status=idle phase=idle activeSubagents=0$/);
  } finally {
    await lab?.shutdown(); lab?.restore();
    t.mock.timers.reset();
  }
});
