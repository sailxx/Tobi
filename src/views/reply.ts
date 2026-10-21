// Claude's text, whole: what it has written so far this turn while it works,
// its answer once it is done. Opened from the session card (a click on a step
// or on "Text") and from the finished card. Tobi's own view: the hooks carry
// only one line of it, the relay adds the rest (hook/src/turn.rs).

import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { renderMarkdown, writeClipboard } from "./markdown";
import { State, type AgentTask } from "../core/state";
import { N_, t, tl } from "../i18n/i18n";

const STRINGS = {
  back: N_("Back"),
  writing: N_("Writing…"),
  answer: N_("Answer"),
  copy: N_("Copy"),
  copied: N_("Copied"),
  empty: N_("Nothing written yet."),
};

/** The text to show for a session: its answer once finished, else this turn's text so far. */
export function replyText(task: AgentTask | null): string {
  if (!task) return "";
  return task.finalText || task.turnText || task.finalLine || "";
}

/** True when the session card has something to open. */
export function hasReply(task: AgentTask | null): boolean {
  return replyText(task).trim().length > 0;
}

export interface ReplyHooks {
  back(): void;
}

export function buildReply(hooks: ReplyHooks) {
  const name = h("b");
  const status = h("span", { class: "reply-status" });
  const copy = h("button", { class: "icon-btn", title: tl(STRINGS.copy) }, svg(ICONS.copy, 10));
  const head = h(
    "div",
    { class: "diff-head" },
    h("button", { class: "diff-back", title: tl(STRINGS.back), onclick: () => hooks.back() },
      svg(ICONS.chevronLeft, 9, { stroke: 2.4 }), name),
    status,
    h("span", { class: "grow" }),
    copy,
  );
  const body = h("div", { class: "reply-body" });
  const el = h("div", { class: "view" }, h("div", { class: "card reply-card" }, head, body));

  let shown = "";
  copy.addEventListener("click", async () => {
    if (!shown) return;
    await writeClipboard(shown);
    copy.replaceChildren(svg(ICONS.check, 10, { stroke: 2.2 }));
    copy.title = t(STRINGS.copied);
    window.setTimeout(() => {
      copy.replaceChildren(svg(ICONS.copy, 10));
      copy.title = t(STRINGS.copy);
    }, 1500);
  });

  return {
    el,
    sync() {
      const task = State.focusTask;
      name.textContent = task?.name ?? "Claude";
      const done = !!task?.finalText || task?.state === "finished";
      status.textContent = done ? t(STRINGS.answer) : t(STRINGS.writing);
      status.classList.toggle("live", !done);
      const text = replyText(task);
      if (text === shown) return;
      // Following the end while Claude writes, unless you scrolled up to read.
      const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
      const grew = shown !== "" && text.startsWith(shown.slice(0, 200));
      shown = text;
      if (text.trim()) renderMarkdown(body, text);
      else body.replaceChildren(h("div", { class: "diff-note", text: t(STRINGS.empty) }));
      if (!grew) body.scrollTop = 0;
      else if (atEnd && !done) body.scrollTop = body.scrollHeight;
    },
  };
}
