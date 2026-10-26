// Gmail (experimental) on the page: what src-tauri/src/gmail reports, and the words for it. Rust only
// ever sends codes; the words are chosen here, in the user's language. Nothing of a message is
// stored by the page either, and only a message's plain text ever arrives: no HTML, no images.

import { t } from "../i18n/i18n";

export const GMAIL_ID = "integration_gmail";
/** Gmail's red: the pill keeps it whatever, like the brand. */
export const GMAIL_RED = "#EA4335";

export type MailLink =
  | { state: "off" | "needsSetup" | "needsLogin" | "signingIn" | "connecting" | "connected" | "unreachable" }
  | { state: "failed"; detail: string };

export type MailSendError =
  | { code: "tooLong" | "tooFast" | "empty" | "badAddress" | "unreachable" | "needsLogin" }
  | { code: "refused"; detail: string };

export interface MailItem {
  id: string;
  threadId: string;
  from: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  /** Unix ms. */
  date: number;
  unread: boolean;
}

export interface MailBody {
  id: string;
  threadId: string;
  from: string;
  fromAddress: string;
  to: string;
  subject: string;
  date: number;
  text: string;
  unread: boolean;
}

/** IslandView in src-tauri/src/gmail/mod.rs. */
export interface MailIslandView {
  on: boolean;
  link: MailLink;
  /** Newest first. */
  items: MailItem[];
  unread: number;
  opened: MailBody | null;
  sending: boolean;
  sendError: MailSendError | null;
  down: boolean;
  account: string | null;
}

export const IDLE_MAIL: MailIslandView = {
  on: false, link: { state: "off" }, items: [], unread: 0, opened: null, sending: false, sendError: null, down: false, account: null,
};

/** The page's copy of what Rust keeps. */
export const Mail = {
  view: { ...IDLE_MAIL } as MailIslandView,
};

export type MailSignInError = "denied" | "timeout" | "network" | "badClient" | "badAnswer" | "noCode" | "other";

/** SettingsView in src-tauri/src/gmail/mod.rs. */
export interface MailSettingsView {
  prefs: { enabled: boolean; markReadOnOpen: boolean };
  /** The client id is no secret; the secret never leaves Rust. */
  clientId: string | null;
  hasSecret: boolean;
  /** Tobi ships its own Google client: nothing to set up unless the user wants their own. */
  builtin: boolean;
  link: MailLink;
  account: string | null;
  error: MailSignInError | null;
  pillActive: boolean;
}

export function linkLabel(link: MailLink): string {
  switch (link.state) {
    case "off": return t("Turned off in Settings");
    case "needsSetup": return t("Enter your Google OAuth client in Settings");
    case "needsLogin": return t("Sign in to Google in Settings");
    case "signingIn": return t("Waiting for you in the browser…");
    case "connecting": return t("Connecting to Gmail…");
    case "connected": return t("Connected");
    case "unreachable": return t("Gmail doesn’t answer: check your connection");
    case "failed":
      if (link.detail === "forbidden") return t("Google refused: turn on the Gmail API for your project and allow the Gmail scope.");
      if (link.detail === "rate") return t("Gmail asks to slow down: trying again in a minute.");
      return link.detail;
  }
}

export function linkColor(link: MailLink): string {
  switch (link.state) {
    case "connected": return "#22C55E";
    case "connecting":
    case "signingIn":
    case "needsSetup":
    case "needsLogin": return "#F5B83D";
    case "off": return "#6B7079";
    default: return "#F4505E";
  }
}

export function sendErrorLabel(e: MailSendError): string {
  switch (e.code) {
    case "tooLong": return t("Too long for one message.");
    case "tooFast": return t("A few messages a minute at most: wait a moment.");
    case "empty": return t("Write something first.");
    case "badAddress": return t("That isn’t a valid email address.");
    case "unreachable": return t("Gmail doesn’t answer: check your connection");
    case "needsLogin": return t("Sign in to Google in Settings");
    case "refused": return e.detail === "forbidden" ? t("Google refused to send: check the Gmail scope in your project.") : e.detail;
  }
}

export function signInErrorLabel(e: MailSignInError): string {
  switch (e) {
    case "denied": return t("The sign-in was cancelled.");
    case "timeout": return t("The browser didn’t come back in three minutes. Try again.");
    case "network": return t("Couldn’t reach Google. Check your connection.");
    case "badClient": return t("Google refused the client id or secret. Copy them again from the Cloud Console.");
    case "badAnswer": return t("Google’s answer wasn’t understood. Try again.");
    case "noCode": return t("Google didn’t give Tobi permission to stay signed in. Remove Tobi from your Google account’s apps and try again.");
    case "other": return t("Something went wrong. Try again.");
  }
}

/** The subject, or a word for "none". */
export function subjectOf(subject: string): string {
  return subject.trim() || t("(no subject)");
}
