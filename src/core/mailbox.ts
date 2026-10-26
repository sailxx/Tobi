// Mail over IMAP (experimental) on the page: what src-tauri/src/mailbox reports. It speaks the same
// island language as Gmail's (core/gmail.ts: the view, the messages, the send errors), so the same
// card draws both; only the words about the account differ. Rust only ever sends codes.

import { t } from "../i18n/i18n";
import { type MailIslandView, type MailLink, IDLE_MAIL } from "./gmail";

export const MAILBOX_ID = "integration_mail";
/** A calm blue for the mail pill, apart from Gmail's red and Telegram's cyan. */
export const MAILBOX_BLUE = "#60A5FA";

/** The page's copy of what Rust keeps. */
export const Mailbox = {
  view: { ...IDLE_MAIL } as MailIslandView,
};

export interface MailboxPrefs {
  enabled: boolean;
  markReadOnOpen: boolean;
  provider: string;
  email: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export interface MailPreset {
  id: string;
  name: string;
  helpUrl: string;
}

/** SettingsView in src-tauri/src/mailbox/mod.rs. */
export interface MailboxSettingsView {
  prefs: MailboxPrefs;
  hasPassword: boolean;
  link: MailLink;
  account: string | null;
  pillActive: boolean;
  presets: MailPreset[];
}

export function linkLabel(link: MailLink): string {
  switch (link.state) {
    case "off": return t("Turned off in Settings");
    case "needsSetup": return t("Enter your mail account in Settings");
    case "needsLogin": return t("The mail server refused the address or password: check them in Settings");
    case "signingIn": return t("Connecting to your mail…");
    case "connecting": return t("Connecting to your mail…");
    case "connected": return t("Connected");
    case "unreachable": return t("The mail server doesn’t answer: check your connection");
    case "failed":
      if (link.detail === "noFolder") return t("The server has no archive or bin folder to move mail to.");
      if (link.detail === "tooLarge") return t("That message is too large to show here.");
      return link.detail;
  }
}
