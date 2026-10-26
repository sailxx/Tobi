// The Gmail card: your unread mail as one row per message (sender, subject, a line of text, the age),
// a click opens the message (its plain text only), with Reply, Archive and Delete, and the pencil
// starts a new message. Enter sends a reply, Shift+Enter starts a new line, Escape goes back. Nothing
// is sent without the user's own Enter or click, and while something is being written the island
// stays open. Built once and synced in place: a field keeps its draft and the keyboard while mail
// arrives. It reuses the chat card's look (style.css .wa-*) with Gmail's colour.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { GMAIL_ID, GMAIL_RED, Mail, linkColor, linkLabel, sendErrorLabel, subjectOf, type MailItem } from "../core/gmail";
import { canSend, initials, keyAction, timeAgo } from "../core/whatsapp";
import { language, t, tl } from "../i18n/i18n";

export interface MailCardHost {
  openSettings(): void;
  /** The island takes the keyboard for the fields, and gives it back. */
  keyboard(on: boolean): void;
  /** Something is being written: the island stays open until it is sent or cleared. */
  holdOpen(on: boolean): void;
}

export interface MailCard {
  el: HTMLElement;
  sync(): void;
}

function avatar(name: string, size = 16): HTMLElement {
  const el = h("span", { class: "wa-avatar", style: `width:${size}px;height:${size}px;font-size:${size * 0.42}px` });
  el.textContent = initials(name);
  return el;
}

export function buildMailCard(host: MailCardHost): MailCard {
  // ── The list ──
  const unreadTag = h("span", { class: "wa-unread" });
  const composeBtn = h("button", { class: "int-back mail-compose", title: tl("New message") }, svg(ICONS.plus, 10, { stroke: 2.4 }));
  const refreshBtn = h("button", { class: "int-back mail-refresh", title: tl("Check now") }, svg(ICONS.arrowClockwise, 10, { stroke: 2 }));
  const head = h("div", { class: "int-head" }, dot(GMAIL_RED, 7), h("b", { text: "Gmail" }), unreadTag, h("span", { class: "wa-spacer" }), refreshBtn, composeBtn);
  const listBody = h("div", {});
  const listView = h("div", { class: "wa-list" }, head, listBody);

  // ── A message ──
  const back = h("button", { class: "int-back wa-back", title: tl("Back") }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 }));
  const mailAvatar = h("span", {});
  const mailFrom = h("b", { class: "wa-name" });
  const archiveBtn = h("button", { class: "link-btn mail-act", text: t("Archive") });
  const trashBtn = h("button", { class: "link-btn mail-act danger", text: t("Delete") });
  const messageHead = h("div", { class: "wa-head" }, back, mailAvatar, mailFrom, h("span", { class: "wa-spacer" }), archiveBtn, trashBtn);
  const subjectLine = h("div", { class: "mail-subject" });
  const bodyText = h("div", { class: "mail-text" });
  const field = h("textarea", { class: "wa-field", rows: "1", spellcheck: "true" }) as HTMLTextAreaElement;
  const sendBtn = h("button", { class: "wa-send", title: tl("Send") }, svg(ICONS.arrowUp, 12, { fill: "#0B0C0E" }));
  const reply = h("div", { class: "wa-reply" }, field, sendBtn);
  const note = h("div", { class: "wa-note" });
  const messageView = h("div", { class: "wa-convo" }, messageHead, subjectLine, bodyText, reply, note);

  // ── A new message ──
  const composeBack = h("button", { class: "int-back wa-back", title: tl("Back") }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 }));
  const composeHead = h("div", { class: "wa-head" }, composeBack, h("b", { class: "wa-name", text: t("New message") }));
  const toField = h("input", { class: "mail-input", type: "email", spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
  const subjectField = h("input", { class: "mail-input", type: "text", spellcheck: "true", autocomplete: "off" }) as HTMLInputElement;
  const composeBody = h("textarea", { class: "wa-field mail-compose-body", rows: "4", spellcheck: "true" }) as HTMLTextAreaElement;
  const composeSend = h("button", { class: "wa-send", title: tl("Send") }, svg(ICONS.arrowUp, 12, { fill: "#0B0C0E" }));
  const composeNote = h("div", { class: "wa-note" });
  const composeView = h("div", { class: "wa-convo" },
    composeHead, toField, subjectField, composeBody, h("div", { class: "wa-reply" }, h("span", { class: "wa-spacer" }), composeSend), composeNote);

  const el = h("div", { class: "int-card wa-card", style: `--chat-accent:${GMAIL_RED}` }, listView, messageView, composeView);

  let openId: string | null = null;
  let composing = false;
  let listKey = "";
  let messageKey = "";

  const draftOn = () => field.value.trim().length > 0 || (composing && (composeBody.value.trim().length > 0 || toField.value.trim().length > 0));

  function open(item: MailItem) {
    openId = item.id;
    field.value = "";
    messageKey = "";
    void Bridge.gmailOpen(item.id);
    host.keyboard(true);
    sync();
  }

  function closeAll() {
    if (openId != null) void Bridge.gmailClose();
    openId = null;
    composing = false;
    field.value = "";
    toField.value = "";
    subjectField.value = "";
    composeBody.value = "";
    host.holdOpen(false);
    host.keyboard(false);
    listKey = "";
    messageKey = "";
    sync();
  }

  function startCompose() {
    composing = true;
    host.keyboard(true);
    sync();
    window.setTimeout(() => toField.focus(), 120);
  }

  async function sendReply() {
    const id = openId;
    const text = field.value;
    if (!id || !canSend(text, Mail.view.sending)) return;
    if (await Bridge.gmailReply(id, text)) {
      field.value = "";
      host.holdOpen(draftOn());
      syncSend();
    }
    field.focus();
  }

  async function sendNew() {
    if (!canSend(composeBody.value, Mail.view.sending)) return;
    if (await Bridge.gmailSend(toField.value, subjectField.value, composeBody.value)) closeAll();
  }

  back.addEventListener("click", closeAll);
  composeBack.addEventListener("click", closeAll);
  composeBtn.addEventListener("click", startCompose);
  refreshBtn.addEventListener("click", () => void Bridge.gmailRefresh());
  sendBtn.addEventListener("click", () => void sendReply());
  composeSend.addEventListener("click", () => void sendNew());
  archiveBtn.addEventListener("click", () => {
    const id = openId;
    if (id) void Bridge.gmailArchive(id).then(() => closeAll());
  });
  trashBtn.addEventListener("click", () => {
    const id = openId;
    if (id) void Bridge.gmailTrash(id).then(() => closeAll());
  });
  for (const input of [field, composeBody, toField, subjectField]) {
    input.addEventListener("input", () => {
      host.holdOpen(draftOn());
      syncSend();
    });
  }
  field.addEventListener("keydown", (e) => {
    const action = keyAction(e);
    if (action === "send") {
      e.preventDefault();
      void sendReply();
    } else if (action === "back") {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
    }
  });
  for (const input of [composeBody, toField, subjectField]) {
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeAll();
      }
    });
  }

  // Leaving the card (another pill, another view, the island folded) closes the message.
  State.subscribe(() => {
    if (openId == null && !composing) return;
    if (State.mode !== "expanded" || State.view !== "overview" || State.focusTask?.id !== GMAIL_ID || !Mail.view.on) closeAll();
  });

  function syncSend() {
    const sending = Mail.view.sending;
    const ok = canSend(field.value, sending);
    sendBtn.classList.toggle("ready", ok);
    sendBtn.disabled = !ok;
    field.disabled = sending;
    const okNew = canSend(composeBody.value, sending) && toField.value.trim().length > 0;
    composeSend.classList.toggle("ready", okNew);
    composeSend.disabled = !okNew;
  }

  function row(item: MailItem): HTMLElement {
    const r = h("button", { class: "int-row wa-row unread mail-row" },
      avatar(item.from),
      h("span", { class: "int-name wa-row-name", text: item.from }),
      h("span", { class: "int-ago", text: timeAgo(item.date) }),
      h("span", { class: "int-sub wa-preview", text: `${subjectOf(item.subject)}${item.snippet ? ` · ${item.snippet}` : ""}` }),
    );
    r.addEventListener("click", () => open(item));
    return r;
  }

  function syncList() {
    const v = Mail.view;
    const key = [
      language(), v.link.state, "detail" in v.link ? v.link.detail : "", v.unread, Math.floor(Date.now() / 60_000),
      ...v.items.map((i) => `${i.id}|${i.date}`),
    ].join("~");
    if (key === listKey) return;
    listKey = key;
    unreadTag.textContent = v.unread > 0 ? t("{0} unread", { 0: v.unread }) : "";
    unreadTag.style.display = v.unread > 0 ? "" : "none";
    composeBtn.style.display = v.link.state === "connected" ? "" : "none";
    refreshBtn.style.display = v.link.state === "connected" ? "" : "none";
    clear(listBody);
    if (v.link.state !== "connected") {
      listBody.append(
        h("div", { class: "int-status" }, dot(linkColor(v.link), 5), h("span", { class: "wa-status-text", text: linkLabel(v.link) })),
        h("div", { class: "int-actions" }, h("button", { class: "link-btn wa-settings", text: t("Settings…"), onclick: () => host.openSettings() })),
      );
    } else if (v.items.length === 0) {
      listBody.append(h("div", { class: "wa-empty", text: t("No unread mail") }));
    } else {
      listBody.append(h("div", { class: "int-rows wa-rows" }, ...v.items.map(row)));
    }
  }

  function syncMessage() {
    const v = Mail.view;
    const m = v.opened && v.opened.id === openId ? v.opened : null;
    const key = [language(), openId, m?.id ?? "", m?.text.length ?? 0].join("~");
    if (key !== messageKey) {
      messageKey = key;
      clear(mailAvatar);
      mailAvatar.append(avatar(m?.from ?? ""));
      mailFrom.textContent = m ? m.from : "…";
      mailFrom.title = m?.fromAddress ?? "";
      subjectLine.textContent = m ? subjectOf(m.subject) : "";
      bodyText.textContent = m ? (m.text || t("(no text)")) : "…";
      bodyText.scrollTop = 0;
    }
    field.placeholder = t("Reply…  (Shift+Enter: new line)");
    note.className = "wa-note";
    if (v.link.state !== "connected") {
      note.textContent = linkLabel(v.link);
      note.classList.add("warn");
    } else if (v.sendError) {
      note.textContent = sendErrorLabel(v.sendError);
      note.classList.add("err");
    } else {
      note.textContent = "";
    }
    archiveBtn.style.display = trashBtn.style.display = m ? "" : "none";
    syncSend();
  }

  function syncCompose() {
    const v = Mail.view;
    toField.placeholder = t("To");
    subjectField.placeholder = t("Subject");
    composeBody.placeholder = t("Write your message…");
    composeNote.className = "wa-note";
    if (v.sendError) {
      composeNote.textContent = sendErrorLabel(v.sendError);
      composeNote.classList.add("err");
    } else {
      composeNote.textContent = "";
    }
    syncSend();
  }

  function sync() {
    const v = Mail.view;
    // Kept open through a missed check (the draft too): only gone when Gmail is off.
    if ((openId != null || composing) && !v.on) {
      closeAll();
      return;
    }
    listView.style.display = openId == null && !composing ? "" : "none";
    messageView.style.display = openId != null && !composing ? "" : "none";
    composeView.style.display = composing ? "" : "none";
    if (composing) syncCompose();
    else if (openId != null) syncMessage();
    else syncList();
  }

  return { el, sync };
}
