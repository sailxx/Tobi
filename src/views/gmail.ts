// The Gmail card: the shared mail card (mail-card.ts) with Gmail's colour, words and bridge calls.

import { Bridge } from "../core/bridge";
import { GMAIL_ID, GMAIL_RED, Mail, linkColor, linkLabel, sendErrorLabel } from "../core/gmail";
import { buildMailCard, type MailCard, type MailCardHost } from "./mail-card";

export function buildGmailCard(host: MailCardHost): MailCard {
  return buildMailCard({
    id: GMAIL_ID,
    title: "Gmail",
    color: GMAIL_RED,
    view: () => Mail.view,
    linkLabel,
    linkColor,
    sendErrorLabel,
    bridge: {
      refresh: () => Bridge.gmailRefresh(),
      open: (id) => Bridge.gmailOpen(id),
      close: () => Bridge.gmailClose(),
      archive: (id) => Bridge.gmailArchive(id),
      trash: (id) => Bridge.gmailTrash(id),
      reply: (id, text) => Bridge.gmailReply(id, text),
      send: (to, subject, text) => Bridge.gmailSend(to, subject, text),
    },
  }, host);
}
