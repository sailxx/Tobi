// Home: a hello, what the agents got done (all, today, days in a row), the
// finished tasks day by day with a search, and the ways to the pages people
// open most. The tasks are the weekly recap's turns: with the recap off, Tobi
// keeps none and the page says so.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { Bridge } from "../../core/bridge";
import { agentName, homeStats } from "../../recap/summary";
import type { HubContext, PageId } from "../shell";
import { emptyState } from "../hero";
import { icon, number } from "../ui";

/** The recap keeps 12 weeks. */
const HISTORY_DAYS = 84;

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function greeting(name: string | null | undefined, hour = new Date().getHours()): string {
  const part = hour < 5 || hour >= 18 ? "evening" : hour < 12 ? "morning" : "afternoon";
  if (name) {
    if (part === "morning") return t("Good morning, {0}", { 0: name });
    if (part === "afternoon") return t("Good afternoon, {0}", { 0: name });
    return t("Good evening, {0}", { 0: name });
  }
  if (part === "morning") return t("Good morning");
  if (part === "afternoon") return t("Good afternoon");
  return t("Good evening");
}

function dayTitle(ms: number): string {
  if (dayKey(ms) === dayKey(Date.now())) return t("Today");
  if (dayKey(ms) === dayKey(Date.now() - 86_400_000)) return t("Yesterday");
  return new Date(ms).toLocaleDateString(document.documentElement.lang || undefined, { weekday: "long", day: "numeric", month: "long" });
}

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString(document.documentElement.lang || undefined, { hour: "2-digit", minute: "2-digit" });
}

function duration(seconds: number): string {
  return seconds < 60 ? `${Math.max(1, Math.round(seconds))} s` : t("{0} min", { 0: number(Math.round(seconds / 60)) });
}

function stat(iconName: string, tone: string, value: HTMLElement, label: string): HTMLElement {
  return h("div", { class: `hub-stat ${tone}` }, h("span", { class: "tile" }, icon(iconName)), h("div", {}, value, h("span", { text: label })));
}

function skeleton(lines: number): HTMLElement {
  const el = h("div", { class: "hub-activity" });
  for (let i = 0; i < lines; i++) el.append(h("div", { class: "hub-skel" }, h("i", {}), h("b", {})));
  return el;
}

export async function homePage(page: HTMLElement, ctx: HubContext) {
  const head = ctx.hero("home", "", t("Tobi watches your agents and tells you when they finish or have a question."));
  // The page's title is the hello, not the sidebar's "Home".
  const h1 = h("h1", { text: greeting(ctx.status.userName) });
  head.querySelector("h1")?.replaceWith(h1);

  const values = [h("b", { text: "–" }), h("b", { text: "–" }), h("b", { text: "–" })];
  const stats = h("div", { class: "hub-stats" },
    stat("done", "green", values[0], t("tasks done")),
    stat("calendar", "blue", values[1], t("today")),
    stat("flame", "amber", values[2], t("days in a row")),
  );

  const search = h("input", { class: "hub-input", type: "search", placeholder: t("Search your activity") }) as HTMLInputElement;
  const list = h("div", { class: "hub-activity-wrap" }, skeleton(3));

  const link = (id: PageId, iconName: string, tone: string, title: string) =>
    h("button", { class: "hub-link-row", onclick: () => ctx.navigate(id) },
      h("span", { class: `tile ${tone}` }, icon(iconName)),
      h("span", { class: "name", text: title }),
      icon("chevron"),
    );
  const side = h("aside", { class: "hub-home-side" },
    h("div", { class: "hub-links" },
      link("agents", "terminal", "amber", t("Agents")),
      link("phone", "phone", "green", t("Android phone")),
      link("general", "sliders", "blue", t("General")),
    ),
    h("div", { class: "hub-tip" },
      h("div", { class: "title" }, icon("bulb"), h("span", { text: t("Wardrobe") })),
      h("p", { text: t("Right-click Tobi in the island to dress him up.") }),
    ),
  );

  page.append(head, stats, h("div", { class: "hub-home" },
    h("div", { class: "hub-home-main" }, h("div", { class: "hub-home-bar" }, h("h2", { text: t("Activity") }), search), list),
    side,
  ));

  const history = await Bridge.recapHistory(Date.now() / 1000 - HISTORY_DAYS * 86_400);
  const turns = (history?.turns ?? []).slice().sort((a, b) => b.end - a.end);
  const s = homeStats(turns);
  values[0].textContent = number(s.done);
  values[1].textContent = number(s.today);
  values[2].textContent = number(s.streak);

  const draw = () => {
    clear(list);
    if (history && !history.prefs.enabled) {
      list.append(emptyState(t("Weekly recap is off, so Tobi keeps no tasks. Turn it on in General.")));
      return;
    }
    const q = search.value.trim().toLowerCase();
    const shown = turns.filter((x) => !q || x.project.toLowerCase().includes(q) || agentName(x.agent).toLowerCase().includes(q));
    if (!shown.length) {
      list.append(emptyState(q ? t("Nothing found.") : t("No tasks yet. Tobi lists them here when an agent finishes.")));
      return;
    }
    let day = "";
    let group: HTMLElement | null = null;
    for (const x of shown.slice(0, 60)) {
      const ms = x.end * 1000;
      if (dayKey(ms) !== day) {
        day = dayKey(ms);
        group = h("div", { class: "hub-activity" }, h("div", { class: "day", text: dayTitle(ms) }));
        list.append(group);
      }
      group!.append(h("div", { class: "item" },
        h("div", { class: "text" },
          h("div", { class: "title", text: x.project || agentName(x.agent) }),
          h("div", { class: "meta", text: `${time(ms)} · ${agentName(x.agent)} · ${duration(x.end - x.start)}` }),
        ),
        h("span", { class: "state", text: t("Done") }),
      ));
    }
  };
  search.addEventListener("input", draw);
  draw();
}
