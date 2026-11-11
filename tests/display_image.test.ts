import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePng, decodePng } from "../src/png.ts";
import { prepareDisplayImage } from "../src/display_image.ts";
import { drawDisplayText } from "../src/display_text.ts";
import { EMOTE_STATES } from "../src/types.ts";

const pixel = (image: ReturnType<typeof decodePng>, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const statusRow = (image: ReturnType<typeof decodePng>) => image.data.slice(44 * 64 * 4, 49 * 64 * 4);
const phaseRow = (image: ReturnType<typeof decodePng>) => image.data.slice(54 * 64 * 4, 59 * 64 * 4);
const referenceRow = (top: 44 | 54, text: string, color: readonly number[] | ((index: number) => readonly number[])) => {
  const data = new Uint8Array(64 * 64 * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  drawDisplayText(data, text, top, color);
  return data.slice(top * 64 * 4, (top + 5) * 64 * 4);
};
test("64x64 opaque canvas centers in a 48x40 top viewport and composites alpha", () => {
  const png = encodePng({ width: 2, height: 1, data: new Uint8Array([200, 100, 50, 128, 255, 0, 0, 0]) });
  const image = decodePng(prepareDisplayImage(png.toString("base64")));
  assert.deepEqual([image.width, image.height], [64, 64]);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    assert.deepEqual(pixel(image, x, y), x === 31 && y === 19 ? [100, 50, 25, 255] : [0, 0, 0, 255]);
  }
});
test("status and phase fit below the untouched avatar for every activity", () => {
  const data = new Uint8Array(48 * 40 * 4).fill(255);
  const base64 = encodePng({ width: 48, height: 40, data }).toString("base64");
  const plain = decodePng(prepareDisplayImage(base64));
  for (const status of ["idle", "busy", "error"] as const) {
    for (const phase of ["idle", "thinking", "responding", "executing", "waiting", "compacting"] as const) {
      const image = decodePng(prepareDisplayImage(base64, { status, phase }));
      assert.deepEqual([image.width, image.height], [64, 64]);
      assert.deepEqual(image.data.slice(0, 40 * 64 * 4), plain.data.slice(0, 40 * 64 * 4));
      for (const top of [44, 54]) {
        let lit = 0;
        for (let y = top; y < top + 5; y++) for (let x = 0; x < 64; x++) {
          if (pixel(image, x, y).slice(0, 3).some(channel => channel > 0)) lit++;
        }
        assert.ok(lit > 0, `${status}/${phase} has text at row ${top}`);
      }
      for (let y = 59; y < 64; y++) for (let x = 0; x < 64; x++) {
        assert.deepEqual(pixel(image, x, y), [0, 0, 0, 255]);
      }
    }
  }
  assert.notDeepEqual(
    prepareDisplayImage(base64, { status: "busy", phase: "thinking" }),
    prepareDisplayImage(base64, { status: "busy", phase: "executing" }),
  );
});

test("idle errors display red IDLE while non-idle errors retain ERROR without changing activity or artwork", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([200, 80, 40, 255]) }).toString("base64");
  const plain = decodePng(prepareDisplayImage(base64));
  for (const phase of ["idle", "thinking", "responding", "executing", "waiting", "compacting"] as const) {
    for (const activeSubagents of [0, 2, 1000]) {
      const activity = { status: "error", phase, activeSubagents } as const;
      const snapshot = { ...activity };
      const image = decodePng(prepareDisplayImage(base64, activity));
      const label = phase === "idle" ? "IDLE" : "ERROR";
      const count = activeSubagents > 999 ? "999+" : String(activeSubagents);
      assert.deepEqual(statusRow(image), referenceRow(44, `${label} (${count})`, index => index > label.length ? [255, 255, 0] : [255, 96, 96]), `${phase}/${activeSubagents}`);
      assert.deepEqual(phaseRow(image), referenceRow(54, phase, [224, 224, 224]), "the unselected phase row is unchanged");
      assert.deepEqual(image.data.slice(0, 44 * 64 * 4), plain.data.slice(0, 44 * 64 * 4), "artwork and padding are unchanged");
      assert.deepEqual(image.data.slice(59 * 64 * 4), plain.data.slice(59 * 64 * 4), "bottom padding is unchanged");
      assert.deepEqual(activity, snapshot, "display copy never mutates activity");
    }
  }
});

test("agent count and parentheses are yellow while status retains its color", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }).toString("base64");
  for (const [status, color] of [["idle", [128, 224, 160]], ["busy", [255, 208, 96]], ["error", [255, 96, 96]]] as const) {
    // Both-idle subagents show SUBAGENTS; an idle error shows IDLE in red.
    const displayed = status === "idle" ? "SUBAGENTS" : status === "error" ? "IDLE" : status;
    const image = decodePng(prepareDisplayImage(base64, { status, phase: "idle", activeSubagents: 2 }));
    const left = Math.floor((64 - ((displayed.length + 4) * 4 - 1)) / 2);
    let yellow = 0;
    for (let y = 44; y < 49; y++) for (let x = 0; x < 64; x++) {
      const rgba = pixel(image, x, y);
      if (!rgba.slice(0, 3).some(value => value > 0)) continue;
      if (x >= left + (displayed.length + 1) * 4) {
        assert.deepEqual(rgba, [255, 255, 0, 255]);
        yellow++;
      } else assert.deepEqual(rgba, [...color, 255]);
    }
    assert.ok(yellow > 0);
  }
});

test("agent count changes only the status row and large counts stay bounded", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) }).toString("base64");
  const render = (activeSubagents: number) => decodePng(prepareDisplayImage(base64, { status: "busy", phase: "executing", activeSubagents }));
  const zero = render(0);
  for (const count of [1, 2, 9, 10, 123, 999, 1000, Number.MAX_SAFE_INTEGER]) {
    const image = render(count);
    assert.deepEqual(image.data.slice(0, 44 * 64 * 4), zero.data.slice(0, 44 * 64 * 4));
    assert.notDeepEqual(image.data.slice(44 * 64 * 4, 49 * 64 * 4), zero.data.slice(44 * 64 * 4, 49 * 64 * 4));
    assert.deepEqual(image.data.slice(49 * 64 * 4), zero.data.slice(49 * 64 * 4));
  }
  assert.deepEqual(render(1000), render(Number.MAX_SAFE_INTEGER));
});

test("both idle with running subagents shows SUBAGENTS and RUNNING with the count still yellow", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }).toString("base64");
  const render = (activeSubagents: number) => decodePng(prepareDisplayImage(base64, { status: "idle", phase: "idle", activeSubagents }));
  const subagents = (count: string) => referenceRow(44, `SUBAGENTS (${count})`, index => index > "SUBAGENTS".length ? [255, 255, 0] : [128, 224, 160]);
  const image = render(2);

  // Corrected spelling and colors, proven pixel-by-pixel against the shared renderer.
  assert.deepEqual(statusRow(image), subagents("2"), "status row spells SUBAGENTS with the idle status color");
  assert.notDeepEqual(statusRow(image), referenceRow(44, "SUBAGETNS (2)", index => index > "SUBAGETNS".length ? [255, 255, 0] : [128, 224, 160]), "status row no longer spells the old SUBAGETNS typo");
  assert.deepEqual(phaseRow(image), referenceRow(54, "RUNNING", [224, 224, 224]), "phase row shows RUNNING");
  let yellow = 0;
  for (let y = 44; y < 49; y++) for (let x = 0; x < 64; x++) {
    const [r, g, b] = pixel(image, x, y);
    if (r === 255 && g === 255 && b === 0) yellow++;
  }
  assert.ok(yellow > 0, "the count stays yellow after the longer status text");

  // A selected frame and contradictory host detail never override RUNNING.
  for (const state of EMOTE_STATES) {
    for (const activeSubagents of [1, 2, 1000]) {
      const selected = decodePng(prepareDisplayImage(base64, {
        status: "idle", phase: "idle", activeSubagents, state, workPhase: "planning",
      }));
      assert.deepEqual(statusRow(selected), subagents(activeSubagents > 999 ? "999+" : String(activeSubagents)), state);
      assert.deepEqual(phaseRow(selected), referenceRow(54, "RUNNING", [224, 224, 224]), state);
    }
  }

  // The >999 cap is retained inside the longer label.
  assert.deepEqual(statusRow(render(1000)), subagents("999+"));
  assert.deepEqual(statusRow(render(Number.MAX_SAFE_INTEGER)), statusRow(render(1000)));
});

test("the SUBAGENTS override applies only when both status and phase are idle with a positive count", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }).toString("base64");
  const render = (activity: Record<string, unknown>) => decodePng(prepareDisplayImage(base64, activity as never));
  const idleCount = (count: string) => referenceRow(44, `idle (${count})`, index => index > 4 ? [255, 255, 0] : [128, 224, 160]);
  const busyCount = (count: string) => referenceRow(44, `busy (${count})`, index => index > 4 ? [255, 255, 0] : [255, 208, 96]);

  // Zero subagents keeps the ordinary idle labels on both rows.
  const plain = render({ status: "idle", phase: "idle" });
  assert.deepEqual(statusRow(plain), idleCount("0"));
  assert.deepEqual(phaseRow(plain), referenceRow(54, "idle", [224, 224, 224]));

  // Only the status is idle: the ordinary labels stay.
  const statusOnly = render({ status: "idle", phase: "thinking", activeSubagents: 3 });
  assert.deepEqual(statusRow(statusOnly), idleCount("3"));
  assert.deepEqual(phaseRow(statusOnly), referenceRow(54, "thinking", [224, 224, 224]));

  // Only the phase is idle: the ordinary labels stay.
  const phaseOnly = render({ status: "busy", phase: "idle", activeSubagents: 3 });
  assert.deepEqual(statusRow(phaseOnly), busyCount("3"));
  assert.deepEqual(phaseRow(phaseOnly), referenceRow(54, "idle", [224, 224, 224]));
});

test("custom background composites transparency but preserves opaque black artwork", () => {
  const png = encodePng({ width: 3, height: 1, data: new Uint8Array([
    200, 100, 50, 128, 255, 0, 0, 0, 0, 0, 0, 255,
  ]) });
  const image = decodePng(prepareDisplayImage(png.toString("base64"), undefined, "#404040"));
  assert.deepEqual(pixel(image, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 29, 19), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 33, 19), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 31, 40), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 31, 63), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 30, 19), [132, 82, 57, 255]);
  assert.deepEqual(pixel(image, 31, 19), [64, 64, 64, 255]);
  assert.deepEqual(pixel(image, 32, 19), [0, 0, 0, 255]);
  assert.throws(() => prepareDisplayImage(png.toString("base64"), undefined, "gray"));
});

test("static background coverage dims only transparent sprite pixels without temporal changes", () => {
  const base64 = encodePng({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) }).toString("base64");
  const body = prepareDisplayImage(base64, undefined, "#383838", 0.75);
  const image = decodePng(body);
  let gray = 0;
  for (let y = 16; y < 24; y++) for (let x = 28; x < 36; x++) {
    const rgba = pixel(image, x, y);
    if (rgba[0] === 56) { gray++; assert.deepEqual(rgba, [56, 56, 56, 255]); }
    else assert.deepEqual(rgba, [0, 0, 0, 255]);
  }
  assert.equal(gray, 48);
  assert.deepEqual(body, prepareDisplayImage(base64, undefined, "#383838", 0.75));
  const opaque = encodePng({ width: 1, height: 1, data: new Uint8Array([120, 80, 40, 255]) }).toString("base64");
  assert.deepEqual(prepareDisplayImage(opaque, undefined, "#383838", 0.75), prepareDisplayImage(opaque, undefined, "#383838", 1));
  assert.throws(() => prepareDisplayImage(base64, undefined, "#383838", -1));
});

test("white outline follows the external silhouette without filling holes or touching labels", () => {
  const data = new Uint8Array(5 * 5 * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
    if (x !== 2 || y !== 2) data.set([200, 80, 40, 255], (y * 5 + x) * 4);
  }
  const base64 = encodePng({ width: 5, height: 5, data }).toString("base64");
  const activity = { status: "busy", phase: "thinking", activeSubagents: 0 } as const;
  const plain = decodePng(prepareDisplayImage(base64, activity));
  const outlined = decodePng(prepareDisplayImage(base64, activity, "#000000", 1, "#ffffff"));
  assert.deepEqual(pixel(outlined, 31, 19), [0, 0, 0, 255], "enclosed hole stays black");
  assert.deepEqual(pixel(outlined, 30, 18), [200, 80, 40, 255], "artwork stays intact");
  assert.deepEqual(pixel(outlined, 29, 17), [255, 255, 255, 255]);
  assert.deepEqual(pixel(outlined, 33, 21), [255, 255, 255, 255]);
  assert.deepEqual(pixel(outlined, 28, 17), [0, 0, 0, 255], "outline is only one pixel");
  assert.deepEqual(outlined.data.slice(41 * 64 * 4), plain.data.slice(41 * 64 * 4));
});

test("alpha silhouettes preserve opaque black artwork and outline only the sprite", () => {
  const data = new Uint8Array(3 * 3 * 4);
  data.set([0, 0, 0, 255], (1 * 3 + 1) * 4);
  const base64 = encodePng({ width: 3, height: 3, data }).toString("base64");
  const image = decodePng(prepareDisplayImage(base64, undefined, "#000000", 1, "#ffffff"));
  assert.deepEqual(pixel(image, 31, 19), [0, 0, 0, 255]);
  for (let y = 18; y <= 20; y++) for (let x = 30; x <= 32; x++) {
    if (x !== 31 || y !== 19) assert.deepEqual(pixel(image, x, y), [255, 255, 255, 255]);
  }
  assert.throws(() => prepareDisplayImage(base64, undefined, "#000000", 1, "white"));
});

test("oversize downscales proportionally with nearest-neighbor", () => {
  const data = new Uint8Array(128 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) data.set([x, y, 30, 255], (y * 128 + x) * 4);
  const image = decodePng(prepareDisplayImage(encodePng({ width: 128, height: 64, data }).toString("base64")));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) assert.deepEqual(pixel(image, x, y), x >= 8 && x < 56 && y >= 8 && y < 32 ? [Math.floor((x - 8) * 128 / 48), Math.floor((y - 8) * 64 / 24), 30, 255] : [0, 0, 0, 255]);
});

test("the detailed work phase replaces the phase row only while the coarse label is not more truthful", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }).toString("base64");
  const render = (activity: Record<string, unknown>) => prepareDisplayImage(base64, activity as never);
  const thinking = { status: "busy", phase: "thinking" };

  // The detail is what gets drawn while thinking or executing.
  assert.notDeepEqual(render({ ...thinking, workPhase: "planning" }), render(thinking));
  assert.deepEqual(
    render({ status: "busy", phase: "thinking", workPhase: "authorizing" }),
    render({ status: "busy", phase: "executing", workPhase: "authorizing" }),
    "the phase row shows the detailed phase regardless of which eligible coarse label it replaces",
  );

  // Waiting, compacting, idle and responding keep their own truthful labels.
  for (const phase of ["idle", "responding", "waiting", "compacting"] as const) {
    const plain = render({ status: "busy", phase });
    assert.deepEqual(render({ status: "busy", phase, workPhase: "implementing" }), plain, phase);
  }

  // Invalid detail falls back to the coarse label; omitting it stays supported.
  assert.deepEqual(render({ ...thinking, workPhase: "hacking" }), render(thinking));
  assert.deepEqual(render(thinking), render({ status: "busy", phase: "thinking", activeSubagents: 0 }));
});

test("the selected PNG state is the truthful detail label regardless of the coarse phase", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }).toString("base64");
  const render = (activity: Record<string, unknown>) => prepareDisplayImage(base64, activity as never);
  const thinking = { status: "busy", phase: "thinking" };
  const executing = { status: "busy", phase: "executing" };

  // A selected exploring state labels exploring instead of the generic coarse label.
  assert.notDeepEqual(render({ ...thinking, state: "exploring" }), render(thinking));
  assert.deepEqual(
    render({ ...executing, state: "exploring" }),
    render({ ...thinking, workPhase: "exploring" }),
    "the selected state renders the same bytes as the existing detailed work-phase path",
  );

  // The selected state wins over a different published work phase.
  assert.deepEqual(
    render({ ...thinking, state: "exploring", workPhase: "planning" }),
    render({ ...thinking, state: "exploring" }),
  );
  assert.notDeepEqual(
    render({ ...thinking, state: "exploring", workPhase: "planning" }),
    render({ ...thinking, workPhase: "planning" }),
  );

  // Each of the eight host phases renders through the selected state.
  for (const phase of ["authorizing", "exploring", "researching", "deciding", "planning", "implementing", "checking", "closing"] as const) {
    assert.deepEqual(render({ ...executing, state: phase }), render({ ...thinking, workPhase: phase }), phase);
    assert.notDeepEqual(render({ ...executing, state: phase }), render(executing), phase);
  }

  // Ordinary demo states label themselves too, rather than a coarse or host phase.
  const explore = decodePng(render({ ...executing, state: "explore", workPhase: "implementing" }));
  assert.deepEqual(phaseRow(explore), referenceRow(54, "EXPLORING", [224, 224, 224]));

  // The selected state is the exact frame being shown, so it now labels the phase
  // row under every coarse phase, including the truthful emote-own ones.
  for (const phase of ["idle", "responding", "waiting", "compacting"] as const) {
    assert.deepEqual(
      render({ status: "busy", phase, state: "exploring" }),
      render({ status: "busy", phase: "thinking", state: "exploring" }),
      phase,
    );
    assert.deepEqual(
      render({ status: "busy", phase, state: "exploring", workPhase: "planning" }),
      render({ status: "busy", phase: "thinking", state: "exploring" }),
      phase,
    );
  }
});

test("the selected state labels the phase row under idle with no subagents, as /emote status reports", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }).toString("base64");
  const render = (activity: Record<string, unknown>) => decodePng(prepareDisplayImage(base64, activity as never));
  const plain = render({ status: "idle", phase: "idle" });
  const image = render({ status: "idle", phase: "idle", activeSubagents: 0, state: "exploring" });

  // The artwork and the status row stay byte-identical to the plain idle render.
  assert.deepEqual(image.data.slice(0, 44 * 64 * 4), plain.data.slice(0, 44 * 64 * 4));
  assert.deepEqual(statusRow(image), referenceRow(44, "idle (0)", index => index > 4 ? [255, 255, 0] : [128, 224, 160]));

  // The phase row spells the selected PNG state exactly, without any host phase.
  assert.deepEqual(phaseRow(image), referenceRow(54, "exploring", [224, 224, 224]));
});

// Independent display copy oracle: state identifiers remain unchanged.
const expectedStateLabels: Record<(typeof EMOTE_STATES)[number], string> = {
  hi: "HI", idle: "IDLE", think: "THINKING", talk: "TALKING",
  read: "READING", write: "WRITING", tool: "TOOL",
  success: "SUCCESS", failure: "FAILURE", compact: "COMPACTING",
  ask: "ASKING", grandma: "GRANDMA", bye: "BYE",
  delegate: "DELEGATING", jobs: "JOBS", remember: "REMEMBERING",
  yolo: "YOLO", "super-yolo": "SUPER-YOLO", explore: "EXPLORING",
  build: "BUILDING", verify: "VERIFYING", judge: "JUDGING",
  review: "REVIEWING", jira: "JIRA",
  authorizing: "AUTHORIZING", exploring: "EXPLORING",
  researching: "RESEARCHING", deciding: "DECIDING", planning: "PLANNING",
  implementing: "IMPLEMENTING", checking: "CHECKING", closing: "CLOSING",
};

for (const state of EMOTE_STATES) {
  test(`selected demo state ${state} names the phase under every coarse phase and contradictory host detail`, () => {
    const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }).toString("base64");
    const plain = decodePng(prepareDisplayImage(base64, { status: "busy", phase: "executing" }));
    for (const status of ["idle", "busy", "error"] as const) {
      for (const phase of ["idle", "thinking", "responding", "executing", "waiting", "compacting"] as const) {
        for (const workPhase of [undefined, state === "planning" ? "checking" : "planning"] as const) {
          const activity = { status, phase, activeSubagents: 0, workPhase };
          const image = decodePng(prepareDisplayImage(base64, { ...activity, state }));
          const withoutState = decodePng(prepareDisplayImage(base64, activity));
          assert.deepEqual(phaseRow(image), referenceRow(54, expectedStateLabels[state], [224, 224, 224]), `${status}/${phase}/${workPhase}`);
          assert.deepEqual(statusRow(image), statusRow(withoutState), "selection never changes the status row");
          assert.deepEqual(image.data.slice(0, 44 * 64 * 4), plain.data.slice(0, 44 * 64 * 4), "artwork stays unchanged");
          assert.deepEqual(image.data.slice(59 * 64 * 4), plain.data.slice(59 * 64 * 4), "bottom padding stays unchanged");
        }
      }
    }
  });
}

test("super-yolo retains its literal three-pixel hyphen in the phase row", () => {
  const base64 = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }).toString("base64");
  const image = decodePng(prepareDisplayImage(base64, { status: "busy", phase: "executing", state: "super-yolo" }));
  // Ten characters center at x=12; the sixth character starts at x=32.
  // Explicit pixels avoid using the same possibly incomplete glyph table as the oracle.
  for (let y = 54; y < 59; y++) for (let x = 32; x < 35; x++) {
    assert.deepEqual(pixel(image, x, y), y === 56 ? [224, 224, 224, 255] : [0, 0, 0, 255]);
  }
});
