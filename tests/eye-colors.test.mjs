// Tobi's eye colours (src/core/eye-colors.ts): what is stored, what each state
// shows, the presets, and the engine and the island's glow following them.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EYES, EYE_PRESETS, currentEyes, eyeColor, presetOf, sanitizeEyes, setEyeColors, stateEyeColor,
} from "../src/core/eye-colors.ts";
import { BOT_STATES, hexToRGB } from "../src/tobi/engine.ts";
import { botGlowColor } from "../src/core/layout.ts";

test("only the three groups and real colours are kept", () => {
  assert.deepEqual(sanitizeEyes({ busy: "#ffc93d", done: "green", error: 4, other: "#000000" }), { busy: "#FFC93D" });
  assert.deepEqual(sanitizeEyes(null), {});
  assert.deepEqual(sanitizeEyes(["#FFFFFF"]), {});
});

test("a group paints its states; idle and sleeping keep their own", () => {
  const eyes = { busy: "#FFC93D", error: "#F472B6" };
  assert.equal(stateEyeColor(eyes, "working"), "#FFC93D");
  assert.equal(stateEyeColor(eyes, "approval"), "#FFC93D");
  assert.equal(stateEyeColor(eyes, "ratelimit"), "#F472B6");
  assert.equal(stateEyeColor(eyes, "finished"), null);
  assert.equal(stateEyeColor(eyes, "idle"), null);
  assert.equal(eyeColor(eyes, "done"), DEFAULT_EYES.done);
});

test("the presets are recognised, and Classic is no choice at all", () => {
  for (const p of EYE_PRESETS) assert.equal(presetOf(p.colors), p.id);
  assert.equal(presetOf({}), "classic");
  assert.equal(presetOf({ busy: "#FFC93D" }), null);
});

test("the engine's states and the island's glow follow the colours, and come back", () => {
  const working = BOT_STATES.working.color;
  setEyeColors({ busy: "#FFC93D", done: "#60A5FA" });
  assert.deepEqual(currentEyes(), { busy: "#FFC93D", done: "#60A5FA" });
  assert.deepEqual(BOT_STATES.working.color, hexToRGB("#FFC93D"));
  assert.deepEqual(BOT_STATES.finished.badge.color, hexToRGB("#60A5FA"));
  assert.equal(botGlowColor("thinking"), "#FFC93D");
  setEyeColors({});
  assert.deepEqual(BOT_STATES.working.color, working);
  assert.equal(botGlowColor("finished"), "#34D399");
});
