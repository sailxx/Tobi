// The chat card of a messenger pill (WhatsApp, Telegram) — a DOM port of the Mac's WhatsAppCardView,
// WhatsAppRow, WhatsAppConversationView, WhatsAppBubble and WhatsAppAvatar (WhatsAppViews.swift).
// Sizes, colours and wording are the Mac's; what differs per messenger is in `ChatCardConfig`.
//
// The list: one row per conversation (never one per message) with initials, name, age, the last
// message cut short and the unread count; when the account isn't linked, why, and a way to Settings.
// A click on a row opens the conversation: its last ten messages and a reply field. Enter sends,
// Shift+Enter starts a new line, Escape goes back to the list. Nothing is sent without the user's
// own Enter or click, and while a reply is being typed the island stays open.
//
// A click on a message opens it whole: the full text, the photo (fetched then, never before) and
// two buttons, Copy text and Copy photo. Back, or Escape, returns to the conversation.
//
// Built once and synced in place: the field keeps its draft and the keyboard while messages arrive.

import { h, svg, clear, dot } from "./dom";
import { writeClipboard } from "./markdown";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { canSend, copyableText, hasPhoto, initials, keyAction, lastMessages, preview, previewParts, timeAgo, type WaConversation, type WaMessage } from "../core/whatsapp";
import { language, t, tl } from "../i18n/i18n";

/** What the card reads of a messenger's report (core/whatsapp.ts WaIslandView, core/telegram.ts TgIslandView). */
export interface ChatView {
  on: boolean;
  link: { state: string; detail?: string };
  conversations: WaConversation[];
  unread: number;
  sending: boolean;
  sendError: unknown;
}

export interface ChatCardConfig {
  id: string;
  title: string;
  color: string;
  view(): ChatView;
  linkLabel(link: ChatView["link"]): string;
  linkColor(link: ChatView["link"]): string;
  sendErrorLabel(e: never): string;
  bridge: {
    open(chat: string): Promise<unknown>;
    close(chat: string): Promise<unknown>;
    send(chat: string, text: string): Promise<boolean | null>;
    ignore(chat: string): Promise<unknown>;
    /** The message's photo as a data: URL; only where the messenger can give it (Telegram). */
    media?(chat: string, id: string): Promise<string | null>;
  };
}

export interface ChatCardHost {
  openSettings(): void;
  /** The island takes the keyboard for the reply field, and gives it back. */
  keyboard(on: boolean): void;
  /** A reply is being typed: the island stays open until it is sent or cleared. */
  holdOpen(on: boolean): void;
}

export interface ChatCard {
  el: HTMLElement;
  sync(): void;
}

/** Initials on the messenger's colour: no photo is ever fetched (they live on its servers). */
function avatar(color: string, name: string, isGroup: boolean, size = 16): HTMLElement {
  const letters = initials(name);
  const el = h("span", { class: "wa-avatar", style: `width:${size}px;height:${size}px;font-size:${size * 0.42}px` });
  if (isGroup && letters === "#") el.append(svg(ICONS.stack, size * 0.6, { fill: color }));
  else el.textContent = letters;
  return el;
}

/** A picture from a data: URL as PNG bytes: the clipboard takes PNG whatever the photo was. */
function pngBlob(url: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      canvas.toBlob((b) => resolve(b), "image/png");
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function copyPhoto(url: string): Promise<boolean> {
  const Item = (window as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!Item || !navigator.clipboard?.write) return false;
  try {
    const blob = await pngBlob(url);
    if (!blob) return false;
    await navigator.clipboard.write([new Item({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function bubble(m: WaMessage, isGroup: boolean, onOpen: (m: WaMessage) => void): HTMLElement {
  const { label, value } = previewParts(m);
  const box = h("div", { class: m.fromMe ? "wa-bubble mine" : "wa-bubble", title: tl("Open the message") });
  // A selection made by dragging is for copying, not for opening.
  box.addEventListener("click", () => {
    if (!window.getSelection?.()?.toString()) onOpen(m);
  });
  if (isGroup && !m.fromMe && m.senderName) box.append(h("div", { class: "wa-sender", text: m.senderName }));
  if (label) box.append(h("div", { class: "wa-media", text: t(label) }));
  if (value) box.append(h("div", { class: "wa-text", text: value }));
  return h("div", { class: m.fromMe ? "wa-line mine" : "wa-line" }, box);
}

export function buildChatCard(cfg: ChatCardConfig, host: ChatCardHost): ChatCard {
  // ── The list ──
  const unreadTag = h("span", { class: "wa-unread" });
  const head = h("div", { class: "int-head" }, dot(cfg.color, 7), h("b", { text: cfg.title }), unreadTag);
  const listBody = h("div", {});
  const listView = h("div", { class: "wa-list" }, head, listBody);

  // ── The conversation ──
  const back = h("button", { class: "int-back wa-back", title: tl("Back") }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 }));
  const convoAvatar = h("span", {});
  const convoName = h("b", { class: "wa-name" });
  const convoHead = h("div", { class: "wa-head" }, back, convoAvatar, convoName);
  const messages = h("div", { class: "wa-messages" });
  const field = h("textarea", { class: "wa-field", rows: "1", spellcheck: "true" }) as HTMLTextAreaElement;
  const sendBtn = h("button", { class: "wa-send", title: tl("Send") }, svg(ICONS.arrowUp, 12, { fill: "#0B0C0E" }));
  const reply = h("div", { class: "wa-reply" }, field, sendBtn);
  const note = h("div", { class: "wa-note" });
  const convoView = h("div", { class: "wa-convo" }, convoHead, messages, reply, note);

  // ── One message, whole ──
  const detailBack = h("button", { class: "int-back wa-back", title: tl("Back") }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 }));
  const detailWho = h("b", { class: "wa-name" });
  const detailWhen = h("span", { class: "int-ago" });
  const detailHead = h("div", { class: "wa-head" }, detailBack, detailWho, detailWhen);
  const detailBody = h("div", { class: "wa-detail-body" });
  const copyTextBtn = h("button", { class: "link-btn", text: tl("Copy text") });
  const copyPhotoBtn = h("button", { class: "link-btn", text: tl("Copy photo") });
  const detailNote = h("span", { class: "wa-detail-note" });
  const detailActions = h("div", { class: "wa-detail-actions" }, copyTextBtn, copyPhotoBtn, detailNote);
  const detailView = h("div", { class: "wa-convo wa-detail" }, detailHead, detailBody, detailActions);

  const el = h("div", { class: "int-card wa-card", style: `--chat-accent:${cfg.color}` }, listView, convoView, detailView);

  let openChat: string | null = null;
  /** The row whose "Ignore this chat" is showing (a right-click on it). */
  let ignoring: string | null = null;
  let listKey = "";
  let convoKey = "";
  /** The message open whole, with its photo once fetched (null until then or when there is none). */
  let detail: { message: WaMessage; photo: string | null } | null = null;

  const current = (): WaConversation | undefined =>
    openChat ? cfg.view().conversations.find((c) => c.id === openChat) : undefined;

  function open(id: string) {
    openChat = id;
    ignoring = null;
    field.value = "";
    convoKey = "";
    void cfg.bridge.open(id);
    host.keyboard(true);
    window.setTimeout(() => field.focus(), 120);
    sync();
  }

  function openDetail(m: WaMessage, isGroup: boolean) {
    const chat = openChat;
    if (!chat) return;
    detail = { message: m, photo: null };
    detailWho.textContent = m.fromMe ? t("You") : isGroup && m.senderName ? m.senderName : current()?.name ?? "";
    detailWhen.textContent = new Date(m.date).toLocaleString(language(), { dateStyle: "medium", timeStyle: "short" });
    setDetailNote("");
    clear(detailBody);
    const text = copyableText(m);
    if (hasPhoto(m) && cfg.bridge.media) {
      const slot = h("div", { class: "wa-photo wa-skeleton" });
      detailBody.append(slot);
      void cfg.bridge.media(chat, m.id).then((url) => {
        // Gone back, or onto another message, while it loaded.
        if (!detail || detail.message.id !== m.id) return;
        if (!url) {
          slot.className = "wa-photo failed";
          slot.textContent = t("The photo can’t be loaded");
          return;
        }
        detail.photo = url;
        slot.className = "wa-photo";
        slot.replaceChildren(h("img", { class: "wa-photo-img", src: url, alt: "" }));
        syncDetailButtons();
      });
    } else {
      const { label } = previewParts(m);
      if (label) detailBody.append(h("div", { class: "wa-media", text: t(label) }));
    }
    if (text) detailBody.append(h("div", { class: "wa-detail-text", text }));
    syncDetailButtons();
    // Held open while reading: the island doesn't fold under the pointer.
    host.holdOpen(true);
    window.addEventListener("keydown", detailKey, true);
    sync();
  }

  function closeDetail() {
    if (!detail) return;
    detail = null;
    window.removeEventListener("keydown", detailKey, true);
    host.holdOpen(field.value.trim().length > 0);
    sync();
  }

  function detailKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    closeDetail();
  }

  function syncDetailButtons() {
    if (!detail) return;
    copyTextBtn.style.display = copyableText(detail.message) ? "" : "none";
    copyPhotoBtn.style.display = detail.photo ? "" : "none";
  }

  let noteTimer: number | null = null;
  function setDetailNote(text: string) {
    detailNote.textContent = text;
    if (noteTimer != null) window.clearTimeout(noteTimer);
    noteTimer = text ? window.setTimeout(() => (detailNote.textContent = ""), 1800) : null;
  }

  detailBack.addEventListener("click", closeDetail);
  copyTextBtn.addEventListener("click", async () => {
    if (!detail) return;
    await writeClipboard(copyableText(detail.message));
    setDetailNote(t("Copied"));
  });
  copyPhotoBtn.addEventListener("click", async () => {
    if (!detail?.photo) return;
    setDetailNote((await copyPhoto(detail.photo)) ? t("Copied") : t("Couldn’t copy the photo"));
  });

  function close() {
    if (openChat == null) return;
    detail = null;
    window.removeEventListener("keydown", detailKey, true);
    void cfg.bridge.close(openChat);
    openChat = null;
    field.value = "";
    host.holdOpen(false);
    host.keyboard(false);
    listKey = "";
    sync();
  }

  async function send() {
    const chat = openChat;
    const text = field.value;
    if (!chat || !canSend(text, cfg.view().sending)) return;
    const sent = await cfg.bridge.send(chat, text);
    if (sent && openChat === chat && field.value === text) {
      field.value = "";
      host.holdOpen(false);
      syncSendButton();
    }
    field.focus();
  }

  back.addEventListener("click", close);
  sendBtn.addEventListener("click", () => void send());
  field.addEventListener("input", () => {
    host.holdOpen(field.value.trim().length > 0);
    syncSendButton();
  });
  field.addEventListener("keydown", (e) => {
    const action = keyAction(e);
    if (action === "send") {
      e.preventDefault();
      void send();
    } else if (action === "back") {
      // Back to the list, not the island folding away.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  // Leaving the card (another pill, another view, the island folded) closes the conversation.
  State.subscribe(() => {
    if (openChat == null) return;
    if (State.mode !== "expanded" || State.view !== "overview" || State.focusTask?.id !== cfg.id || !cfg.view().on) {
      close();
    }
  });

  function syncSendButton() {
    const ok = canSend(field.value, cfg.view().sending);
    sendBtn.classList.toggle("ready", ok);
    sendBtn.disabled = !ok;
    field.disabled = cfg.view().sending;
  }

  function row(c: WaConversation): HTMLElement {
    const unread = c.unread > 0;
    const r = h("button", { class: unread ? "int-row wa-row unread" : "int-row wa-row" },
      avatar(cfg.color, c.name, c.isGroup),
      h("span", { class: "int-name wa-row-name", text: c.name }),
      h("span", { class: "int-ago", text: timeAgo(c.lastActivity) }),
    );
    const last = c.messages[c.messages.length - 1];
    if (ignoring === c.id) {
      r.append(h("span", { class: "wa-spacer" }), h("span", {
        class: "link-btn wa-ignore",
        text: t("Ignore this chat"),
        onclick: (e: Event) => {
          e.stopPropagation();
          ignoring = null;
          void cfg.bridge.ignore(c.id);
        },
      }));
    } else {
      if (last) r.append(h("span", { class: "int-sub wa-preview", text: preview(last, c.isGroup) }));
      r.append(h("span", { class: "wa-spacer" }));
      if (unread) r.append(h("span", { class: "wa-count", text: c.unread > 99 ? "99+" : String(c.unread) }));
    }
    r.addEventListener("click", () => open(c.id));
    r.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      ignoring = ignoring === c.id ? null : c.id;
      listKey = "";
      sync();
    });
    return r;
  }

  function syncList() {
    const v = cfg.view();
    const key = [
      language(), v.link.state, "detail" in v.link ? v.link.detail : "", v.unread, ignoring,
      // The ages move on a minute at a time.
      Math.floor(Date.now() / 60_000),
      ...v.conversations.map((c) => `${c.id}|${c.name}|${c.unread}|${c.lastActivity}|${c.messages[c.messages.length - 1]?.id ?? ""}`),
    ].join("~");
    if (key === listKey) return;
    listKey = key;
    unreadTag.textContent = v.unread > 0 ? t("{0} unread", { 0: v.unread }) : "";
    unreadTag.style.display = v.unread > 0 ? "" : "none";
    clear(listBody);
    if (v.link.state !== "connected") {
      listBody.append(
        h("div", { class: "int-status" }, dot(cfg.linkColor(v.link), 5), h("span", { class: "wa-status-text", text: cfg.linkLabel(v.link) })),
        h("div", { class: "int-actions" }, h("button", {
          class: "link-btn wa-settings", text: t("Settings…"), onclick: () => host.openSettings(),
        })),
      );
    } else if (v.conversations.length === 0) {
      listBody.append(h("div", { class: "wa-empty", text: t("No new messages") }));
    } else {
      listBody.append(h("div", { class: "int-rows wa-rows" }, ...v.conversations.map(row)));
    }
  }

  function syncConversation(c: WaConversation) {
    const v = cfg.view();
    const shown = lastMessages(c);
    const key = [language(), c.id, c.name, ...shown.map((m) => m.id)].join("~");
    if (key !== convoKey) {
      const wasAtBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 24;
      const first = convoKey === "";
      convoKey = key;
      clear(convoAvatar);
      convoAvatar.append(avatar(cfg.color, c.name, c.isGroup));
      convoName.textContent = c.name;
      convoName.title = c.id.split("@")[0];
      clear(messages);
      for (const m of shown) messages.append(bubble(m, c.isGroup, (x) => openDetail(x, c.isGroup)));
      // The newest at the bottom, in view.
      if (first || wasAtBottom) messages.scrollTop = messages.scrollHeight;
    }
    field.placeholder = t("Reply…  (Shift+Enter: new line)");
    note.className = "wa-note";
    if (v.link.state !== "connected") {
      note.textContent = cfg.linkLabel(v.link);
      note.classList.add("warn");
    } else if (v.sendError) {
      note.textContent = cfg.sendErrorLabel(v.sendError as never);
      note.classList.add("err");
    } else {
      note.textContent = "";
    }
    syncSendButton();
  }

  function sync() {
    const c = current();
    // Kept open through a missed check (the draft too): only gone when the messenger is off or the
    // conversation left the list (ignored).
    if (openChat != null && (!c || !cfg.view().on)) {
      close();
      return;
    }
    listView.style.display = c ? "none" : "";
    convoView.style.display = c && !detail ? "" : "none";
    detailView.style.display = c && detail ? "" : "none";
    if (c) syncConversation(c);
    else syncList();
  }

  return { el, sync };
}
