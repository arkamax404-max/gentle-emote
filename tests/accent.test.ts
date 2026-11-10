import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng, encodePng } from "../src/png.ts";
import { ACCENT_KEYS, BANNER_ACCENTS, accentShades, bannerConfigCandidates, createAccentTransform, resolveAccent } from "../src/accent.ts";

function image(pixels: number[][]) {
  const data = new Uint8Array(pixels.flat());
  return { width: pixels.length, height: 1, data };
}

test("encodePng/decodePng round-trip RGBA pixels", () => {
  const source = image([[1, 2, 3, 255], [255, 0, 255, 255], [0, 0, 0, 0]]);
  const decoded = decodePng(encodePng(source));
  assert.equal(decoded.width, 3);
  assert.deepEqual([...decoded.data], [...source.data]);
});

test("accent transform swaps only the key colors", () => {
  const png = encodePng(image([[...ACCENT_KEYS.base, 255], [...ACCENT_KEYS.shade, 255], [...ACCENT_KEYS.light, 255], [10, 20, 30, 255]]));
  const cyan = BANNER_ACCENTS.cyan!;
  const out = decodePng(Buffer.from(createAccentTransform(cyan)(png.toString("base64")), "base64"));
  const shades = accentShades(cyan);
  assert.deepEqual([...out.data.subarray(0, 3)], shades.base);
  assert.deepEqual([...out.data.subarray(4, 7)], shades.shade);
  assert.deepEqual([...out.data.subarray(8, 11)], shades.light);
  assert.deepEqual([...out.data.subarray(12, 15)], [10, 20, 30]);
});

test("accent transform returns frames without key colors untouched", () => {
  const b64 = encodePng(image([[1, 1, 1, 255]])).toString("base64");
  assert.equal(createAccentTransform(BANNER_ACCENTS.pink!)(b64), b64);
});

test("resolveAccent reads Gentle Shell's banner color and skips broken files", () => {
  const dir = mkdtempSync(join(tmpdir(), "gentle-emote-"));
  mkdirSync(join(dir, "a"));
  mkdirSync(join(dir, "b"));
  writeFileSync(join(dir, "a", "banner.json"), "{not json");
  writeFileSync(join(dir, "b", "banner.json"), JSON.stringify({ showRose: true, showTextLogo: true, color: "green" }));
  const candidates = [join(dir, "missing", "banner.json"), join(dir, "a", "banner.json"), join(dir, "b", "banner.json")];
  assert.deepEqual(resolveAccent("auto", candidates), BANNER_ACCENTS.green);
  assert.deepEqual(resolveAccent("auto", []), BANNER_ACCENTS.pink);
  assert.deepEqual(resolveAccent("yellow", candidates), BANNER_ACCENTS.yellow);
  assert.deepEqual(resolveAccent("#102030", candidates), [16, 32, 48]);
});

test("bannerConfigCandidates follows Gentle Shell's precedence", () => {
  const configHome = join("/", "cfg");
  const agentDir = join("/", "lab", "agent");
  const home = join("/", "home", "u");
  const list = bannerConfigCandidates({ GENTLE_PI_CONFIG_HOME: configHome, PI_CODING_AGENT_DIR: agentDir }, home);
  assert.deepEqual(list, [
    join(configHome, "banner.json"),
    join("/", "lab", "gentle-ai", "banner.json"),
    join(agentDir, "gentle-ai", "banner.json"),
    join(home, ".gentle-shell", "gentle-ai", "banner.json"),
    join(home, ".pi", "gentle-ai", "banner.json"),
  ]);
});
