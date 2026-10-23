// Dictation: the key, today's dictations with search and copy, and the way to
// the Notetaker. Until dictation is set up, the steps to get there.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { onEvent } from "../../core/bridge";
import { FlowBridge, type FlowEntry } from "../../core/flow";
import type { HubContext } from "../shell";
import { emptyState, glowCard } from "../hero";
import { button, iconButton, keyLabel, number, row, toggle } from "../ui";
import { modelsControl } from "./flowsettings";

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dayTitle(ms: number): string {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (dayKey(ms) === dayKey(today.getTime())) return t("Today");
  if (dayKey(ms) === dayKey(yesterday.getTime())) return t("Yesterday");
  return new Date(ms).toLocaleDateString(document.documentElement.lang || undefined, { weekday: "long", day: "numeric", month: "long" });
}

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString(document.documentElement.lang || undefined, { hour: "2-digit", minute: "2-digit" });
}

export async function dictationPage(page: HTMLElement, ctx: HubContext) {
  const status = ctx.status;
  const key = keyLabel(status.keys === "wayland" ? "wayland" : status.prefs.key, status.platform);
  const ready = status.prefs.enabled && status.models.parakeet.state === "ready";

  const alertLine = h("div", { class: "hub-note" });
  const record = button(t("Record a call"), () => {
    void FlowBridge.startNote().then(() => ctx.navigate("notes"), (err) => alertLine.replaceChildren(String(err)));
  });
  const hello = status.userName ? t("Hello {0}", { 0: status.userName }) : t("Hello");
  page.append(ctx.hero("dictation", hello, t("Hold {0} anywhere, speak, let go: it's pasted.", { 0: key }), [record]));
  page.append(alertLine);

  if (!ready) page.append(setup(ctx));

  const history = await FlowBridge.history();
  let entries: FlowEntry[] = history ?? [];
  let query = "";

  const list = h("div", { class: "hub-list" });
  const search = h("input", { class: "hub-input", placeholder: t("Search dictations"), type: "search" }) as HTMLInputElement;
  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    draw();
  });

  function draw() {
    clear(list);
    if (status.prefs.keepDays === 0) {
      list.append(emptyState(t("The history is off. Turn it on in Settings → Privacy.")));
      return;
    }
    const shown = query ? entries.filter((e) => e.text.toLowerCase().includes(query)) : entries;
    if (shown.length === 0) {
      list.append(emptyState(query ? t("No dictation matches.") : t("Your dictations will show here. Hold {0} in any app and speak.", { 0: key })));
      return;
    }
    let group: HTMLElement | null = null;
    let groupDay = "";
    for (const e of shown.slice(0, 300)) {
      const d = dayKey(e.date);
      if (d !== groupDay) {
        groupDay = d;
        list.append(h("div", { class: "hub-day", text: dayTitle(e.date) }));
        group = h("div", { class: "hub-entries" });
        list.append(group);
      }
      const when = h("div", { class: "when" }, h("span", { text: time(e.date) }));
      if (e.app) when.append(h("span", { class: "hub-tag", text: e.app, title: e.app }));
      const tools = h("div", { class: "tools" },
        iconButton("copy", t("Copy"), () => void FlowBridge.copy(e.text)),
        iconButton("trash", t("Delete"), () => {
          entries = entries.filter((x) => x.id !== e.id);
          void FlowBridge.deleteEntry(e.id);
          draw();
        }),
      );
      group!.append(h("div", { class: "hub-entry" }, when, h("div", { class: "words", text: e.text }), tools));
    }
  }

  page.append(search, list);
  draw();

  const unlisten = await onEvent<FlowEntry | null>("flow-history", (entry) => {
    if (!entry) return;
    entries = [entry, ...entries.filter((x) => x.id !== entry.id)];
    draw();
  });
  ctx.onLeave = () => unlisten();
}

/** Until dictation works: turn it on, download the model. */
function setup(ctx: HubContext): HTMLElement {
  const status = ctx.status;
  const key = keyLabel(status.keys === "wayland" ? "wayland" : status.prefs.key, status.platform);
  const body = h("div", { style: "display:flex;flex-direction:column;gap:14px" });
  body.append(
    h("div", { style: "font:700 16px var(--font)", text: t("Dictate anywhere on your computer") }),
    h("div", { class: "hub-note", text: t("Hold {0} in any app, speak, let go: your words are pasted where you type.", { 0: key }) }),
  );
  body.append(row(t("Turn on dictation"), null, toggle(status.prefs.enabled, (on) => {
    void ctx.setPrefs((p) => (p.enabled = on)).then(() => ctx.navigate("dictation"));
  })));
  body.append(row(t("Parakeet, on your computer"), t("The most accurate, offline, 25 languages. Downloaded once (about {0} MB).", { 0: number(status.models.downloadMb) }), modelsControl(ctx, () => ctx.navigate("dictation"))));
  return glowCard("", body);
}
