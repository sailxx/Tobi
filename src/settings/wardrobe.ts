// Tobi → Wardrobe: Tobi under a spotlight on the left wearing the outfit, every
// outfit on the right. Resting the pointer on one tries it on; a click keeps it
// (saved as `tobiOutfit`, which the island follows at once). The same choice as
// the island's wardrobe (right-click on Tobi).

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { liveTobi } from "../hub/hero";
import { drawWardrobeIcon } from "../tobi/outfits";
import {
  OUTFIT_KEYS, OUTFIT_SELECTIONS, WARDROBE_STRINGS, parseOutfit, resolveOutfit, seasonalOutfit,
  type OutfitSelection,
} from "../tobi/wardrobe";

/** The size outfits.ts draws a wardrobe icon at, and the size it is shown here. */
const ICON = 28;
const SHOWN = 44;

export function wardrobeSection(name: string, stored: string, choose: (selection: OutfitSelection) => void): HTMLElement {
  let current = parseOutfit(stored);
  const canvas = h("canvas", {}) as HTMLCanvasElement;
  const engine = liveTobi(canvas);
  const wearing = h("span", {});
  const season = seasonalOutfit(new Date());

  const wear = (selection: OutfitSelection) => {
    // The old outfit leaves, the new one drops in with a little squash, as in the island.
    engine.setOutfit(resolveOutfit(selection, new Date()));
    wearing.textContent = selection === "auto"
      ? WARDROBE_STRINGS.autoNow(t(OUTFIT_KEYS[season]))
      : t(OUTFIT_KEYS[selection]);
  };

  const grid = h("div", { class: "wardrobe-cards", role: "radiogroup", "aria-label": t("Wardrobe") });
  const cards = new Map<OutfitSelection, HTMLElement>();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const selection of OUTFIT_SELECTIONS) {
    const icon = h("canvas", { style: `width:${SHOWN}px;height:${SHOWN}px` }) as HTMLCanvasElement;
    icon.width = Math.round(SHOWN * dpr);
    icon.height = Math.round(SHOWN * dpr);
    const ctx = icon.getContext("2d");
    if (ctx) {
      ctx.setTransform((dpr * SHOWN) / ICON, 0, 0, (dpr * SHOWN) / ICON, 0, 0);
      drawWardrobeIcon(ctx, ICON, selection, season, WARDROBE_STRINGS.autoBadge);
    }
    const card = h("button", {
      class: "wardrobe-card", role: "radio", "aria-checked": String(selection === current),
      onclick: () => {
        current = selection;
        for (const [id, el] of cards) {
          el.classList.toggle("on", id === selection);
          el.setAttribute("aria-checked", String(id === selection));
        }
        wear(selection);
        choose(selection);
      },
    }, icon, h("span", { text: t(OUTFIT_KEYS[selection]) }));
    card.classList.toggle("on", selection === current);
    card.addEventListener("mouseenter", () => wear(selection));
    card.addEventListener("mouseleave", () => wear(current));
    cards.set(selection, card);
    grid.append(card);
  }
  wear(current);

  return h("div", { class: "wardrobe-page" },
    h("div", { class: "wardrobe-stage" }, h("div", { class: "spot" }, canvas), h("b", { text: name }), wearing),
    h("div", { class: "wardrobe-pick" }, h("h2", { text: t("Outfit") }), grid),
  );
}
