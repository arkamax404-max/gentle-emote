import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { decodePng } from "../src/png.ts";
import { Animator } from "../src/animator.ts";
import { WORK_PHASES } from "../src/work_phase.ts";
import { C, KEY } from "../scripts/sprites/gentleman.ts";
import type { Config, EmoteState } from "../src/types.ts";

const ROOT = join(import.meta.dirname, "..", "emotes");
const SETS = ["gentleman", "gentleman-yolo"] as const;

const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const countIn = (png: ReturnType<typeof decodePng>, color: [number, number, number], y0: number, y1: number) => {
  let total = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i] === color[0] && png.data[i + 1] === color[1] && png.data[i + 2] === color[2] && png.data[i + 3] === 255) total++;
  }
  return total;
};

// --- T1: native artwork rules, one test per phase asset pair ---

for (const phase of WORK_PHASES) {
  test(`work phase "${phase}" ships native distinct transparent frames in both sets with animation data`, () => {
    for (const set of SETS) {
      const dir = join(ROOT, set, phase);
      const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
      assert.deepEqual(files, [`${phase}_1.png`, `${phase}_2.png`], `${set}/${phase}`);

      const frames = files.map((f) => decodePng(readFileSync(join(dir, f))));
      for (const png of frames) {
        assert.deepEqual([png.width, png.height], [48, 40], `${set}/${phase}: native dimensions`);
        for (let i = 3; i < png.data.length; i += 4) {
          assert.ok(png.data[i] === 0 || png.data[i] === 255, `${set}/${phase}: transparent RGBA alpha`);
        }
      }
      assert.notDeepEqual(frames[0]!.data, frames[1]!.data, `${set}/${phase}: two distinct frames`);

      // The Gentleman identity is preserved: glasses (plain set), hair/moustache and the rose.
      if (set === "gentleman") {
        assert.ok(countIn(frames[0]!, rgb(C.frame), 0, 26) > 6, `${set}/${phase}: glasses present`);
      }
      assert.ok(countIn(frames[0]!, rgb(C.hair), 0, 26) > 6, `${set}/${phase}: moustache/hair present`);
      assert.ok(countIn(frames[0]!, rgb(KEY.base), 26, 40) > 0, `${set}/${phase}: rose on the torso`);
      // The YOLO twin keeps the sunglasses look.
      if (set === "gentleman-yolo") {
        assert.ok(countIn(frames[0]!, rgb(C.ink), 5, 20) > 10, `${set}/${phase}: sunglasses present`);
      }
    }
    for (const set of SETS) {
      const config = JSON.parse(readFileSync(join(ROOT, set, "emotes.json"), "utf8"));
      assert.equal(config.cycle?.[phase], "loop", `${set}/emotes.json: ${phase} cycles`);
      assert.ok(Number.isFinite(config.frameMs?.[phase]), `${set}/emotes.json: ${phase} frame duration`);
    }
  });
}

// --- T2: phase-driven visual selection rules ---

const config: Config = {
  enabled: true, debug: false, size: 12, placement: "beside-editor", frame: true, frameRows: 4, minEditorWidth: 40, readingSpeed: 4,
  holdDuration: { hi: 1000, success: 1000, failure: 1000, bye: 1000 },
  blinkInterval: [60_000, 60_000], talkTickMs: 120, cycleMs: 100, grandmaAfterMs: 5000,
  accent: "auto", farewellPattern: "^chau", emotes: [], terminals: [],
};

/** Records what the animator asks to show (same shape as tests/animator.test.ts). */
function fakeRenderer(files: Partial<Record<EmoteState, string[]>>) {
  const shown: string[] = [];
  return {
    shown,
    setTui() {}, loadFrames() {}, getRenderedFrame: () => null, dispose() {}, resetCache() {},
    getFrameFiles: (state: EmoteState) => files[state] ?? [],
    showFrame: (state: EmoteState, name: string) => { shown.push(`${state}/${name}`); return true; },
    showRandomFrame: (state: EmoteState) => { shown.push(`${state}/*`); return true; },
    showTalkFrame: () => { shown.push("talk"); return true; },
    showTalkCloseFrame: () => { shown.push("talk/close"); return true; },
    showCycleFrame: (state: EmoteState, i: number) => { shown.push(`${state}#${i}`); return true; },
    getCycleFrameCount: (state: EmoteState) => files[state]?.length ?? 0,
  };
}

test("generic work states adopt the published phase visual without changing the logical state", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const renderer = fakeRenderer({
      think: ["a", "b"], read: ["a", "b"], write: ["a", "b"], tool: ["a", "b"],
      implementing: ["implementing_1.png", "implementing_2.png"],
    });
    const animator = new Animator(config, renderer as any);
    animator.setWorkPhase("implementing");
    for (const state of ["think", "read", "write", "tool"] as EmoteState[]) {
      animator.transitionTo(state);
      assert.equal(animator.currentState, state, `${state}: logical state preserved`);
      assert.ok(renderer.shown.at(-1)!.startsWith("implementing#"), `${state}: phase visual shown`);
    }
    // Clearing and re-publishing a phase re-paints the current generic state.
    animator.setWorkPhase(null);
    animator.transitionTo("tool");
    assert.ok(renderer.shown.at(-1)!.startsWith("tool#"), "the coarse visual holds while the phase is cleared");
    animator.setWorkPhase("implementing");
    assert.ok(renderer.shown.at(-1)!.startsWith("implementing#"), "live phase adoption re-paints");
    mock.timers.tick(100);
    assert.ok(renderer.shown.filter((f) => f.startsWith("implementing#")).length > 2, "the phase frames cycle");
    animator.clearAllTimers();
  } finally { mock.timers.reset(); }
});

test("clearing the phase falls back to the generic visual", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const renderer = fakeRenderer({ tool: ["a", "b"], implementing: ["implementing_1.png", "implementing_2.png"], checking: ["checking_1.png", "checking_2.png"] });
    const animator = new Animator(config, renderer as any);
    animator.setWorkPhase("implementing");
    animator.transitionTo("tool");
    assert.ok(renderer.shown.at(-1)!.startsWith("implementing#"));
    animator.setWorkPhase(null);
    assert.equal(animator.currentState, "tool");
    assert.ok(renderer.shown.at(-1)!.startsWith("tool#"), "the coarse visual returns after the clear");
    animator.clearAllTimers();
  } finally { mock.timers.reset(); }
});

test("missing phase frames fall back truthfully to the generic visual", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    // A custom set without phase directories.
    const renderer = fakeRenderer({ think: ["a", "b"], tool: ["a", "b"] });
    const animator = new Animator(config, renderer as any);
    animator.setWorkPhase("planning");
    animator.transitionTo("think");
    assert.equal(animator.currentState, "think");
    assert.ok(renderer.shown.at(-1)!.startsWith("think#"), "no phase frames means the plain scene");
    animator.transitionTo("tool");
    assert.ok(renderer.shown.at(-1)!.startsWith("tool#"));
    animator.clearAllTimers();
  } finally { mock.timers.reset(); }
});

test("prompts, failures, compaction, talk, idle and delegation keep their own visuals under an active phase", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const renderer = fakeRenderer({
      think: ["a", "b"], tool: ["a", "b"], implementing: ["implementing_1.png", "implementing_2.png"],
      ask: ["yn1", "yn2"], compact: ["c1", "c2"], idle: ["idle.png"], delegate: ["d1", "d2"], verify: ["fail.png"],
    });
    const animator = new Animator(config, renderer as any);
    animator.setWorkPhase("implementing");

    animator.transitionTo("tool");
    animator.beginPrompt();
    assert.ok(renderer.shown.at(-1)!.startsWith("ask#"), "a blocking prompt still covers the scene");
    animator.endPrompt();
    assert.ok(renderer.shown.at(-1)!.startsWith("implementing#"), "and uncovers back into the phase visual");

    animator.transitionTo("compact");
    assert.ok(renderer.shown.at(-1)!.startsWith("compact#"), "compaction is never replaced");
    animator.transitionTo("talk");
    assert.equal(renderer.shown.at(-1), "talk", "talking is never replaced");
    animator.transitionTo("idle");
    assert.equal(renderer.shown.at(-1), "idle/idle.png", "idle is never replaced");
    animator.transitionTo("delegate");
    assert.ok(renderer.shown.at(-1)!.startsWith("delegate#"), "delegation keeps its own scene");

    animator.setHoldNextState("think");
    assert.equal(animator.showFailureFrame("verify", "fail.png"), true);
    assert.equal(renderer.shown.at(-1), "verify/fail.png", "failures keep their truthful frame");
    animator.clearAllTimers();
  } finally { mock.timers.reset(); }
});

test("Super YOLO thinking keeps the sun over the phase visual", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const renderer = fakeRenderer({
      think: ["a", "b"], "super-yolo": ["super-yolo.png", "super-yolo_blink.png"],
      implementing: ["implementing_1.png", "implementing_2.png"],
    });
    const animator = new Animator(config, renderer as any);
    animator.setEmotesConfig({ cycle: { "super-yolo": "loop" }, frameMs: { "super-yolo": 100 } });
    animator.setIdleVariant("super-yolo");
    animator.setWorkPhase("implementing");
    animator.transitionTo("think");
    assert.ok(renderer.shown.at(-1)!.startsWith("super-yolo#"), "the existing Super YOLO precedence holds");
    animator.transitionTo("tool");
    assert.ok(renderer.shown.at(-1)!.startsWith("implementing#"), "other generic states still take the phase");
    animator.stop();
  } finally { mock.timers.reset(); }
});
