// Telegram (experimental) on the page: what src-tauri/src/telegram reports, and the words for it.
// The messages and chats have WhatsApp's shape (core/whatsapp.ts: initials, previews, ages, keys),
// so the same card draws both. Rust only ever sends codes; the words are chosen here, in the
// user's language. Nothing of a message is stored by the page either.

import { t } from "../i18n/i18n";
import type { WaConversation, WaMessage } from "./whatsapp";

export const TELEGRAM_ID = "integration_telegram";
/** Telegram's own blue: the pill keeps it whatever, like the brand. */
export const TELEGRAM_BLUE = "#2AABEE";

export type TgMessage = WaMessage;
export type TgChat = WaConversation;

export type TgLink =
  | { state: "off" | "needsSetup" | "needsLogin" | "connecting" | "connected" | "unreachable" }
  | { state: "failed"; detail: string };

export type TgSendError =
  | { code: "tooLong" | "tooFast" | "unreachable" | "needsLogin" }
  | { code: "refused"; detail: string };

/** IslandView in src-tauri/src/telegram/mod.rs. */
export interface TgIslandView {
  on: boolean;
  link: TgLink;
  /** Newest first, filters applied. */
  conversations: TgChat[];
  unread: number;
  sending: boolean;
  sendError: TgSendError | null;
  /** The connection failed: the pill's red dot. */
  down: boolean;
}

export const IDLE_TELEGRAM: TgIslandView = {
  on: false, link: { state: "off" }, conversations: [], unread: 0, sending: false, sendError: null, down: false,
};

/** The page's copy of what Rust keeps. */
export const Telegram = {
  view: { ...IDLE_TELEGRAM } as TgIslandView,
};

export interface TgPrefs {
  enabled: boolean;
  markReadOnOpen: boolean;
  muteGroups: boolean;
  ignored: string[];
}

export type TgLoginError = "badPhone" | "badApi" | "invalidCode" | "invalidPassword" | "flood" | "signUp" | "other";

export interface TgLogin {
  stage: "none" | "code" | "password";
  hint: string | null;
  error: TgLoginError | null;
}

/** SettingsView in src-tauri/src/telegram/mod.rs. */
export interface TgSettingsView {
  prefs: TgPrefs;
  /** The API id is no secret; the hash never leaves Rust. */
  apiId: string | null;
  hasApiHash: boolean;
  link: TgLink;
  login: TgLogin;
  me: string | null;
  pillActive: boolean;
  ignored: { id: string; name: string }[];
}

export function linkLabel(link: TgLink): string {
  switch (link.state) {
    case "off": return t("Turned off in Settings");
    case "needsSetup": return t("Enter your Telegram API id and hash in Settings");
    case "needsLogin": return t("Sign in to Telegram in Settings");
    case "connecting": return t("Connecting to Telegram…");
    case "connected": return t("Connected");
    case "unreachable": return t("Telegram doesn’t answer: check your connection");
    case "failed": return link.detail === "flood" ? t("Telegram asks to wait a little before trying again") : link.detail;
  }
}

export function linkColor(link: TgLink): string {
  switch (link.state) {
    case "connected": return "#22C55E";
    case "connecting":
    case "needsSetup":
    case "needsLogin": return "#F5B83D";
    case "off": return "#6B7079";
    default: return "#F4505E";
  }
}

export function sendErrorLabel(e: TgSendError): string {
  switch (e.code) {
    case "tooLong": return t("Too long for one message (4,096 characters at most).");
    case "tooFast": return t("A few replies a minute at most: wait a moment.");
    case "unreachable": return t("Telegram doesn’t answer: check your connection");
    case "needsLogin": return t("Sign in to Telegram in Settings");
    case "refused": return e.detail;
  }
}

/** Why a sign-in step failed, in words. */
export function loginErrorLabel(e: TgLoginError): string {
  switch (e) {
    case "badPhone": return t("That phone number isn’t valid. Use the international form, +…");
    case "badApi": return t("Telegram refused the API id or hash. Copy them again from my.telegram.org.");
    case "invalidCode": return t("That code isn’t right. Check the latest message from Telegram.");
    case "invalidPassword": return t("That password isn’t right.");
    case "flood": return t("Too many tries: Telegram asks you to wait a while.");
    case "signUp": return t("This number has no Telegram account yet. Create it in the Telegram app first.");
    case "other": return t("Something went wrong. Try again.");
  }
}
