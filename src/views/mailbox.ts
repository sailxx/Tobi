// The mail card for any mailbox over IMAP: the shared mail card (mail-card.ts) with this account's words and bridge calls.

import { Bridge } from "../core/bridge";
import { linkColor, sendErrorLabel as gmailSendError, type MailSendError } from "../core/gmail";
import { MAILBOX_BLUE, MAILBOX_ID, Mailbox, linkLabel } from "../core/mailbox";
import { t } from "../i18n/i18n";
import { buildMailCard, type MailCard, type MailCardHost } from "./mail-card";

function sendErrorLabel(e: MailSendError): string {
  if (e.code === "refused" && e.detail === "noFolder") return t("The server has no archive or bin folder to move mail to.");
  if (e.code === "needsLogin") return t("The mail server refused the address or password: check them in Settings");
  return gmailSendError(e);
}

export function buildMailboxCard(host: MailCardHost): MailCard {
  return buildMailCard({
    id: MAILBOX_ID,
    title: t("Mail"),
    color: MAILBOX_BLUE,
    view: () => Mailbox.view,
    linkLabel,
    linkColor,
    sendErrorLabel,
    bridge: {
      refresh: () => Bridge.mailboxRefresh(),
      open: (id) => Bridge.mailboxOpen(id),
      close: () => Bridge.mailboxClose(),
      archive: (id) => Bridge.mailboxArchive(id),
      trash: (id) => Bridge.mailboxTrash(id),
      reply: (id, text) => Bridge.mailboxReply(id, text),
      send: (to, subject, text) => Bridge.mailboxSend(to, subject, text),
    },
  }, host);
}
