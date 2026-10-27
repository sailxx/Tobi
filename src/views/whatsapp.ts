// The WhatsApp card: the shared chat card (chat-card.ts) with WhatsApp's colour, words and bridge calls.

import { Bridge } from "../core/bridge";
import { WHATSAPP_GREEN, WHATSAPP_ID, WhatsApp, linkColor, linkLabel, sendErrorLabel } from "../core/whatsapp";
import { buildChatCard, type ChatCard, type ChatCardHost } from "./chat-card";

export type WhatsAppCardHost = ChatCardHost;
export type WhatsAppCard = ChatCard;

export function buildWhatsAppCard(host: WhatsAppCardHost): WhatsAppCard {
  return buildChatCard({
    id: WHATSAPP_ID,
    title: "WhatsApp",
    color: WHATSAPP_GREEN,
    view: () => WhatsApp.view,
    linkLabel: (l) => linkLabel(l as never),
    linkColor: (l) => linkColor(l as never),
    sendErrorLabel: (e) => sendErrorLabel(e),
    bridge: {
      open: (c) => Bridge.whatsappOpen(c),
      close: (c) => Bridge.whatsappClose(c),
      send: (c, t) => Bridge.whatsappSend(c, t),
      ignore: (c) => Bridge.whatsappIgnore(c),
      expand: (m) => Bridge.openMessageWindow(m),
    },
  }, host);
}
