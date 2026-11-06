// The island's search: one field for files on this computer, Google and
// YouTube. Files are looked up by name in the home folders as you type
// (file_search.rs); Google and YouTube open in the browser. Arrows move the
// selection, Enter opens it, Ctrl+Enter shows a file in its folder. "g …"
// and "yt …" go straight to Google or YouTube.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type FoundFile } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { ViewActions, ViewHost } from "./views";
import { N_, t, tl } from "../i18n/i18n";

const STRINGS = {
  placeholder: N_("Search files, Google or YouTube"),
  google: N_("Search Google"),
  youtube: N_("Search YouTube"),
  noFiles: N_("No files with that name in your folders"),
  looking: N_("Looking in your folders…"),
  hint: N_("Type to find a file in Desktop, Documents, Downloads and the other home folders."),
  showInFolder: N_("Show in folder"),
};

export type SearchTarget = "google" | "youtube";

/** "g cats" → Google, "yt cats" → YouTube; anything else is for every target. */
export function searchPrefix(query: string): { only: SearchTarget | null; text: string } {
  const m = /^(g|yt)\s+(.+)$/i.exec(query.trim());
  if (!m) return { only: null, text: query.trim() };
  return { only: m[1].toLowerCase() === "g" ? "google" : "youtube", text: m[2].trim() };
}

export function searchUrl(target: SearchTarget, text: string): string {
  const q = encodeURIComponent(text);
  return target === "google" ? `https://www.google.com/search?q=${q}` : `https://www.youtube.com/results?search_query=${q}`;
}

/** A glyph for the kind of file. */
function fileIcon(f: FoundFile): string {
  if (f.isDir) return ICONS.folder;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "svg"].includes(ext)) return ICONS.photo;
  if (["mp4", "mov", "mkv", "avi", "webm"].includes(ext)) return ICONS.film;
  if (["mp3", "wav", "flac", "m4a", "ogg"].includes(ext)) return ICONS.musicNote;
  return ICONS.doc;
}

interface Row {
  el: HTMLElement;
  run(reveal: boolean): void;
}

export function buildSearch(actions: ViewActions): ViewHost {
  const input = h("input", {
    type: "text",
    class: "find-input",
    placeholder: tl(STRINGS.placeholder),
    spellcheck: "false",
  }) as HTMLInputElement;
  const bar = h("label", { class: "find-bar" }, svg(ICONS.search, 15, { stroke: 2 }), input,
    h("span", { class: "find-keys", text: "Enter" }));
  const web = h("div", { class: "find-web" });
  const files = h("div", { class: "find-files" });
  const body = h("div", { class: "find-body" }, bar, web, files);
  const el = h("div", { class: "view" }, h("div", { class: "card find-card" }, body));

  let rows: Row[] = [];
  let selected = 0;
  let found: FoundFile[] = [];
  let looking = false;
  let asked = "";
  let timer = 0;
  let ticket = 0;

  function open(run: () => void) {
    Sound.play("blip");
    run();
    actions.collapse();
  }

  function webRow(target: SearchTarget, text: string): Row {
    const label = t(target === "google" ? STRINGS.google : STRINGS.youtube);
    const row = h("button", { class: `find-row web ${target}` },
      h("span", { class: "find-ico" }, svg(target === "google" ? ICONS.globe : ICONS.play, 14, target === "google" ? { stroke: 1.8 } : {})),
      h("span", { class: "find-name" }, h("b", { text: label }), h("span", { text: ` · ${text}` })),
      svg(ICONS.arrowUpRight, 12));
    const run = () => open(() => void Bridge.openUrl(searchUrl(target, text)));
    row.addEventListener("click", run);
    return { el: row, run };
  }

  function fileRow(f: FoundFile): Row {
    const reveal = h("button", { class: "find-reveal", title: tl(STRINGS.showInFolder) }, svg(ICONS.folder, 13));
    const row = h("div", { class: "find-row file", role: "button" },
      h("span", { class: "find-ico" }, svg(fileIcon(f), 14, { evenOdd: true })),
      h("span", { class: "find-name" }, h("b", { text: f.name }), h("span", { text: f.folder })),
      reveal);
    const run = (show: boolean) => open(() => void Bridge.openFoundFile(f.path, show));
    row.addEventListener("click", () => run(false));
    reveal.addEventListener("click", (e) => {
      e.stopPropagation();
      run(true);
    });
    return { el: row, run };
  }

  function draw() {
    const { only, text } = searchPrefix(input.value);
    clear(web);
    clear(files);
    rows = [];
    if (!text) {
      files.append(h("div", { class: "find-note", text: t(STRINGS.hint) }));
      return;
    }
    const fileRows = only ? [] : found.map(fileRow);
    const webRows = (["google", "youtube"] as const).filter((x) => !only || only === x).map((x) => webRow(x, text));
    for (const r of fileRows) files.append(r.el);
    if (!only && !found.length) {
      files.append(h("div", { class: "find-note", text: t(looking ? STRINGS.looking : STRINGS.noFiles) }));
    }
    for (const r of webRows) web.append(r.el);
    // The web leads when asked for by its prefix, or when no file matched; the arrows follow the screen.
    const webFirst = Boolean(only) || !found.length;
    body.classList.toggle("web-first", webFirst);
    rows = webFirst ? [...webRows, ...fileRows] : [...fileRows, ...webRows];
    selected = Math.min(selected, Math.max(0, rows.length - 1));
    mark();
  }

  function mark() {
    rows.forEach((r, i) => r.el.classList.toggle("sel", i === selected));
    rows[selected]?.el.scrollIntoView({ block: "nearest" });
  }

  function lookUp() {
    const { only, text } = searchPrefix(input.value);
    window.clearTimeout(timer);
    if (only || !text) {
      found = [];
      looking = false;
      asked = "";
      draw();
      return;
    }
    if (text === asked) return;
    looking = true;
    draw();
    timer = window.setTimeout(async () => {
      const mine = ++ticket;
      const result = (await Bridge.searchFiles(text)) ?? [];
      if (mine !== ticket) return;
      asked = text;
      found = result;
      looking = false;
      selected = 0;
      draw();
    }, 160);
  }

  input.addEventListener("input", () => {
    selected = 0;
    lookUp();
  });
  input.addEventListener("keydown", (e) => {
    const k = e as KeyboardEvent;
    if (k.key === "ArrowDown" || k.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length) selected = (selected + (k.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
      mark();
    } else if (k.key === "Enter") {
      e.preventDefault();
      rows[selected]?.run(k.ctrlKey || k.metaKey);
    }
    if (k.key !== "Escape") e.stopPropagation();
  });

  draw();

  return {
    el,
    sync() {
      if (State.view !== "find") window.clearTimeout(timer);
    },
    focus() {
      draw();
      input.focus();
      input.select();
    },
  };
}
