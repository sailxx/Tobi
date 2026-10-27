// WhatsApp (experimental): the page's rules in src/core/whatsapp.ts, the pill's reactions in
// src/island/whatsapp.ts, the card in src/views/whatsapp.ts. The gateway side — payloads,
// signatures, filters, the inbox, the installer — is tested in src-tauri/src/whatsapp/.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { emit, internals, sent } from "./tauri.mjs";
import { installFakeDom } from "./fakedom.mjs";
import {
  IDLE_WHATSAPP, WHATSAPP_ID, WhatsApp, canSend, copyableText, duration, hasPhoto, initials, installError, installFailure, installStepLabel,
  keyAction, lastMessages, linkColor, linkLabel, preview, sendErrorLabel, showsLinkState, testResultLabel, timeAgo,
  webhookLine,
} from "../src/core/whatsapp.ts";
import { handlePillEvent, registerWhatsAppHandlers } from "../src/island/whatsapp.ts";
import { buildWhatsAppCard } from "../src/views/whatsapp.ts";
import { buildTelegramCard } from "../src/views/telegram.ts";
import { Telegram, IDLE_TELEGRAM, TELEGRAM_ID } from "../src/core/telegram.ts";
import { pillDefinition } from "../src/core/pills.ts";
import { DEFAULT_SETTINGS, State } from "../src/core/state.ts";
import { lookup, setLanguage } from "../src/i18n/i18n.ts";

installFakeDom();

// The card listens for Escape on the window while a message is open whole.
const windowKeys = [];
globalThis.addEventListener = (type, fn) => type === "keydown" && windowKeys.push(fn);
globalThis.removeEventListener = (type, fn) => {
  const i = windowKeys.indexOf(fn);
  if (type === "keydown" && i >= 0) windowKeys.splice(i, 1);
};

const NOW = 1_800_000_000_000;

const msg = (over = {}) => ({
  id: "m1", chat: "33612345678@s.whatsapp.net", sender: "33612345678@s.whatsapp.net", senderName: "",
  text: "Hello", media: { kind: "none" }, date: NOW - 30_000, fromMe: false, mentionsMe: false, ...over,
});

const conversation = (over = {}) => ({
  id: "33612345678@s.whatsapp.net", name: "Marie", isGroup: false, messages: [msg()], unread: 1,
  lastActivity: NOW - 30_000, ...over,
});

const connected = (over = {}) => ({ ...IDLE_WHATSAPP, on: true, link: { state: "connected" }, ...over });

// ── The pure rules (WhatsAppModels.swift, WhatsAppViews.swift) ─────────────────

test("initials: the first letters of two words, # when there are none", () => {
  assert.equal(initials("Marie Curie"), "MC");
  assert.equal(initials("jean-luc picard"), "JL");
  assert.equal(initials("Élodie"), "É");
  assert.equal(initials("+33612345678"), "#");
  assert.equal(initials(""), "#");
  assert.equal(duration(12), "0:12");
  assert.equal(duration(75), "1:15");
});

test("previews: one line, media as a label only, who wrote it in a group", () => {
  assert.equal(preview(msg({ text: "see\nyou" }), false), "see you");
  assert.equal(preview(msg({ fromMe: true, text: "ok" }), false), "You: ok");
  assert.equal(preview(msg({ senderName: "Paul", text: "hi" }), true), "Paul: hi");
  assert.equal(preview(msg({ senderName: "Paul", text: "hi" }), false), "hi", "a private chat needs no name");
  assert.equal(preview(msg({ media: { kind: "image" }, text: "look" }), false), "Photo · look");
  assert.equal(preview(msg({ media: { kind: "voice", seconds: null }, text: "" }), false), "Voice message");
  assert.equal(preview(msg({ media: { kind: "voice", seconds: 75 }, text: "" }), false), "Voice message · 1:15");
  assert.equal(preview(msg({ media: { kind: "document", name: "devis.pdf" }, text: "" }), false), "Document · devis.pdf");
  assert.equal(preview(msg({ media: { kind: "sticker" }, text: "" }), false), "Sticker");
  assert.equal(preview(msg({ media: { kind: "other" }, text: "" }), false), "Message");
});

test("the time since reads like the Mac's", () => {
  assert.equal(timeAgo(NOW - 10_000, NOW), "now");
  assert.equal(timeAgo(NOW - 5 * 60_000, NOW), "5m");
  assert.equal(timeAgo(NOW - 3 * 3_600_000, NOW), "3h");
  assert.equal(timeAgo(NOW - 2 * 86_400_000, NOW), "2d");
});

test("Rust's codes become words, a gateway's own message is shown as it is", () => {
  assert.equal(linkLabel({ state: "off" }), "Turned off in Settings");
  assert.equal(linkLabel({ state: "needsQr" }), "Scan the QR code in Settings");
  assert.equal(linkLabel({ state: "unreachable" }), "The gateway doesn’t answer: is it running?");
  assert.equal(linkLabel({ state: "failed", detail: "DEVICE_ID_REQUIRED" }), "DEVICE_ID_REQUIRED");
  assert.equal(linkColor({ state: "connected" }), "#22C55E");
  assert.equal(linkColor({ state: "needsQr" }), "#F5B83D");
  assert.equal(linkColor({ state: "unauthorized" }), "#F4505E");
  assert.equal(sendErrorLabel({ code: "tooFast" }), "A few replies a minute at most: wait a moment.");
  assert.equal(sendErrorLabel({ code: "refused", detail: "INVALID_JID" }), "INVALID_JID");
  assert.equal(webhookLine({ state: "registered" }), "Live: new messages arrive at once.");
  assert.equal(webhookLine({ state: "portBusy", port: 47823 }),
    "Port 47823 is taken: pick another one. Checking every 20 s meanwhile.");
  assert.equal(webhookLine({ state: "listening" }), "Checking for new messages every 20 s.");
  assert.equal(testResultLabel({ result: "connected", who: "+33612345678" }), "Connected as +33612345678.");
  assert.equal(testResultLabel({ result: "unreachable" }), "The gateway doesn’t answer: is it running?");
  assert.equal(installStepLabel({ step: "downloading", megabytes: 15 }), "Downloading (15 MB)…");
  assert.equal(installStepLabel({ step: "idle" }), "");
  assert.match(installFailure("badChecksum"), /doesn't match the file GOWA published/);
  assert.match(installFailure("anything else"), /didn't go through/);
  assert.equal(installError({ step: "done", version: "9.6.0" }), null);
  assert.match(installError({ step: "failed", reason: "noBuild" }), /No GOWA build for this computer/);
});

test("the status and QR show once there is a gateway to talk to", () => {
  const base = {
    prefs: { gateway: "gowa" }, url: "", installed: false, link: { state: "unreachable" },
  };
  assert.equal(showsLinkState(base), false, "before the install, 'it doesn't answer' would only confuse");
  assert.equal(showsLinkState({ ...base, installed: true }), true);
  assert.equal(showsLinkState({ ...base, url: "http://127.0.0.1:3001" }), true);
  assert.equal(showsLinkState({ ...base, prefs: { gateway: "openwa" } }), true);
  assert.equal(showsLinkState({ ...base, link: { state: "needsQr" } }), true);
});

test("Enter sends, Shift+Enter is a new line, Escape goes back, a composition never sends", () => {
  assert.equal(keyAction({ key: "Enter", shiftKey: false }), "send");
  assert.equal(keyAction({ key: "Enter", shiftKey: true }), "newline");
  assert.equal(keyAction({ key: "Enter", shiftKey: false, isComposing: true }), null);
  assert.equal(keyAction({ key: "Escape", shiftKey: false }), "back");
  assert.equal(keyAction({ key: "a", shiftKey: false }), null);
  assert.equal(canSend("  \n ", false), false);
  assert.equal(canSend("hi", true), false, "one reply at a time");
  assert.equal(canSend("hi", false), true);
  const many = conversation({ messages: Array.from({ length: 20 }, (_, i) => msg({ id: `m${i}` })) });
  assert.deepEqual(lastMessages(many).map((m) => m.id), ["m10", "m11", "m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19"]);
});

test("a message opens whole when it has text or a photo; copying takes the text as written", () => {
  assert.equal(hasPhoto(msg({ media: { kind: "image" } })), true);
  assert.equal(hasPhoto(msg({ media: { kind: "video" } })), false);
  assert.equal(hasPhoto(msg()), false);
  assert.equal(copyableText(msg({ text: "  line one\nline two \n" })), "line one\nline two");
  assert.equal(copyableText(msg({ text: "", media: { kind: "image" } })), "", "a bare photo has no text to copy");
});

test("the words are translated", () => {
  setLanguage("fr");
  try {
    assert.equal(linkLabel({ state: "connected" }), lookup("Connected", "fr"));
    assert.equal(preview(msg({ media: { kind: "image" }, text: "" }), false), lookup("Photo", "fr"));
    assert.ok(!webhookLine({ state: "registered" }).startsWith("Live"));
  } finally {
    setLanguage("en");
  }
});

// ── The pill (WhatsAppController.announce) ────────────────────────────────────

const host = { reveals: 0, emotes: [], reveal() { this.reveals++; }, emote(name) { this.emotes.push(name); } };
registerWhatsAppHandlers(host);

beforeEach(() => {
  State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: [WHATSAPP_ID] };
  State.os = "windows";
  State.tasks = [];
  State.focusId = null;
  State.mode = "hidden";
  State.view = "overview";
  State.paused = false;
  State.loadIntegrationTasks();
  WhatsApp.view = { ...IDLE_WHATSAPP };
  host.reveals = 0;
  host.emotes = [];
});

const pill = () => State.tasks.find((t) => t.id === WHATSAPP_ID);

test("the pill is the Mac's, connected with nothing to enter", () => {
  const def = pillDefinition(WHATSAPP_ID);
  assert.equal(def.color, "#25D366");
  assert.equal(def.support, "yes");
  assert.deepEqual(def.connect, { kind: "none" });
  assert.ok(pill(), "declared, it is on the island");
});

test("a new message lights the pill with the chat's name only, and Tobi smiles once per burst", () => {
  handlePillEvent(host, { kind: "message", name: "Marie" }, 10_000);
  assert.equal(pill().state, "finished");
  assert.deepEqual(pill().steps, ["Marie"]);
  assert.equal(pill().pillBadge, "finished");
  assert.deepEqual(host.emotes, ["happy"]);
  assert.equal(host.reveals, 1);
  handlePillEvent(host, { kind: "message", name: "Paul" }, 12_000);
  assert.deepEqual(pill().steps, ["Paul"]);
  assert.deepEqual(host.emotes, ["happy"], "a burst is one reaction");
  handlePillEvent(host, { kind: "message", name: "Paul" }, 20_000);
  assert.deepEqual(host.emotes, ["happy", "happy"]);
  // Read: the badge goes.
  emit("whatsapp-pill", { kind: "read" });
  assert.equal(pill().pillBadge, null);
  // Turned off: back to idle.
  emit("whatsapp-pill", { kind: "reset" });
  assert.equal(pill().state, "idle");
  assert.deepEqual(pill().steps, []);
});

test("paused, or the pill on screen: no badge", () => {
  State.paused = true;
  handlePillEvent(host, { kind: "message", name: "Marie" }, 100_000);
  assert.equal(pill().state, "idle");
  State.paused = false;
  State.focusId = WHATSAPP_ID;
  handlePillEvent(host, { kind: "message", name: "Marie" }, 200_000);
  assert.equal(pill().state, "finished");
  assert.equal(pill().pillBadge ?? null, null);
});

test("the gateway down twice: the small red dot, gone when it answers", () => {
  emit("whatsapp", connected({ down: true }));
  assert.equal(pill().pillBadge, "error");
  emit("whatsapp", connected({ down: false }));
  assert.equal(pill().pillBadge, null);
});

// ── The card (WhatsAppCardView, WhatsAppConversationView) ─────────────────────

function card() {
  const calls = { settings: 0, keyboard: [], hold: [] };
  const built = buildWhatsAppCard({
    openSettings: () => calls.settings++,
    keyboard: (on) => calls.keyboard.push(on),
    holdOpen: (on) => calls.hold.push(on),
  });
  return { ...built, calls };
}

const key = (el, k, shiftKey = false) => {
  const event = { key: k, shiftKey, defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
  for (const fn of el.listeners.get("keydown") ?? []) fn(event);
  return event;
};

test("not linked: why, and the way to Settings", () => {
  const c = card();
  WhatsApp.view = { ...IDLE_WHATSAPP, on: true, link: { state: "unreachable" } };
  c.sync();
  assert.match(c.el.textContent, /WhatsApp.*The gateway doesn’t answer: is it running\?.*Settings…/);
  c.el.find(".wa-settings")[0].fire("click");
  assert.equal(c.calls.settings, 1);
});

test("linked: one row per conversation, the unread count, or nothing new", () => {
  const c = card();
  WhatsApp.view = connected();
  c.sync();
  assert.match(c.el.textContent, /No new messages/);
  WhatsApp.view = connected({
    unread: 3,
    conversations: [
      conversation({ unread: 2 }),
      conversation({ id: "1203@g.us", name: "Famille", isGroup: true, unread: 1,
        messages: [msg({ chat: "1203@g.us", senderName: "Paul", text: "<b>@33612345678</b> tu viens ?" })] }),
    ],
  });
  c.sync();
  const rows = c.el.find(".wa-row");
  assert.equal(rows.length, 2);
  assert.match(c.el.textContent, /3 unread/);
  assert.match(rows[0].textContent, /Marie.*Hello.*2/);
  // Text is text, never markup (the fake DOM throws on innerHTML).
  assert.match(rows[1].textContent, /Paul: <b>@33612345678<\/b> tu viens \?/);
});

test("a right-click offers to ignore the chat, and only a click does it", () => {
  const c = card();
  WhatsApp.view = connected({ unread: 1, conversations: [conversation()] });
  c.sync();
  c.el.find(".wa-row")[0].fire("contextmenu");
  assert.equal(sent("whatsapp_ignore").length, 0);
  c.el.find(".wa-ignore")[0].fire("click");
  assert.deepEqual(sent("whatsapp_ignore").at(-1), { chat: "33612345678@s.whatsapp.net" });
});

test("a conversation: its messages, a reply sent on Enter only, Escape back to the list", async () => {
  const c = card();
  WhatsApp.view = connected({
    unread: 1,
    conversations: [conversation({ messages: [msg(), msg({ id: "m2", fromMe: true, text: "Salut !" })] })],
  });
  State.mode = "expanded";
  State.focusId = WHATSAPP_ID;
  c.sync();
  const before = sent("whatsapp_open").length;
  c.el.find(".wa-row")[0].fire("click");
  assert.deepEqual(sent("whatsapp_open").slice(before), [{ chat: "33612345678@s.whatsapp.net" }]);
  assert.deepEqual(c.calls.keyboard, [true], "the island takes the keyboard for the field");
  const bubbles = c.el.find(".wa-bubble");
  assert.equal(bubbles.length, 2);
  assert.ok(bubbles[1].classList.contains("mine"));

  const field = c.el.find("TEXTAREA")[0];
  const sends = () => sent("whatsapp_send").length;
  const start = sends();
  // Nothing to send: nothing goes.
  field.value = "   ";
  key(field, "Enter");
  assert.equal(sends(), start);
  // Typing holds the island open; Shift+Enter is a new line, not a send.
  field.value = "On arrive";
  for (const fn of field.listeners.get("input")) fn({});
  assert.deepEqual(c.calls.hold, [true]);
  const shifted = key(field, "Enter", true);
  assert.equal(shifted.defaultPrevented, false);
  assert.equal(sends(), start);
  const enter = key(field, "Enter");
  assert.equal(enter.defaultPrevented, true);
  await Promise.resolve();
  assert.deepEqual(sent("whatsapp_send").slice(start), [{ chat: "33612345678@s.whatsapp.net", text: "On arrive" }]);

  // A send refused: the reason shows under the field, the draft stays.
  WhatsApp.view = { ...WhatsApp.view, sendError: { code: "tooLong" } };
  c.sync();
  assert.match(c.el.find(".wa-note")[0].textContent, /Too long for one message/);

  // Escape: back to the list, not the island folding away.
  const esc = key(field, "Escape");
  assert.equal(esc.propagationStopped, true);
  assert.deepEqual(sent("whatsapp_close").at(-1), { chat: "33612345678@s.whatsapp.net" });
  assert.deepEqual(c.calls.keyboard, [true, false]);
  assert.equal(c.calls.hold.at(-1), false);
  assert.equal(c.el.find(".wa-row").length, 1);
});

test("the conversation closes when WhatsApp is turned off or the island folds", () => {
  const c = card();
  WhatsApp.view = connected({ unread: 1, conversations: [conversation()] });
  State.mode = "expanded";
  State.focusId = WHATSAPP_ID;
  c.sync();
  c.el.find(".wa-row")[0].fire("click");
  const closes = sent("whatsapp_close").length;
  State.mode = "compact";
  State.notify();
  assert.equal(sent("whatsapp_close").length, closes + 1);
  // Opened again, then the integration turned off.
  State.mode = "expanded";
  c.sync();
  c.el.find(".wa-row")[0].fire("click");
  WhatsApp.view = { ...IDLE_WHATSAPP };
  c.sync();
  assert.equal(sent("whatsapp_close").length, closes + 2);
});

test("a click on a message opens it whole; Escape or Back returns to the conversation", () => {
  const c = card();
  WhatsApp.view = connected({ unread: 1, conversations: [conversation({ messages: [msg({ text: "A long one.\nSecond line." })] })] });
  State.mode = "expanded";
  State.focusId = WHATSAPP_ID;
  c.sync();
  c.el.find(".wa-row")[0].fire("click");
  const [convo, detail] = [c.el.find(".wa-convo")[0], c.el.find(".wa-detail")[0]];
  assert.equal(detail.style.display, "none");
  c.el.find(".wa-bubble")[0].fire("click");
  assert.equal(convo.style.display, "none");
  assert.equal(detail.style.display, "");
  assert.equal(c.el.find(".wa-detail-text")[0].textContent, "A long one.\nSecond line.");
  assert.equal(c.calls.hold.at(-1), true, "the island stays open while a message is read");
  assert.equal(windowKeys.length, 1);

  // Escape closes the message, not the island or the conversation.
  const esc = { key: "Escape", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  for (const fn of [...windowKeys]) fn(esc);
  assert.equal(esc.stopped, true);
  assert.equal(detail.style.display, "none");
  assert.equal(convo.style.display, "");
  assert.equal(c.calls.hold.at(-1), false);
  assert.equal(windowKeys.length, 0);

  // Open again, then Back.
  c.el.find(".wa-bubble")[0].fire("click");
  c.el.find(".wa-back")[1].fire("click");
  assert.equal(detail.style.display, "none");

  // Leaving the card with a message open drops its key listener too.
  c.el.find(".wa-bubble")[0].fire("click");
  State.mode = "compact";
  State.notify();
  assert.equal(windowKeys.length, 0);
});

test("a Telegram photo is fetched only when its message is opened, and its buttons follow", async () => {
  const photo = "data:image/jpeg;base64,/9j/";
  const invoke = internals.invoke;
  internals.invoke = async (cmd, args) => {
    const recorded = await invoke(cmd, args);
    return cmd === "telegram_media" ? (args.id === "p1" ? photo : null) : recorded;
  };
  try {
    State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: [TELEGRAM_ID] };
    State.loadIntegrationTasks();
    const chat = "42";
    Telegram.view = { ...IDLE_TELEGRAM, on: true, link: { state: "connected" }, unread: 1, conversations: [
      conversation({ id: chat, messages: [
        msg({ id: "p1", chat, media: { kind: "image" }, text: "look" }),
        msg({ id: "p2", chat, media: { kind: "image" }, text: "" }),
      ] }),
    ] };
    State.mode = "expanded";
    State.focusId = TELEGRAM_ID;
    const c = buildTelegramCard({ openSettings() {}, keyboard() {}, holdOpen() {} });
    c.sync();
    c.el.find(".wa-row")[0].fire("click");
    const asked = () => sent("telegram_media").length;
    assert.equal(asked(), 0, "opening the chat downloads nothing");
    const [textBtn, photoBtn] = c.el.find(".wa-detail-actions")[0].children;

    c.el.find(".wa-bubble")[0].fire("click");
    assert.equal(c.el.find(".wa-skeleton").length, 1, "a placeholder while it loads");
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(sent("telegram_media").at(-1), { chat, id: "p1" });
    assert.equal(c.el.find(".wa-photo-img")[0].getAttribute("src"), photo);
    assert.equal(textBtn.style.display, "");
    assert.equal(photoBtn.style.display, "");

    // A photo that won't come: said so, no Copy photo; a bare photo has no Copy text.
    c.el.find(".wa-back")[1].fire("click");
    c.el.find(".wa-bubble")[1].fire("click");
    await new Promise((r) => setTimeout(r, 0));
    assert.match(c.el.find(".wa-photo")[0].textContent, /can’t be loaded/);
    assert.equal(textBtn.style.display, "none");
    assert.equal(photoBtn.style.display, "none");
  } finally {
    internals.invoke = invoke;
    Telegram.view = { ...IDLE_TELEGRAM };
  }
});
