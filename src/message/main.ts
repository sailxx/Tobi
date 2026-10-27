// The message window (message.html): one chat message whole, in a window that can be resized. The
// text is plain and selectable; Copy text and Copy photo put the whole of it on the clipboard.
// Nothing is stored: the island sends the message when it is clicked, the photo is fetched here.

import "./message.css";
import { Bridge, onEvent } from "../core/bridge";
import { TELEGRAM_ID } from "../core/telegram";
import { windowTitle, type MessageWindowData } from "../core/message-window";
import type { Settings } from "../core/state";
import { h, clear } from "../views/dom";
import { writeClipboard } from "../views/markdown";
import { copyPhoto } from "../views/photo-copy";
import { isRtl, onLanguageChange, resolveLanguage, setLanguage, systemLanguages, t, tl } from "../i18n/i18n";

const root = document.getElementById("message")!;
let data: MessageWindowData | null = null;
/** The photo of the message shown, once fetched. */
let photo: string | null = null;
let noteTimer: number | null = null;

const who = h("b", { class: "msg-who" });
const when = h("span", { class: "msg-when" });
const body = h("div", { class: "msg-body" });
const copyTextBtn = h("button", { class: "msg-btn", text: tl("Copy text") });
const copyPhotoBtn = h("button", { class: "msg-btn", text: tl("Copy photo") });
const note = h("span", { class: "msg-note" });
root.append(
  h("div", { class: "msg-head" }, who, when),
  body,
  h("div", { class: "msg-foot" }, copyTextBtn, copyPhotoBtn, note),
);

function say(text: string) {
  note.textContent = text;
  if (noteTimer != null) window.clearTimeout(noteTimer);
  noteTimer = text ? window.setTimeout(() => (note.textContent = ""), 1800) : null;
}

function show(next: MessageWindowData | null) {
  data = next;
  photo = null;
  say("");
  clear(body);
  document.title = windowTitle(next);
  if (!next) {
    who.textContent = "";
    when.textContent = "";
    copyTextBtn.style.display = "none";
    copyPhotoBtn.style.display = "none";
    return;
  }
  who.textContent = next.who;
  when.textContent = next.when;
  copyTextBtn.style.display = next.text ? "" : "none";
  copyPhotoBtn.style.display = "none";
  if (next.photo && next.messenger === TELEGRAM_ID) {
    const slot = h("div", { class: "msg-photo msg-skeleton" });
    body.append(slot);
    void Bridge.telegramMedia(next.chat, next.id).then((url) => {
      // Another message was opened meanwhile.
      if (data !== next) return;
      if (!url) {
        slot.className = "msg-photo failed";
        slot.textContent = t("The photo can’t be loaded");
        return;
      }
      photo = url;
      slot.className = "msg-photo";
      slot.replaceChildren(h("img", { class: "msg-photo-img", src: url, alt: "" }));
      copyPhotoBtn.style.display = "";
    });
  } else if (next.media) {
    body.append(h("div", { class: "msg-media", text: t(next.media) }));
  }
  if (next.text) body.append(h("div", { class: "msg-text", text: next.text }));
}

copyTextBtn.addEventListener("click", async () => {
  if (!data?.text) return;
  await writeClipboard(data.text);
  say(t("Copied"));
});
copyPhotoBtn.addEventListener("click", async () => {
  if (!photo) return;
  say((await copyPhoto(photo)) ? t("Copied") : t("Couldn’t copy the photo"));
});
// Escape closes the window, like any dialog.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void Bridge.closeMessageWindow();
});

async function main() {
  const boot = await Bridge.boot();
  const apply = (s: Partial<Settings> | undefined) => setLanguage(resolveLanguage(s?.language ?? "", systemLanguages()));
  apply(boot?.settings);
  const dir = () => (document.documentElement.dir = isRtl() ? "rtl" : "ltr");
  dir();
  onLanguageChange(() => {
    dir();
    if (data) show(data);
  });
  void onEvent<Settings>("settings-changed", apply);
  void onEvent<MessageWindowData>("message-data", show);
  show(await Bridge.messageWindowData());
}

void main();
