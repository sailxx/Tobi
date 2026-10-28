// Tobi → Tobi: one page around one big Tobi. His name is the page's title and
// is edited in place; under him, his wardrobe as a rail of round tokens
// (hovering one tries it on him, a click keeps it), then the colour of each
// group of states (busy or asking, done, error). A click on a group's row
// shows him in that state for a moment.

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
import { drawWardrobeIcon } from "../tobi/outfits";
import {
  OUTFIT_KEYS, OUTFIT_SELECTIONS, WARDROBE_STRINGS, parseOutfit, resolveOutfit, seasonalOutfit,
  type OutfitSelection,
} from "../tobi/wardrobe";

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

/** The size outfits.ts draws a wardrobe icon at, and the size a token shows it. */
const ICON = 28;
const TOKEN = 40;

export interface TobiPrefs {
  tobiName: string;
  eyeColors: Record<string, string>;
  tobiOutfit: string;
}

export function tobiPage(prefs: TobiPrefs, save: (change: Partial<TobiPrefs>) => void): HTMLElement[] {
  const canvas = h("canvas", {}) as HTMLCanvasElement;
  const engine = liveTobi(canvas);
  const season = seasonalOutfit(new Date());
  let outfit = parseOutfit(prefs.tobiOutfit);

  // ── Who he is: the name, what he wears, what he did ──
  const name = h("input", {
    class: "tobi-name", type: "text", maxlength: "24", placeholder: "Tobi", value: prefs.tobiName,
    "aria-label": t("What's his name?"), spellcheck: "false",
  }) as HTMLInputElement;
  const keepName = () => {
    const next = name.value.trim();
    name.value = next;
    if (next === prefs.tobiName.trim()) return;
    prefs = { ...prefs, tobiName: next };
    save({ tobiName: next });
  };
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") name.blur();
    if (e.key === "Escape") {
      name.value = prefs.tobiName;
      name.blur();
    }
  });
  name.addEventListener("blur", keepName);

  const wearing = h("div", { class: "tobi-wearing" });
  const done = h("b", { text: "–" });
  const streak = h("b", { text: "–" });
  void Bridge.recapHistory(Date.now() / 1000 - 84 * 86_400).then((history) => {
    const s = homeStats(history?.turns ?? []);
    done.textContent = number(s.done);
    streak.textContent = number(s.streak);
  });
  const facts = h("div", { class: "tobi-facts" },
    h("span", {}, done, h("span", { text: t("tasks done") })),
    h("span", {}, streak, h("span", { text: t("days in a row") })),
  );
  const hero = h("div", { class: "tobi-hero" },
    h("div", { class: "tobi-stage" }, canvas),
    h("div", { class: "tobi-id" },
      h("div", { class: "tobi-kicker", text: t("Name") }),
      name,
      h("div", { class: "tobi-hint", text: t("Shown in the Tobi window and the wardrobe. « OK Tobi » stays the wake word.") }),
      wearing,
      facts,
    ),
  );

  // ── His wardrobe ──
  const wear = (selection: OutfitSelection) => {
    engine.setOutfit(resolveOutfit(selection, new Date()));
    wearing.textContent = selection === "auto"
      ? WARDROBE_STRINGS.autoNow(t(OUTFIT_KEYS[season]))
      : t(OUTFIT_KEYS[selection]);
  };
  const rail = h("div", { class: "outfit-rail", role: "radiogroup", "aria-label": t("Wardrobe") });
  const tokens = new Map<OutfitSelection, HTMLElement>();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const selection of OUTFIT_SELECTIONS) {
    const icon = h("canvas", { style: `width:${TOKEN}px;height:${TOKEN}px` }) as HTMLCanvasElement;
    icon.width = Math.round(TOKEN * dpr);
    icon.height = Math.round(TOKEN * dpr);
    const ctx = icon.getContext("2d");
    if (ctx) {
      ctx.setTransform((dpr * TOKEN) / ICON, 0, 0, (dpr * TOKEN) / ICON, 0, 0);
      drawWardrobeIcon(ctx, ICON, selection, season, WARDROBE_STRINGS.autoBadge);
    }
    const label = t(OUTFIT_KEYS[selection]);
    const token = h("button", {
      class: "outfit-token", role: "radio", title: label, "aria-label": label,
      onclick: () => {
        outfit = selection;
        for (const [id, el] of tokens) {
          el.classList.toggle("on", id === selection);
          el.setAttribute("aria-checked", String(id === selection));
        }
        wear(selection);
        save({ tobiOutfit: selection });
      },
    }, h("span", { class: "disc" }, icon), h("span", { class: "nm", text: label }));
    token.classList.toggle("on", selection === outfit);
    token.setAttribute("aria-checked", String(selection === outfit));
    token.addEventListener("mouseenter", () => wear(selection));
    token.addEventListener("mouseleave", () => wear(outfit));
    tokens.set(selection, token);
    rail.append(token);
  }
  wear(outfit);
  const wardrobe = h("section", { class: "tobi-wardrobe" },
    h("h2", {}, h("span", { text: t("Wardrobe") })),
    h("div", { class: "hint", text: t("Pick what Tobi wears. He tries it on right away.") }),
    rail,
  );

  // ── His colours ──
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
        swatches.append(h("button", {
          class: c === current ? "swatch on" : "swatch",
          style: `background:${c}`,
          title: c, "aria-label": c, "aria-pressed": String(c === current),
          onclick: (e: Event) => {
            e.stopPropagation();
            setEyes({ ...eyes, [g]: c });
            show(g);
          },
        }));
      }
      rows.append(h("div", { class: "eye-row", onclick: () => show(g) },
        h("i", { class: "dot", style: `background:${current}` }),
        h("span", { class: "nm", text: GROUP_TITLE[g]() }),
        swatches,
      ));
    }
  }
  draw();

  const colours = h("section", {},
    h("h2", {}, h("span", { text: t("State colours") })),
    h("div", { class: "hint", text: t("Pick a colour for each state. Click a row to see it.") }),
    presets,
    rows,
  );

  return [hero, wardrobe, colours];
}
