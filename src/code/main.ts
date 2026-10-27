// The code window (code.html): the file an agent is writing, live, and an edit mode. The left side
// is the session as the island shows it; the right is the file: tabs, numbers, highlighting, the
// lines the agent added marked. The text is read from disk by Rust, only inside the session's
// folder, and shown here only. Saving is a deliberate act and never overwrites what the agent
// wrote since the editor was filled: it shows the conflict instead.

import "./code.css";
import { Bridge, onEvent, type CodeFile, type CodeSession } from "../core/bridge";
import {
  baseName, changedLines, codeErrorKey, extensionOf, firstMarked, highlight, languageOf, splitLines, type CodeErrorKey,
} from "../core/code";
import type { Settings } from "../core/state";
import { clear, h } from "../views/dom";
import { writeClipboard } from "../views/markdown";
import { isRtl, N_, onLanguageChange, resolveLanguage, setLanguage, systemLanguages, t, tl } from "../i18n/i18n";

const S = {
  edit: N_("Edit"),
  copy: N_("Copy"),
  copied: N_("Copied"),
  save: N_("Save"),
  revert: N_("Revert"),
  overwrite: N_("Overwrite"),
  reload: N_("Load the agent’s version"),
  saved: N_("Saved"),
  saving: N_("Saving…"),
  unsaved: N_("Unsaved changes"),
  stopEdit: N_("Stop editing"),
  locked: N_("Read only: press Edit to change the text"),
  working: N_("Waiting for the agent"),
  empty: N_("The agent has not changed a file yet"),
  done: N_("Done"),
  conflict: N_("The agent changed this file after you started editing. Nothing was saved."),
  lines: N_("Lines: {n}"),
  added: N_("Added by the agent: {n}"),
};

const ERRORS: Record<CodeErrorKey, string> = {
  outside: N_("This file is outside the session’s folder, so it is not shown."),
  secret: N_("This file may hold secrets, so it is not shown."),
  missing: N_("The file is not on disk."),
  big: N_("The file is too big to show (over 1 MB)."),
  binary: N_("This is not a text file."),
  conflict: S.conflict,
  mixed: N_("This file mixes Windows and Unix line ends, so it can only be read here."),
  readonly: N_("The file is read-only on disk."),
  write: N_("The file could not be saved."),
};

const root = document.getElementById("code")!;

// ── The state ─────────────────────────────────────────────────────────────────

let session: CodeSession | null = null;
/** The file on show (a path of session.files). */
let current = "";
/** What was last read from disk for it: the text and the version a save must match. */
let disk: CodeFile | null = null;
let readError: CodeErrorKey | null = null;
let editing = false;
/** The agent wrote the file while the user had unsaved changes. */
let conflict = false;
/** Lines the agent added, 1-based, and the ones that just changed on disk. */
let marked = new Set<number>();
let flash = new Set<number>();
let note = "";
let noteTimer: number | null = null;
let poll: number | null = null;

// ── The page ──────────────────────────────────────────────────────────────────

const rail = h("aside", { class: "rail" });
const tabs = h("div", { class: "tabs", role: "tablist" });
const pathLabel = h("span", { class: "path" });
const gutter = h("div", { class: "gutter", "aria-hidden": "true" });
const pre = h("pre", { class: "paint", "aria-hidden": "true" });
const area = h("textarea", {
  class: "field",
  spellcheck: false,
  autocapitalize: "off",
  autocomplete: "off",
  wrap: "off",
  readonly: true,
  "aria-label": "code",
}) as HTMLTextAreaElement;
const stack = h("div", { class: "stack" }, pre, area);
const scroller = h("div", { class: "scroll" }, gutter, stack);
const banner = h("div", { class: "banner", hidden: true });
const message = h("div", { class: "message", hidden: true });
const editBtn = h("button", { class: "btn", type: "button", text: tl(S.edit) });
const copyBtn = h("button", { class: "btn", type: "button", text: tl(S.copy) });
const revertBtn = h("button", { class: "btn", type: "button", text: tl(S.revert) });
const saveBtn = h("button", { class: "btn primary", type: "button", text: tl(S.save) });
const status = h("span", { class: "status" });
const foot = h("div", { class: "foot" }, status, h("span", { class: "grow" }), editBtn, revertBtn, copyBtn, saveBtn);
root.append(
  rail,
  h("main", { class: "main" }, h("div", { class: "bar" }, tabs, pathLabel), banner, scroller, message, foot),
);

const dirty = () => editing && !!disk && area.value !== disk.text;

function say(text: string) {
  note = text;
  if (noteTimer != null) window.clearTimeout(noteTimer);
  noteTimer = text ? window.setTimeout(() => ((note = ""), paintStatus()), 1800) : null;
  paintStatus();
}

// ── The rail: the session, as in the island ───────────────────────────────────

function paintRail() {
  clear(rail);
  if (!session) return;
  const eyes = h("span", { class: "eyes" }, h("i"), h("i"));
  const mascot = h("div", { class: "mascot", style: `--tint:${session.color}` }, eyes);
  const finished = session.state === "finished" || session.state === "idle";
  const rows = session.steps.slice(-8);
  const offset = session.steps.length - rows.length;
  const list = h("ol", { class: "steps" });
  rows.forEach((label, k) => {
    const index = offset + k;
    const now = !finished && index === session!.stepIndex;
    const past = finished || index < session!.stepIndex;
    list.append(h("li", { class: now ? "now" : past ? "past" : "next" }, h("span", { class: "mark" }), h("span", { class: "lbl", text: label })));
  });
  if (finished && rows.length) {
    list.append(h("li", { class: "past done" }, h("span", { class: "mark" }), h("span", { class: "lbl", text: tl(S.done) })));
  }
  rail.append(mascot, h("div", { class: "who" }, h("b", { text: session.name }), h("span", { text: session.agent })), list);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function relativeTo(rootPath: string, path: string): string {
  const norm = (s: string) => s.replace(/\\/g, "/");
  const r = norm(rootPath).replace(/\/+$/, "");
  const p = norm(path);
  return r && p.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? p.slice(r.length + 1) : p;
}

function paintTabs() {
  clear(tabs);
  for (const file of session?.files ?? []) {
    const on = file.path === current;
    tabs.append(
      h(
        "button",
        {
          class: `tab${on ? " on" : ""}`,
          type: "button",
          role: "tab",
          "aria-selected": on,
          title: file.path,
          onclick: () => void choose(file.path),
        },
        h("span", { class: "ext", text: extensionOf(file.path) || "·" }),
        h("span", { class: "name", text: baseName(file.path) }),
      ),
    );
  }
  pathLabel.textContent = session && current ? relativeTo(session.root, current) : "";
  pathLabel.title = current;
}

// ── The text ──────────────────────────────────────────────────────────────────

const lineHeight = () => (pre.firstElementChild as HTMLElement | null)?.offsetHeight || 20;

/** Draws `text` (numbers, colours, marked lines) under the text box, and sizes the box to it. */
function paintText(text: string) {
  const lines = highlight(text, languageOf(current));
  const count = Math.max(1, splitLines(text).length);
  const frag = document.createDocumentFragment();
  const nums = document.createDocumentFragment();
  for (let n = 1; n <= count; n++) {
    const row = h("div", { class: `ln${marked.has(n) ? " add" : ""}${flash.has(n) ? " fresh" : ""}` });
    for (const [cls, body] of lines[n - 1] ?? []) {
      row.append(cls ? h("span", { class: `t-${cls}`, text: body }) : document.createTextNode(body));
    }
    if (!row.firstChild) row.append(document.createTextNode("​"));
    frag.append(row);
    nums.append(h("div", { class: `num${marked.has(n) ? " add" : ""}`, text: String(n) }));
  }
  // The text box needs one more line to put the caret on after a final newline.
  frag.append(h("div", { class: "ln" }, document.createTextNode("​")));
  clear(pre);
  pre.append(frag);
  clear(gutter);
  gutter.append(nums);
  gutter.style.minWidth = `${String(count).length + 3}ch`;
  // The box is as large as the text, so the page's one scroller moves both.
  area.style.height = `${pre.offsetHeight}px`;
  area.style.width = `${Math.max(pre.scrollWidth, stack.clientWidth)}px`;
}

function showText(text: string, keepScroll: boolean) {
  const top = scroller.scrollTop;
  const left = scroller.scrollLeft;
  if (area.value !== text) area.value = text;
  paintText(text);
  if (keepScroll) {
    scroller.scrollTop = top;
    scroller.scrollLeft = left;
  }
}

function paintStatus() {
  let text = note;
  if (!text && session && !readError) {
    const n = splitLines(editing ? area.value : (disk?.text ?? "")).length;
    if (conflict) text = "";
    else if (dirty()) text = t(S.unsaved);
    else if (disk) text = marked.size ? `${t(S.lines, { n })} · ${t(S.added, { n: marked.size })}` : t(S.lines, { n });
  }
  status.textContent = text;
  status.classList.toggle("warn", conflict && !note);
}

function paintControls() {
  const ok = !!disk && !readError;
  const d = dirty();
  editBtn.textContent = editing ? t(S.stopEdit) : t(S.edit);
  editBtn.hidden = !ok || (!editing && !disk?.editable);
  editBtn.title = editing ? "" : t(S.locked);
  editBtn.classList.toggle("on", editing);
  copyBtn.hidden = !ok;
  saveBtn.hidden = !ok || !editing;
  saveBtn.disabled = !d;
  saveBtn.textContent = conflict ? t(S.overwrite) : t(S.save);
  revertBtn.hidden = !ok || !editing || !d;
  area.readOnly = !editing;
  area.classList.toggle("editing", editing);
  banner.hidden = !conflict;
  clear(banner);
  if (conflict) {
    banner.append(
      h("span", { text: t(S.conflict) }),
      h("button", { class: "btn", type: "button", text: t(S.reload), onclick: () => void reload(true) }),
    );
  }
  message.hidden = !(session && (readError || !current));
  if (!message.hidden) {
    message.textContent = readError ? t(ERRORS[readError]) : t(session?.files.length ? S.working : S.empty);
  }
  scroller.hidden = !message.hidden;
}

function repaint(keepScroll = true) {
  paintRail();
  paintTabs();
  paintControls();
  if (readError || !disk) {
    clear(pre);
    clear(gutter);
  } else {
    showText(editing ? area.value : disk.text, keepScroll);
  }
  paintStatus();
}

// ── Reading and following ─────────────────────────────────────────────────────

const runsOf = (path: string): string[][] => session?.files.find((f) => f.path === path)?.runs ?? [];

/** Reads the file again. `discard` also drops what the user typed (after a conflict, or Revert). */
async function reload(discard: boolean) {
  if (!session || !current) return;
  const path = current;
  try {
    const file = await Bridge.codeRead(session.root, path);
    if (path !== current) return;
    const before = disk?.text ?? null;
    disk = file;
    readError = null;
    if (discard || !dirty()) {
      area.value = file.text;
      conflict = false;
    }
    marked = changedLines(file.text, runsOf(path));
    flash = new Set();
    if (before != null && before !== file.text) {
      // The lines that differ from what was on show a moment ago, to catch the eye.
      const was = splitLines(before);
      splitLines(file.text).forEach((line, i) => line !== was[i] && flash.add(i + 1));
      if (flash.size > 60) flash = new Set();
    }
    repaint(before != null);
    if (flash.size) {
      window.setTimeout(() => {
        flash = new Set();
        if (disk && !dirty() && current === path) showText(editing ? area.value : disk.text, true);
      }, 1400);
    }
  } catch (err) {
    if (path !== current) return;
    readError = codeErrorKey(err);
    disk = null;
    editing = false;
    repaint(false);
  }
}

async function choose(path: string) {
  if (path === current) return;
  if (dirty() && !window.confirm(t(S.unsaved))) return;
  current = path;
  disk = null;
  readError = null;
  editing = false;
  conflict = false;
  marked = new Set();
  await reload(true);
  const first = firstMarked(marked);
  if (first) scroller.scrollTop = Math.max(0, (first - 4) * lineHeight());
}

function keepVisible(line: number) {
  const y = (line - 1) * lineHeight();
  if (y < scroller.scrollTop || y > scroller.scrollTop + scroller.clientHeight - lineHeight() * 3) {
    scroller.scrollTop = Math.max(0, y - lineHeight() * 4);
  }
}

/** While the window is open: has the file changed on disk? */
async function tick() {
  poll = null;
  if (session && current && disk && !readError && !document.hidden) {
    try {
      const version = await Bridge.codeVersion(session.root, current);
      if (disk && version !== disk.version) {
        if (dirty()) {
          conflict = true;
          paintControls();
          paintStatus();
        } else {
          await reload(false);
          // Follow the agent: bring its newest lines into view.
          const first = firstMarked(marked);
          if (first && !editing) keepVisible(first);
        }
      }
    } catch (err) {
      readError = codeErrorKey(err);
      disk = null;
      editing = false;
      repaint(false);
    }
  }
  schedule();
}

function schedule() {
  if (poll == null && session) poll = window.setTimeout(() => void tick(), 900);
}

/** The island's snapshot: the first one opens a file, later ones add steps and tabs. */
async function apply(next: CodeSession | null) {
  if (!next) {
    session = null;
    current = "";
    disk = null;
    readError = null;
    editing = false;
    conflict = false;
    area.value = "";
    repaint(false);
    return;
  }
  if (!session || session.pillId !== next.pillId) {
    current = "";
    disk = null;
    editing = false;
    conflict = false;
  }
  session = next;
  if (next.active && next.active !== current && next.files.some((f) => f.path === next.active)) {
    await choose(next.active);
  } else if (!current && next.files.length) {
    await choose(next.files[next.files.length - 1].path);
  } else {
    if (disk) marked = changedLines(disk.text, runsOf(current));
    repaint(true);
  }
  schedule();
}

// ── Editing ───────────────────────────────────────────────────────────────────

editBtn.addEventListener("click", () => {
  if (!disk) return;
  if (editing && dirty() && !window.confirm(t(S.unsaved))) return;
  editing = !editing;
  conflict = false;
  if (!editing) area.value = disk.text;
  repaint(true);
  if (editing) area.focus();
});

revertBtn.addEventListener("click", () => {
  if (!disk) return;
  area.value = disk.text;
  conflict = false;
  repaint(true);
});

copyBtn.addEventListener("click", async () => {
  await writeClipboard(editing ? area.value : (disk?.text ?? ""));
  say(t(S.copied));
});

async function save() {
  if (!session || !disk || !dirty()) return;
  const overwrite = conflict;
  say(t(S.saving));
  try {
    const text = area.value;
    const version = await Bridge.codeWrite(session.root, current, text, disk.version, overwrite);
    disk = { ...disk, text, version };
    conflict = false;
    marked = changedLines(text, runsOf(current));
    repaint(true);
    say(t(S.saved));
  } catch (err) {
    const key = codeErrorKey(err);
    if (key === "conflict") {
      conflict = true;
      paintControls();
      say("");
    } else {
      say(t(ERRORS[key]));
    }
  }
}
saveBtn.addEventListener("click", () => void save());

/** The text box is as big as the text, so the scroller has to follow the caret by hand. */
function keepCaretVisible() {
  const row = area.value.slice(0, area.selectionStart).split("\n").length - 1;
  const lh = lineHeight();
  const top = row * lh;
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (top + lh * 2 > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + lh * 2 - scroller.clientHeight;
}

area.addEventListener("input", () => {
  paintText(area.value);
  paintControls();
  paintStatus();
  keepCaretVisible();
});
area.addEventListener("click", keepCaretVisible);
area.addEventListener("keyup", (e) => {
  if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" || e.key.startsWith("Page")) keepCaretVisible();
});

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void save();
  } else if (e.key === "Escape") {
    if (editing && document.activeElement === area) area.blur();
    else void Bridge.closeCodeWindow();
  } else if (e.key === "Tab" && document.activeElement === area && editing && !e.shiftKey) {
    // A tab in a code editor indents; Escape, then Tab, leaves the box.
    e.preventDefault();
    document.execCommand("insertText", false, "  ");
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void tick();
});

async function main() {
  const boot = await Bridge.boot();
  const lang = (s: Partial<Settings> | undefined) => setLanguage(resolveLanguage(s?.language ?? "", systemLanguages()));
  lang(boot?.settings);
  const dir = () => (document.documentElement.dir = isRtl() ? "rtl" : "ltr");
  dir();
  onLanguageChange(() => {
    dir();
    repaint(true);
  });
  void onEvent<Settings>("settings-changed", lang);
  void onEvent<CodeSession | null>("code-session", (s) => void apply(s));
  document.title = "Tobi";
  await apply(await Bridge.codeWindowSession());
}

void main();
