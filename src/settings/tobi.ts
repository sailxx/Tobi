// Tobi → Tobi: Tobi himself with what he got done, his name, and the colour
// of his eyes for each group of states (busy or asking, done, error). A click
// on a group's row shows Tobi in that state for a moment.

import { h, clear } from "../views/dom";
import { t } from "../i18n/i18n";
import { Bridge } from "../core/bridge";
import { liveTobi } from "../hub/hero";
import { number } from "../hub/ui";
import { homeStats } from "../recap/summary";
import {
  EYE_GROUPS, EYE_PRESETS, EYE_SWATCHES, eyeColor, presetOf, sanitizeEyes, setEyeColors,
  type EyeGroup,
} from "../core/eye-colors";
import type { BotStateName } from "../core/layout";

/** "Tobi" unless he was given a name of his own. */
export function tobiName(name: string | undefined): string {
  return name?.trim() || "Tobi";
}

const GROUP_TITLE: Record<EyeGroup, () => string> = {
  busy: () => t("Working or a question"),
  done: () => t("Done"),
  error: () => t("Error"),
};

/** The state a group's row shows Tobi in when it is clicked. */
const GROUP_DEMO: Record<EyeGroup, BotStateName> = { busy: "working", done: "finished", error: "error" };

export interface TobiPrefs {
  tobiName: string;
  eyeColors: Record<string, string>;
}

export function tobiSections(prefs: TobiPrefs, save: (change: Partial<TobiPrefs>) => void): HTMLElement[] {
  // ── Tobi and what he did ──
  const canvas = h("canvas", {}) as HTMLCanvasElement;
  const engine = liveTobi(canvas);
  const title = h("b", { text: tobiName(prefs.tobiName) });
  const line = h("span", { text: " " });
  void Bridge.recapHistory(Date.now() / 1000 - 84 * 86_400).then((history) => {
    const s = homeStats(history?.turns ?? []);
    line.textContent = `${number(s.done)} ${t("tasks done")} · ${number(s.streak)} ${t("days in a row")}`;
  });
  const card = h("div", { class: "tobi-card" }, h("div", { class: "pic" }, canvas), h("div", { class: "who" }, title, line));

  // ── His name ──
  const field = h("input", { type: "text", maxlength: "24", placeholder: "Tobi", value: prefs.tobiName }) as HTMLInputElement;
  const keep = h("button", { class: "primary", text: t("Save") }) as HTMLButtonElement;
  const saveName = () => {
    const name = field.value.trim();
    field.value = name;
    title.textContent = tobiName(name);
    save({ tobiName: name });
    prefs = { ...prefs, tobiName: name };
    keep.disabled = true;
  };
  keep.disabled = true;
  field.addEventListener("input", () => (keep.disabled = field.value.trim() === prefs.tobiName.trim()));
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !keep.disabled) saveName();
  });
  keep.addEventListener("click", saveName);
  const nameSection = h("section", {},
    h("h2", {}, h("span", { text: t("Name") })),
    h("div", { class: "row" }, h("label", { text: t("What's his name?") }), field, keep),
    h("div", { class: "hint", text: t("Shown in the Tobi window and the wardrobe. « OK Tobi » stays the wake word.") }),
  );

  // ── His eyes ──
  let eyes = sanitizeEyes(prefs.eyeColors);
  const presets = h("div", { class: "eye-presets" });
  const rows = h("div", { class: "eye-rows" });
  let demo = 0;

  const setEyes = (next: Partial<Record<EyeGroup, string>>) => {
    eyes = sanitizeEyes(next);
    setEyeColors(eyes);
    save({ eyeColors: eyes as Record<string, string> });
    draw();
  };

  const show = (group: EyeGroup) => {
    engine.setState(GROUP_DEMO[group]);
    window.clearTimeout(demo);
    demo = window.setTimeout(() => engine.setState("idle"), 2600);
  };

  function draw() {
    clear(presets);
    const on = presetOf(eyes);
    for (const p of EYE_PRESETS) {
      const dots = h("span", { class: "dots" }, ...EYE_GROUPS.map((g) =>
        h("i", { style: `background:${eyeColor(p.colors, g)}` })));
      presets.append(h("button", {
        class: p.id === on ? "on" : "", "aria-pressed": String(p.id === on),
        onclick: () => setEyes(p.colors),
      }, dots, h("span", { text: t(p.title) })));
    }
    clear(rows);
    for (const g of EYE_GROUPS) {
      const current = eyeColor(eyes, g);
      const swatches = h("div", { class: "swatches" });
      for (const c of EYE_SWATCHES[g]) {
        const pick = h("button", {
          class: c === current ? "swatch on" : "swatch",
          style: `background:${c}`,
          title: c, "aria-label": c, "aria-pressed": String(c === current),
          onclick: (e: Event) => {
            e.stopPropagation();
            setEyes({ ...eyes, [g]: c });
            show(g);
          },
        });
        swatches.append(pick);
      }
      rows.append(h("div", { class: "eye-row", onclick: () => show(g) },
        h("i", { class: "dot", style: `background:${current}` }),
        h("span", { class: "nm", text: GROUP_TITLE[g]() }),
        swatches,
      ));
    }
  }
  draw();

  const eyesSection = h("section", {},
    h("h2", {}, h("span", { text: t("State colours") })),
    h("div", { class: "hint", text: t("Pick a colour for each state. Click a row to see it.") }),
    presets,
    rows,
  );

  return [card, nameSection, eyesSection];
}
