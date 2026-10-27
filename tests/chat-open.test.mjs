// An open messenger conversation (views/chat-card.ts): the island stays open while it is, grows taller,
// and goes back to its size when the conversation closes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { Telegram, IDLE_TELEGRAM, TELEGRAM_ID } from "../src/core/telegram.ts";
import { CHAT_OPEN_H, VIEW_LAYOUTS, islandSize } from "../src/core/layout.ts";
import { DEFAULT_SETTINGS, State } from "../src/core/state.ts";
import { buildTelegramCard } from "../src/views/telegram.ts";

installFakeDom();

const NOW = Date.now();
const msg = (i) => ({
  id: String(i), chat: "42", sender: "42", senderName: "", text: `Message ${i}`, media: { kind: "none" },
  date: NOW - (30 - i) * 1000, fromMe: false, mentionsMe: false,
});

test("an open conversation holds the island open, makes it taller and Tobi steps out; closing undoes it", () => {
  State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: [TELEGRAM_ID] };
  State.loadIntegrationTasks();
  Telegram.view = { ...IDLE_TELEGRAM, on: true, link: { state: "connected" }, unread: 1, conversations: [
    { id: "42", name: "Marie", isGroup: false, unread: 1, lastActivity: NOW, messages: Array.from({ length: 14 }, (_, i) => msg(i)) },
  ] };
  State.mode = "expanded";
  State.view = "overview";
  State.focusId = TELEGRAM_ID;
  const holds = [];
  try {
    const c = buildTelegramCard({ openSettings() {}, keyboard() {}, holdOpen: (on) => holds.push(on) });
    c.sync();
    assert.equal(State.chatOpen, false);
    assert.equal(islandSize("expanded", "overview", 0, State.chatOpen).h, VIEW_LAYOUTS.overview.height);

    c.el.find(".wa-row")[0].fire("click");
    assert.equal(State.chatOpen, true);
    assert.deepEqual(holds, [true], "held for the whole conversation, not only while a draft is typed");
    assert.equal(islandSize("expanded", "overview", 0, State.chatOpen).h, CHAT_OPEN_H);
    assert.equal(c.el.find(".wa-bubble").length, 10, "only the last ten messages are shown");

    c.el.find(".wa-back")[0].fire("click");
    assert.equal(State.chatOpen, false);
    assert.deepEqual(holds, [true, false]);
    assert.equal(islandSize("expanded", "overview", 0, State.chatOpen).h, VIEW_LAYOUTS.overview.height);
  } finally {
    State.chatOpen = false;
    Telegram.view = { ...IDLE_TELEGRAM };
  }
});

test("folding the island closes the open conversation and releases the hold", () => {
  State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: [TELEGRAM_ID] };
  State.loadIntegrationTasks();
  Telegram.view = { ...IDLE_TELEGRAM, on: true, link: { state: "connected" }, unread: 0, conversations: [
    { id: "42", name: "Marie", isGroup: false, unread: 0, lastActivity: NOW, messages: [msg(1)] },
  ] };
  State.mode = "expanded";
  State.view = "overview";
  State.focusId = TELEGRAM_ID;
  const holds = [];
  try {
    const c = buildTelegramCard({ openSettings() {}, keyboard() {}, holdOpen: (on) => holds.push(on) });
    c.sync();
    c.el.find(".wa-row")[0].fire("click");
    assert.equal(State.chatOpen, true);
    State.mode = "compact";
    State.notify();
    assert.equal(State.chatOpen, false);
    assert.deepEqual(holds, [true, false]);
  } finally {
    State.chatOpen = false;
    State.mode = "hidden";
    Telegram.view = { ...IDLE_TELEGRAM };
  }
});
