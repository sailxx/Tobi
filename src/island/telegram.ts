// Telegram's reports → the page (src-tauri/src/telegram), as WhatsApp's (island/whatsapp.ts): a new message lights the pill with the conversation's name (never the text),
// Tobi smiles and the "pop" sound plays — once for a burst, not ten times — and the pill goes back
// to idle a minute later; the pill gets its small red dot while Telegram can't be reached.

import { Bridge, onEvent } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { TELEGRAM_ID, Telegram, type TgIslandView } from "../core/telegram";
import type { BotEmoteName } from "../core/layout";

export interface TelegramHost {
  /** The compact island, so the badge is seen. */
  reveal(): void;
  emote(name: BotEmoteName): void;
}

export type TgPillEvent = { kind: "message"; name: string } | { kind: "read" } | { kind: "reset" };

/** A burst of messages is one reaction. */
const ANNOUNCE_GAP_MS = 4_000;
const RESET_AFTER_MS = 60_000;

let lastAnnounce = -Infinity;
let resetTimer: number | null = null;

export function registerTelegramHandlers(island: TelegramHost) {
  void onEvent<TgIslandView>("telegram", applyTelegram);
  void onEvent<TgPillEvent>("telegram-pill", (e) => handlePillEvent(island, e));
  void Bridge.telegramIsland().then((view) => {
    if (view) applyTelegram(view);
  });
}

function task() {
  return State.tasks.find((x) => x.id === TELEGRAM_ID);
}

/** A report from Rust: the card redraws, the pill's red dot follows the connection. */
export function applyTelegram(view: TgIslandView) {
  const wasDown = Telegram.view.down;
  Telegram.view = view;
  const t = task();
  if (t && view.down !== wasDown) {
    if (view.down) t.pillBadge = "error";
    else if (t.pillBadge === "error") t.pillBadge = null;
  }
  State.notify();
}

export function handlePillEvent(island: TelegramHost, e: TgPillEvent, now = performance.now()) {
  const t = task();
  if (!t) return;
  switch (e.kind) {
    case "message": {
      if (State.paused) return;
      t.state = "finished";
      t.steps = [e.name];
      t.stepIndex = 0;
      if (State.focusId !== TELEGRAM_ID) t.pillBadge = "finished";
      if (now - lastAnnounce > ANNOUNCE_GAP_MS) {
        lastAnnounce = now;
        island.emote("happy");
        Sound.play("pop");
      }
      island.reveal();
      if (resetTimer != null) window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        resetTimer = null;
        const x = task();
        if (!x || x.state !== "finished") return;
        x.state = "idle";
        x.steps = [];
        x.stepIndex = 0;
        if (x.pillBadge === "finished") x.pillBadge = null;
        State.notify();
      }, RESET_AFTER_MS);
      break;
    }
    case "read":
      if (t.pillBadge === "finished") t.pillBadge = null;
      break;
    case "reset":
      if (resetTimer != null) window.clearTimeout(resetTimer);
      resetTimer = null;
      t.state = "idle";
      t.steps = [];
      t.stepIndex = 0;
      t.pillBadge = null;
      break;
  }
  State.notify();
}
