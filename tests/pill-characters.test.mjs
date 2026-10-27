// Pills that can be hidden, the main pill's choices, and the characters the
// pills' Tobis wear (src/tobi/personas.ts).

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAIN_FAVOURITES, PILL_CATALOG, availablePills, chooseMainPill, mainPillChoices, sanitizeDeclared, sanitizeHidden,
  toggleHidden,
} from "../src/core/pills.ts";
import { DEFAULT_SETTINGS, State } from "../src/core/state.ts";
import { drawPersonaBehind, drawPersonaFront, hasPersona, personaIds } from "../src/tobi/personas.ts";

const d = (main, active) => ({ mainPill: main, activeIntegrations: active });

// ── Main pill ─────────────────────────────────────────────────────────────────

test("Claude Code, Codex and Claude Desktop can each be the main pill on Windows and the Mac", () => {
  for (const os of ["windows", "macos"]) {
    const ids = mainPillChoices(os).map((p) => p.id);
    for (const id of MAIN_FAVOURITES) assert.ok(ids.includes(id), `${os}: ${id}`);
  }
  // The Claude desktop app has no Linux build.
  assert.ok(!mainPillChoices("linux").some((p) => p.id === "agent_claude-desktop"));
  assert.ok(mainPillChoices("linux").some((p) => p.id === "agent_codex"));
});

test("choosing a declared pill as the main one moves it out of the declared list", () => {
  const next = chooseMainPill(d("integration_claude", ["agent_codex", "integration_github"]), "agent_codex", "windows");
  assert.deepEqual(next, d("agent_codex", ["integration_github"]));
  assert.equal(chooseMainPill(d("integration_claude", []), "integration_github", "windows"), null);
});

// ── Hiding ────────────────────────────────────────────────────────────────────

test("only declared pills can be hidden, never the main one, and without duplicates", () => {
  const decl = d("integration_claude", ["agent_codex", "integration_github"]);
  assert.deepEqual(sanitizeHidden(["agent_codex", "agent_codex", "integration_claude", "agent_gemini", 5], decl), ["agent_codex"]);
  assert.deepEqual(sanitizeHidden(undefined, decl), []);
  assert.equal(toggleHidden([], decl, "integration_claude"), null);
  assert.equal(toggleHidden([], decl, "agent_gemini"), null);
  assert.deepEqual(toggleHidden([], decl, "agent_codex"), ["agent_codex"]);
  assert.deepEqual(toggleHidden(["agent_codex"], decl, "agent_codex"), []);
});

beforeEach(() => {
  State.focusId = null;
  State.os = "windows";
  State.pendingApproval = null;
  State.settings = { ...DEFAULT_SETTINGS, mainPill: "integration_claude", activeIntegrations: ["agent_codex", "integration_github"], hiddenPills: [] };
  State.tasks = [];
  State.loadIntegrationTasks();
});

test("a hidden pill is left out of the strip but stays declared and keeps its session", () => {
  State.toggleHiddenPill("agent_codex");
  assert.deepEqual(State.settings.hiddenPills, ["agent_codex"]);
  assert.ok(!State.otherTasks.some((t) => t.id === "agent_codex"));
  assert.ok(State.tasks.some((t) => t.id === "agent_codex"));
  assert.deepEqual(State.settings.activeIntegrations, ["agent_codex", "integration_github"]);
  // Events still land on it.
  State.updateTask("agent_codex", "working");
  assert.equal(State.tasks.find((t) => t.id === "agent_codex").state, "working");
  assert.ok(State.isHidden("agent_codex"));
  State.toggleHiddenPill("agent_codex");
  assert.ok(State.otherTasks.some((t) => t.id === "agent_codex"));
});

test("a hidden pill comes back while it waits for an answer", () => {
  State.toggleHiddenPill("agent_codex");
  State.updateTask("agent_codex", "approval");
  assert.ok(!State.isHidden("agent_codex"));
  State.updateTask("agent_codex", "idle");
  assert.ok(State.isHidden("agent_codex"));
  State.beginApproval({ requestId: "r", sessionId: "s", pillId: "agent_codex", tool: "Bash", command: "ls" });
  assert.ok(!State.isHidden("agent_codex"));
  State.endApproval();
  assert.ok(State.isHidden("agent_codex"));
});

test("the main pill cannot be hidden, and a hidden main-to-be is no longer hidden", () => {
  State.toggleHiddenPill("integration_claude");
  assert.deepEqual(State.settings.hiddenPills, []);
  State.toggleHiddenPill("agent_codex");
  const next = chooseMainPill(sanitizeDeclared(State.settings, "windows"), "agent_codex", "windows");
  assert.deepEqual(sanitizeHidden(State.settings.hiddenPills, next), []);
});

test("an undeclared pill drops out of the hidden list", () => {
  State.toggleHiddenPill("agent_codex");
  State.toggleIntegration("agent_codex");
  assert.deepEqual(sanitizeHidden(State.settings.hiddenPills, sanitizeDeclared(State.settings, "windows")), []);
});

// ── Characters ────────────────────────────────────────────────────────────────

test("every pill an agent or service can have has a character, and each is its own", () => {
  const offered = availablePills("windows").filter((p) => p.id !== "integration_music");
  for (const p of offered) assert.ok(hasPersona(p.id), p.id);
  assert.ok(!hasPersona("agent_somebody_new"));
  assert.equal(new Set(personaIds()).size, personaIds().length);
  for (const id of personaIds()) assert.ok(PILL_CATALOG.some((p) => p.id === id), `${id} is in the catalog`);
});

/** A canvas context that accepts every call and says which ones were made. */
function recorder() {
  const calls = [];
  return new Proxy({}, {
    get(_, name) {
      if (name === "calls") return calls;
      return (...args) => { calls.push([name, args]); };
    },
    set() { return true; },
  });
}

test("every character draws in every state and turn without throwing or leaving the canvas state unbalanced", () => {
  for (const id of personaIds()) {
    for (const active of [false, true]) {
      for (const yaw of [-0.8, 0, 0.8]) {
        for (const t of [0, 1.7]) {
          const pose = { R: 12, rx: 12, ry: 11.5, yaw, t, active, hi: "#eee", mid: "#aaa", ink: "#111" };
          const x = recorder();
          drawPersonaBehind(x, id, pose);
          drawPersonaFront(x, id, pose);
          const n = (name) => x.calls.filter(([c]) => c === name).length;
          assert.equal(n("save"), n("restore"), id);
        }
      }
    }
  }
});

test("a character stays out of the way of a body too small to show it", () => {
  const x = recorder();
  drawPersonaFront(x, "integration_claude", { R: 3, rx: 3, ry: 3, yaw: 0, t: 0, active: false, hi: "#fff", mid: "#ccc", ink: "#000" });
  assert.equal(x.calls.length, 0);
});

test("with reduced motion a character holds still (t = 0 draws the same frame twice)", () => {
  for (const id of personaIds()) {
    const frames = [0, 0].map(() => {
      const x = recorder();
      drawPersonaFront(x, id, { R: 12, rx: 12, ry: 11.5, yaw: 0, t: 0, active: true, hi: "#eee", mid: "#aaa", ink: "#111" });
      return JSON.stringify(x.calls);
    });
    assert.equal(frames[0], frames[1], id);
  }
});
