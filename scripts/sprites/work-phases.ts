/**
 * Host ODD work-phase scenes (Gentle Shell's eight phases, see src/work_phase.ts).
 * One clear action per phase on the same Gentleman bust: these frames are a
 * visual detail for the generic think/read/write/tool scenes (src/animator.ts),
 * never a separate logical state. Built into both sets by scripts/sprites/build.ts.
 */
import type { Canvas } from "./canvas.ts";
import { text } from "./canvas.ts";
import { C, drawArm, drawBust } from "./gentleman.ts";

export const WORK_PHASE_STATES = [
  "authorizing", "exploring", "researching", "deciding",
  "planning", "implementing", "checking", "closing",
] as const;

export type WorkPhaseScene = (typeof WORK_PHASE_STATES)[number];

type Frame = (cv: Canvas) => void;
export type AddFrame = (state: string, name: string, draw: Frame) => void;

const frames: Record<string, Record<string, Frame>> = {};
const add = (state: string, name: string, draw: Frame) => {
  (frames[state] ??= {})[name] = draw;
};

/** Registers every work-phase frame; called by the sprite builder for both sets. */
export function addWorkPhaseFrames(register: AddFrame): void {
  for (const [state, named] of Object.entries(frames)) {
    for (const [name, draw] of Object.entries(named)) register(state, name, draw);
  }
}

// --- Shared scene helpers ---

/** Bust shoulders for the default head top (y=1): the torso starts at y=26. */
const shoulders = (cx: number) => ({ left: [cx - 12, 28] as [number, number], right: [cx + 11, 28] as [number, number] });

const RED = "#e5484d";
const BLUEPRINT = "#2684ff";

const spark = (cv: Canvas, x: number, y: number, size = 1) => {
  cv.line(x - size, y, x + size, y, C.spark);
  cv.line(x, y - size, x, y + size, C.spark);
};

const checkMark = (cv: Canvas, x: number, y: number, color: string) => {
  for (const [dx, dy] of [[0, 2], [1, 3], [2, 2], [3, 1], [4, 0]] as const) cv.rect(x + dx, y + dy, 1, 2, color);
};

/** A paper card with a dark border; the label sits centered on it. */
const paperCard = (cv: Canvas, x: number, y: number, w: number, h: number, edge: string) => {
  cv.rect(x, y, w, h, edge);
  cv.rect(x + 1, y + 1, w - 2, h - 2, C.paper);
};

// --- authorizing: reviewing an approval card, then stamping it ---

function approvalCard(cv: Canvas, stamped: boolean) {
  paperCard(cv, 28, 8, 16, 20, C.drawerDark);
  for (const y of [12, 16, 24]) cv.rect(31, y, 8, 1, C.paperLine);
  checkMark(cv, 32, 18, C.leaf);
  if (!stamped) return;
  cv.ring(39, 22, 3, RED);
  checkMark(cv, 37, 20, RED);
  spark(cv, 44, 12, 1);
}

add("authorizing", "authorizing_1", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "right", mouth: "small" });
  drawArm(cv, shoulders(cx).right, [28, 26], [31, 22]);
  approvalCard(cv, false);
});
add("authorizing", "authorizing_2", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "right", mouth: "grin" });
  drawArm(cv, shoulders(cx).right, [28, 26], [31, 22]);
  approvalCard(cv, true);
});

// --- exploring: sweeping a magnifying glass over footprints ---

function magnifier(cv: Canvas, cx: number, cy: number, hand: [number, number]) {
  cv.line(cx + 4, cy + 4, hand[0], hand[1], C.wood, 2);
  cv.disc(cx, cy, 5, C.lens);
  cv.ring(cx, cy, 5, C.brass);
}

function footprints(cv: Canvas, shift: number) {
  for (const [x, y] of [[30, 34], [35, 37], [40, 33], [44, 36]] as const) cv.disc(x + shift, y, 1, "#3a2a16");
}

add("exploring", "exploring_1", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "right" });
  drawArm(cv, shoulders(cx).right, [26, 30], [30, 20]);
  magnifier(cv, 33, 14, [30, 20]);
  footprints(cv, 0);
});
add("exploring", "exploring_2", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "right", mouth: "small" });
  drawArm(cv, shoulders(cx).right, [27, 31], [33, 24]);
  magnifier(cv, 38, 18, [33, 24]);
  footprints(cv, 1);
});

// --- researching: an open reference book, one page turning ---

function openBook(cv: Canvas, pageTurn: boolean) {
  cv.rect(24, 27, 10, 11, C.book);
  cv.rect(34, 27, 10, 11, C.book);
  cv.rect(25, 28, 8, 9, C.bookPage);
  cv.rect(35, 28, 8, 9, C.bookPage);
  for (const y of [30, 33]) {
    cv.rect(26, y, 6, 1, C.paperLine);
    cv.rect(36, y, 6, 1, C.paperLine);
  }
  if (!pageTurn) return;
  cv.line(35, 28, 43, 22, C.bookPage, 2);
  cv.line(43, 22, 44, 28, C.bookPage, 1);
}

add("researching", "researching_1", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "down" });
  drawArm(cv, shoulders(cx).right, [26, 30], [28, 32]);
  openBook(cv, false);
});
add("researching", "researching_2", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "down", mouth: "small" });
  drawArm(cv, shoulders(cx).right, [26, 30], [29, 31]);
  openBook(cv, true);
});

// --- deciding: two choice cards, one raised as he weighs them ---

function choiceCard(cv: Canvas, x: number, y: number, label: string, highlighted: boolean) {
  paperCard(cv, x, y, 9, 13, highlighted ? C.brass : C.drawerDark);
  text(cv, label, x + 3, y + 4, C.ink);
}

add("deciding", "deciding_1", (cv) => {
  const cx = 15;
  drawBust(cv, cx, { eyes: "right", mouth: "small" });
  drawArm(cv, shoulders(cx).right, [28, 26], [31, 20]);
  choiceCard(cv, 27, 9, "?", true);
  choiceCard(cv, 38, 11, "!", false);
});
add("deciding", "deciding_2", (cv) => {
  const cx = 15;
  drawBust(cv, cx, { eyes: "right", mouth: "closed" });
  drawArm(cv, shoulders(cx).right, [32, 26], [42, 20]);
  choiceCard(cv, 27, 11, "?", false);
  choiceCard(cv, 38, 9, "!", true);
});

// --- planning: drawing the approach on a blueprint grid ---

function blueprint(cv: Canvas, variant: 0 | 1) {
  cv.rect(26, 26, 20, 12, BLUEPRINT);
  for (const y of [29, 33]) cv.rect(27, y, 18, 1, C.white);
  for (const x of [31, 36, 41]) cv.rect(x, 27, 1, 10, C.white);
  if (variant === 0) {
    cv.rect(30, 30, 6, 4, C.white);
  } else {
    cv.rect(33, 30, 7, 5, C.white);
    cv.rect(29, 34, 3, 2, C.white);
  }
}

function pencil(cv: Canvas, hand: [number, number], tip: [number, number]) {
  cv.line(hand[0], hand[1], tip[0], tip[1], C.wood, 1);
  cv.set(tip[0], tip[1], C.ink);
}

add("planning", "planning_1", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "down", mouth: "small" });
  drawArm(cv, shoulders(cx).right, [27, 30], [29, 29]);
  pencil(cv, [29, 29], [33, 27]);
  blueprint(cv, 0);
});
add("planning", "planning_2", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "down", mouth: "small" });
  drawArm(cv, shoulders(cx).right, [30, 31], [33, 30]);
  pencil(cv, [33, 30], [36, 28]);
  blueprint(cv, 1);
});

// --- implementing: both hands on the keyboard, code flying up ---

function keyboard(cv: Canvas) {
  cv.rect(23, 32, 23, 7, C.pan);
  for (let x = 24; x < 45; x += 2) {
    cv.rect(x, 33, 1, 2, C.panRim);
    cv.rect(x, 36, 1, 2, C.panRim);
  }
}

add("implementing", "implementing_1", (cv) => {
  const cx = 13;
  const s = shoulders(cx);
  drawBust(cv, cx, { eyes: "down", mouth: "clench" });
  drawArm(cv, s.left, [7, 32], [22, 35]);
  drawArm(cv, s.right, [26, 31], [28, 35]);
  keyboard(cv);
  text(cv, "{", 34, 20, C.code1);
  text(cv, "}", 39, 24, C.code2);
});
add("implementing", "implementing_2", (cv) => {
  const cx = 13;
  const s = shoulders(cx);
  drawBust(cv, cx, { eyes: "down", mouth: "small" });
  drawArm(cv, s.left, [7, 32], [21, 36]);
  drawArm(cv, s.right, [26, 31], [30, 34]);
  keyboard(cv);
  text(cv, ";", 36, 18, C.code2);
  text(cv, "{", 32, 24, C.code1);
});

// --- checking: a clipboard checklist that fills with green checks ---

function checklist(cv: Canvas, checked: number) {
  cv.rect(28, 6, 16, 26, C.wood);
  cv.rect(29, 8, 14, 22, C.paper);
  cv.rect(33, 4, 6, 3, C.panRim);
  let row = 0;
  for (const y of [11, 16, 21, 26]) {
    cv.rect(31, y, 3, 3, C.paperLine);
    cv.rect(35, y + 1, 6, 1, C.paperLine);
    if (row < checked) checkMark(cv, 30, y, C.leaf);
    row++;
  }
}

add("checking", "checking_1", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "down" });
  drawArm(cv, shoulders(cx).right, [27, 29], [30, 31]);
  checklist(cv, 1);
});
add("checking", "checking_2", (cv) => {
  const cx = 13;
  drawBust(cv, cx, { eyes: "down", mouth: "grin" });
  drawArm(cv, shoulders(cx).right, [27, 29], [30, 31]);
  checklist(cv, 3);
  spark(cv, 45, 10, 1);
});

// --- closing: presenting the completed-work folder ---

function workFolder(cv: Canvas, closed: boolean) {
  cv.rect(26, 14, 20, 15, C.drawer);
  cv.rect(26, 12, 9, 2, C.drawer);
  if (!closed) {
    cv.rect(29, 10, 13, 4, C.paper);
    cv.rect(30, 11, 11, 1, C.paperLine);
    return;
  }
  cv.rect(27, 15, 18, 3, C.drawerDark);
  checkMark(cv, 33, 21, C.leaf);
  spark(cv, 44, 13, 1);
}

add("closing", "closing_1", (cv) => {
  const cx = 15;
  drawBust(cv, cx, { eyes: "open", mouth: "closed" });
  drawArm(cv, shoulders(cx).right, [28, 27], [30, 26]);
  workFolder(cv, false);
});
add("closing", "closing_2", (cv) => {
  const cx = 15;
  drawBust(cv, cx, { eyes: "happy", mustache: "up", mouth: "grin" });
  drawArm(cv, shoulders(cx).right, [28, 27], [30, 26]);
  workFolder(cv, true);
});
