import type { TUI } from "@earendil-works/pi-tui";
import type { EmoteState, Config, EmotesConfig } from "./types.ts";
import type { Renderer, RenderedFrame } from "./renderer.ts";
import type { WorkPhase } from "./work_phase.ts";
import { log } from "./log.ts";

/** How long the talk scene lingers once the reply has finished streaming. */
const TALK_TAIL_MS = 500;

/** Generic work states that may wear the detailed host phase as a visual. */
const PHASE_VISUAL_STATES: ReadonlySet<EmoteState> = new Set(["think", "read", "write", "tool"]);

// --- Helpers ---

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// --- Animator ---

export class Animator {
  // State machine
  currentState: EmoteState = "idle";

  // Renderer
  private renderer: Renderer;
  private config: Config;
  private emotesConfig: EmotesConfig = {};

  // Timers
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private talkTimer: ReturnType<typeof setInterval> | null = null;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private talkGapTimer: ReturnType<typeof setTimeout> | null = null;
  private talkDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private grandmaTimer: ReturnType<typeof setTimeout> | null = null;

  // Cycle state
  private cycleIndex = 0;
  private cycleDirection = 1;

  // Hold state
  private holdNextState: EmoteState = "idle";
  private afterTalkState: EmoteState = "idle";
  private stopped = false;
  private idleVariant: EmoteState | null = null;
  private workPhase: WorkPhase | null = null;
  private promptDepth = 0;
  private deferredFailure: { state: EmoteState; file: string } | null = null;

  // Talk state
  private talkWordCount = 0;
  private talkStartTime = 0;
  private lastTokenTime = 0;
  private talkMouthClosed = false;

  constructor(config: Config, renderer: Renderer) {
    this.config = config;
    this.renderer = renderer;
  }

  updateConfig(config: Config) {
    this.config = config;
  }

  setRenderer(renderer: Renderer) {
    this.renderer = renderer;
  }

  setTui(tui: TUI | null) {
    this.renderer.setTui(tui);
  }

  setEmotesConfig(emotesConfig: EmotesConfig) {
    this.emotesConfig = emotesConfig;
  }

  setHoldNextState(state: EmoteState) {
    this.holdNextState = state;
  }

  /**
   * The host's detailed ODD phase: a display detail that re-skins the generic
   * think/read/write/tool scenes when the set ships frames for it. Never a
   * logical state: prompts, failures, compaction, talk, idle and delegation
   * keep their own visuals, and missing frames fall back truthfully.
   */
  setWorkPhase(phase: WorkPhase | null) {
    if (phase === this.workPhase) return;
    this.workPhase = phase;
    if (this.stopped) return;
    if (PHASE_VISUAL_STATES.has(this.currentState)) this.transitionTo(this.currentState);
  }

  /** State to play once the current talk animation finishes (then back to idle). */
  setAfterTalkState(state: EmoteState) {
    this.afterTalkState = state;
  }

  private finishTalk() {
    const next = this.afterTalkState;
    this.afterTalkState = "idle";
    this.transitionTo(next);
  }

  /** Get current rendered frame for the widget. */
  getRenderedFrame(): RenderedFrame | null {
    return this.renderer.getRenderedFrame();
  }

  resetRenderCache() {
    this.renderer.resetCache();
    if (this.promptDepth > 0 && !this.stopped) this.renderer.showCycleFrame("ask", 0);
  }

  /** A blocking prompt covers the avatar without replacing the logical state. */
  beginPrompt() {
    this.promptDepth++;
    if (this.stopped) return;
    this.renderer.showCycleFrame("ask", 0);
  }

  endPrompt() {
    if (this.promptDepth === 0) return;
    this.promptDepth--;
    if (this.stopped || this.promptDepth > 0) return;
    if (this.deferredFailure && this.currentState === "failure") {
      const frame = this.deferredFailure;
      this.deferredFailure = null;
      this.renderer.showFrame(frame.state, frame.file);
      return;
    }
    const visual = this.cycleVisual(this.currentState);
    this.renderer.showCycleFrame(visual, this.cycleIndex);
  }

  disposeRenderer() {
    this.renderer.dispose();
  }

  // --- Timer management ---

  /** Session ended: cancel everything and keep in-flight blink callbacks from rescheduling. */
  stop() {
    this.stopped = true;
    this.clearAllTimers();
  }

  clearAllTimers() {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.blinkTimer) { clearTimeout(this.blinkTimer); this.blinkTimer = null; }
    if (this.talkTimer) { clearInterval(this.talkTimer); this.talkTimer = null; }
    if (this.cycleTimer) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
    if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }
    if (this.grandmaTimer) { clearTimeout(this.grandmaTimer); this.grandmaTimer = null; }
  }

  private clearStateTimers() {
    if (this.grandmaTimer) { clearTimeout(this.grandmaTimer); this.grandmaTimer = null; }
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.talkTimer) { clearInterval(this.talkTimer); this.talkTimer = null; }
    if (this.cycleTimer) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
    if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }
  }

  // --- State transitions ---

  transitionTo(state: EmoteState) {
    this.stopped = false;
    this.clearStateTimers();
    if (this.currentState === "idle" && this.blinkTimer) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
    this.currentState = state;

    switch (state) {
      case "hi": this.enterHi(); break;
      case "idle": this.enterIdle(); break;
      case "think": this.enterCycle("think"); break;
      case "talk": this.enterTalk(); break;
      case "read":
      case "write":
      case "tool":
      case "ask": this.enterCycle(state); break;
      case "success": this.enterHold(state, this.config.holdDuration.success, this.holdNextState); this.holdNextState = "idle"; break;
      case "failure": this.enterHold(state, this.config.holdDuration.failure, this.holdNextState); this.holdNextState = "idle"; break;
      case "compact":
      case "delegate":
      case "jobs":
      case "remember":
      case "yolo":
      case "super-yolo":
      case "explore":
      case "build":
      case "verify":
      case "judge":
      case "review":
      case "jira": this.enterCycle(state); break;
      case "authorizing":
      case "exploring":
      case "researching":
      case "deciding":
      case "planning":
      case "implementing":
      case "checking":
      case "closing": this.enterCycle(state); break;
      case "grandma": this.enterSequence(state); break;
      case "bye": this.enterSequence(state); break;
    }
  }

  /** Session greeting: flies in with the propeller, then waves. */
  private enterHi() {
    this.enterSequence("hi", false);
    this.holdTimer = setTimeout(() => this.transitionTo("idle"), this.config.holdDuration.hi);
  }

  /** Wakes from the grandma with the wave only. The propeller plays on session entry. */
  wave() {
    this.stopped = false;
    this.clearStateTimers();
    this.currentState = "hi";
    if (!this.enterSequence("hi", true)) {
      this.transitionTo("idle");
      return;
    }
    this.holdTimer = setTimeout(() => this.transitionTo("idle"), this.config.holdDuration.hi);
  }

  /**
   * A state whose frames replace idle while it holds (YOLO mode keeps the
   * sunglasses on while resting). Its files are `<state>.png` and `<state>_blink.png`.
   */
  setIdleVariant(state: EmoteState | null) {
    if (state === this.idleVariant) return;
    this.idleVariant = state;
    if (this.currentState === "idle") this.transitionTo("idle");
  }

  private idleFrames(): { state: EmoteState; rest: string; blink: string } {
    const variant = this.idleVariant;
    if (variant && this.renderer.getFrameFiles(variant).includes(`${variant}.png`)) {
      return { state: variant, rest: `${variant}.png`, blink: `${variant}_blink.png` };
    }
    return {
      state: "idle",
      rest: this.emotesConfig.idle?.default ?? "idle.png",
      blink: this.emotesConfig.idle?.blink ?? "idle_blink.png",
    };
  }

  enterIdle() {
    if (this.promptDepth > 0) this.presentCycle("ask", 0);
    else {
      const frames = this.idleFrames();
      this.renderer.showFrame(frames.state, frames.rest);
    }
    this.scheduleBlink();
    this.scheduleGrandma();
  }

  /** User activity while idle postpones the grandma transformation. */
  touch() {
    if (this.currentState === "idle") this.scheduleGrandma();
  }

  private scheduleGrandma() {
    if (this.grandmaTimer) { clearTimeout(this.grandmaTimer); this.grandmaTimer = null; }
    if (this.stopped || this.config.grandmaAfterMs <= 0 || this.renderer.getFrameFiles("grandma").length === 0) return;
    this.grandmaTimer = setTimeout(() => {
      this.grandmaTimer = null;
      if (this.currentState === "idle") this.transitionTo("grandma");
    }, this.config.grandmaAfterMs);
  }

  private scheduleBlink() {
    if (this.blinkTimer) { clearTimeout(this.blinkTimer); this.blinkTimer = null; }
    if (this.stopped) return;
    const delay = randomInRange(this.config.blinkInterval[0], this.config.blinkInterval[1]);
    this.blinkTimer = setTimeout(() => {
      if (this.currentState !== "idle") return;
      this.doBlink();
    }, delay);
  }

  private doBlink() {
    if (this.promptDepth > 0) {
      this.scheduleBlink();
      return;
    }
    const { state, rest: defaultFile, blink: blinkFile } = this.idleFrames();
    if (!this.renderer.showFrame(state, blinkFile)) {
      this.scheduleBlink();
      return;
    }

    const doubleBlink = Math.random() < 0.15;
    const blinkDuration = 150;

    setTimeout(() => {
      if (this.currentState !== "idle") return;
      this.renderer.showFrame(state, defaultFile, true);

      if (doubleBlink) {
        setTimeout(() => {
          if (this.currentState !== "idle") return;
          this.renderer.showFrame(state, blinkFile, true);
          setTimeout(() => {
            if (this.currentState !== "idle") return;
            this.renderer.showFrame(state, defaultFile, true);
            this.scheduleBlink();
          }, blinkDuration);
        }, 100);
      } else {
        this.scheduleBlink();
      }
    }, blinkDuration);
  }

  private paintTalk(closed: boolean) {
    if (this.promptDepth > 0) {
      this.presentCycle("ask", 0);
      return;
    }
    if (closed) this.renderer.showTalkCloseFrame();
    else this.renderer.showTalkFrame(this.emotesConfig);
  }

  private enterTalk() {
    this.talkWordCount = 0;
    this.talkStartTime = Date.now();
    this.lastTokenTime = Date.now();
    this.talkMouthClosed = false;

    this.paintTalk(false);

    this.talkTimer = setInterval(() => {
      if (this.currentState !== "talk") return;
      this.paintTalk(this.talkMouthClosed);
    }, this.config.talkTickMs);
  }

  onTalkToken(text: string) {
    if (this.currentState !== "talk") return;

    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    this.talkWordCount += words;
    this.lastTokenTime = Date.now();

    if (this.talkMouthClosed) {
      this.talkMouthClosed = false;
    }

    if (this.talkGapTimer) { clearTimeout(this.talkGapTimer); this.talkGapTimer = null; }
    this.talkGapTimer = setTimeout(() => {
      if (this.currentState !== "talk") return;
      this.talkMouthClosed = true;
    }, 200);

    this.recalculateTalkDuration();
  }

  private recalculateTalkDuration() {
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }

    const targetDurationMs = (this.talkWordCount / this.config.readingSpeed) * 1000;
    const elapsed = Date.now() - this.talkStartTime;
    const remaining = Math.max(0, targetDurationMs - elapsed);

    this.talkDurationTimer = setTimeout(() => {
      if (this.currentState !== "talk") return;
      const timeSinceLastToken = Date.now() - this.lastTokenTime;
      if (timeSinceLastToken > 200) {
        this.finishTalk();
      } else {
        this.talkDurationTimer = setTimeout(() => {
          if (this.currentState === "talk") this.finishTalk();
        }, 200);
      }
    }, remaining);
  }

  /** The reply finished streaming: wrap up after a short tail instead of "reading" it out loud. */
  endTalk() {
    if (this.currentState !== "talk") return;
    if (this.talkDurationTimer) { clearTimeout(this.talkDurationTimer); this.talkDurationTimer = null; }
    this.talkDurationTimer = setTimeout(() => {
      if (this.currentState === "talk") this.finishTalk();
    }, TALK_TAIL_MS);
  }

  private frameMs(state: EmoteState): number {
    return this.emotesConfig.frameMs?.[state] ?? this.config.cycleMs;
  }

  /** Super YOLO keeps the sun on screen while the model is thinking; the host phase re-skins the rest. */
  private cycleVisual(state: EmoteState): EmoteState {
    if (state === "think" && this.idleVariant === "super-yolo") return "super-yolo";
    if (this.workPhase && PHASE_VISUAL_STATES.has(state) && this.renderer.getFrameFiles(this.workPhase).length > 0) {
      return this.workPhase;
    }
    return state;
  }

  private presentCycle(visual: EmoteState, index: number) {
    if (this.promptDepth > 0) {
      const askCount = this.renderer.getCycleFrameCount("ask");
      this.renderer.showCycleFrame("ask", askCount > 0 ? index % askCount : 0);
      return;
    }
    this.renderer.showCycleFrame(visual, index);
  }

  private enterCycle(state: EmoteState) {
    const visual = this.cycleVisual(state);
    this.cycleIndex = 0;
    this.cycleDirection = 1;
    this.presentCycle(visual, 0);

    const count = this.renderer.getCycleFrameCount(visual);
    if (count <= 1) return;

    const loop = (this.emotesConfig.cycle?.[visual] ?? this.emotesConfig.cycle?.[state]) === "loop";
    this.cycleTimer = setInterval(() => {
      if (this.currentState !== state) return;
      if (loop) {
        this.cycleIndex = (this.cycleIndex + 1) % count;
      } else {
        this.cycleIndex += this.cycleDirection;
        if (this.cycleIndex >= count - 1) this.cycleDirection = -1;
        if (this.cycleIndex <= 0) this.cycleDirection = 1;
      }
      this.presentCycle(visual, this.cycleIndex);
    }, this.frameMs(visual));
  }

  /** A Yes/No prompt keeps its picture even while a sequence timer is running. */
  private paintSequence(state: EmoteState, file: string) {
    if (this.promptDepth > 0) {
      this.presentCycle("ask", 0);
      return;
    }
    this.renderer.showFrame(state, file);
  }

  /**
   * Plays `in_*` frames once, then loops the rest.
   * `waveOnly` skips the arrival, so a wake-up does not put the propeller back on.
   */
  private enterSequence(state: EmoteState, waveOnly = false): boolean {
    const files = this.renderer.getFrameFiles(state);
    const intro = files.filter((f) => f.startsWith("in_"));
    const loop = files.filter((f) => !f.startsWith("in_"));
    const ordered = waveOnly ? loop : [...intro, ...loop];
    if (ordered.length === 0) return false;
    const loopStart = waveOnly ? 0 : intro.length;

    let index = 0;
    this.paintSequence(state, ordered[0]!);
    if (ordered.length === 1) return true;

    this.cycleTimer = setInterval(() => {
      if (this.currentState !== state) return;
      index++;
      if (index >= ordered.length) index = loop.length > 0 ? loopStart : ordered.length - 1;
      this.paintSequence(state, ordered[index]!);
    }, this.frameMs(state));
    return true;
  }

  private enterHold(state: EmoteState, duration: number, nextState: EmoteState = "idle") {
    this.enterCycle(state);
    this.holdTimer = setTimeout(() => this.transitionTo(nextState), duration);
  }

  /**
   * Holds one frame for the failure duration, counted as `failure` so the
   * end of the run does not replace it. Returns false when the file is missing.
   */
  showFailureFrame(state: EmoteState, file: string): boolean {
    if (this.promptDepth > 0) {
      if (!this.renderer.getFrameFiles(state).includes(file)) return false;
      this.clearStateTimers();
      this.currentState = "failure";
      this.deferredFailure = { state, file };
      const next = this.holdNextState;
      this.holdNextState = "idle";
      this.holdTimer = setTimeout(() => this.transitionTo(next), this.config.holdDuration.failure);
      return true;
    }
    this.deferredFailure = null;
    if (!this.renderer.showFrame(state, file)) return false;
    this.clearStateTimers();
    this.currentState = "failure";
    const next = this.holdNextState;
    this.holdNextState = "idle";
    this.holdTimer = setTimeout(() => this.transitionTo(next), this.config.holdDuration.failure);
    return true;
  }
}
