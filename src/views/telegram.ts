// The Telegram card: the shared chat card (chat-card.ts) with Telegram's colour, words and bridge calls.

import { Bridge } from "../core/bridge";
import { TELEGRAM_BLUE, TELEGRAM_ID, Telegram, linkColor, linkLabel, sendErrorLabel } from "../core/telegram";
import { buildChatCard, type ChatCard, type ChatCardHost } from "./chat-card";

export function buildTelegramCard(host: ChatCardHost): ChatCard {
  return buildChatCard({
    id: TELEGRAM_ID,
    title: "Telegram",
    color: TELEGRAM_BLUE,
    view: () => Telegram.view,
    linkLabel: (l) => linkLabel(l as never),
    linkColor: (l) => linkColor(l as never),
    sendErrorLabel: (e) => sendErrorLabel(e),
    bridge: {
      open: (c) => Bridge.telegramOpen(c),
      close: (c) => Bridge.telegramClose(c),
      send: (c, t) => Bridge.telegramSend(c, t),
      ignore: (c) => Bridge.telegramIgnore(c),
      media: (c, id) => Bridge.telegramMedia(c, id),
    },
  }, host);
}
