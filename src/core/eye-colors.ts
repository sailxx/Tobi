// Tobi's eye colours, the user's own: one colour for each of three groups of
// states (busy or asking, done, error), picked in the Tobi window → Tobi.
// Stored as `eyeColors` ({ busy, done, error } → "#RRGGBB"); an empty map, or
// anything that is not a colour, keeps the built-in colour of every state.
// No DOM: tests/eye-colors.test.mjs runs it as it is.

import type { BotStateName } from "./layout";
import { N_ } from "../i18n/i18n";

export type EyeGroup = "busy" | "done" | "error";

export const EYE_GROUPS: readonly EyeGroup[] = ["busy", "done", "error"];

/** Which states each group paints. Idle, sleeping and dizzy keep their own. */
export const GROUP_STATES: Record<EyeGroup, readonly BotStateName[]> = {
  busy: ["working", "thinking", "searching", "question", "approval"],
  done: ["finished"],
  error: ["error", "ratelimit"],
};

/** What each group looks like with no choice of the user's: the colour of its main state. */
export const DEFAULT_EYES: Record<EyeGroup, string> = { busy: "#3B9EFF", done: "#34D399", error: "#F4505E" };

/** The colours offered for each group. */
export const EYE_SWATCHES: Record<EyeGroup, readonly string[]> = {
  busy: ["#3B9EFF", "#F5A524", "#FFC93D", "#FF6F9C", "#B89CFF", "#22D3EE"],
  done: ["#34D399", "#86EFAC", "#C6E98F", "#2DD4BF", "#60A5FA", "#F5F6F8"],
  error: ["#F4505E", "#FF8D97", "#E11D48", "#FF7A1A", "#F472B6", "#A855F7"],
};

export interface EyePreset {
  id: string;
  /** An English key, shown with `t()`. */
  title: string;
  /** Empty: the built-in colours. */
  colors: Partial<Record<EyeGroup, string>>;
}

export const EYE_PRESETS: readonly EyePreset[] = [
  { id: "classic", title: N_("Classic"), colors: {} },
  { id: "soft", title: N_("Soft"), colors: { busy: "#FFC93D", done: "#86EFAC", error: "#FF8D97" } },
  // Orange, blue and magenta tell apart with every common colour blindness.
  { id: "colourblind", title: N_("Colour-blind"), colors: { busy: "#F5A524", done: "#60A5FA", error: "#F472B6" } },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Only the three groups, only colours, upper case. */
export function sanitizeEyes(raw: unknown): Partial<Record<EyeGroup, string>> {
  const out: Partial<Record<EyeGroup, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const g of EYE_GROUPS) {
    const v = (raw as Record<string, unknown>)[g];
    if (typeof v === "string" && HEX.test(v)) out[g] = v.toUpperCase();
  }
  return out;
}

/** The colour a group shows: the user's, else the built-in one. */
export function eyeColor(eyes: Partial<Record<EyeGroup, string>>, group: EyeGroup): string {
  return eyes[group] ?? DEFAULT_EYES[group];
}

/** The user's colour for this state, or null when it keeps its own. */
export function stateEyeColor(eyes: Partial<Record<EyeGroup, string>>, state: BotStateName): string | null {
  for (const g of EYE_GROUPS) if (GROUP_STATES[g].includes(state)) return eyes[g] ?? null;
  return null;
}

/** The preset these colours are, if any. */
export function presetOf(eyes: Partial<Record<EyeGroup, string>>): string | null {
  const s = sanitizeEyes(eyes);
  for (const p of EYE_PRESETS) {
    if (EYE_GROUPS.every((g) => (s[g] ?? null) === (p.colors[g] ?? null))) return p.id;
  }
  return null;
}

// ── What this window shows ────────────────────────────────────────────────────

let current: Partial<Record<EyeGroup, string>> = {};
const listeners = new Set<() => void>();

/** Every window calls this with its settings; the engines and the island's glow follow. */
export function setEyeColors(raw: unknown) {
  const next = sanitizeEyes(raw);
  if (EYE_GROUPS.every((g) => next[g] === current[g])) return;
  current = next;
  for (const l of listeners) l();
}

export function currentEyes(): Partial<Record<EyeGroup, string>> {
  return current;
}

export function onEyeColors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
