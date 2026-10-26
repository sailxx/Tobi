// Settings → Integrations → Gmail (experimental). Off until turned on. The user brings their own
// Google OAuth client (Cloud Console, free, a "Desktop app" client), then "Sign in with Google" opens
// the browser. The secret and the refresh token go to the credential store through Rust, which never
// hands them back; the page only learns whether they exist.

import { Bridge, onEvent } from "../core/bridge";
import { GMAIL_RED, linkColor, linkLabel, signInErrorLabel, type MailSettingsView, type MailSignInError } from "../core/gmail";
import { h } from "../views/dom";
import { t } from "../i18n/i18n";

type Toggle = (on: boolean, onChange: (v: boolean) => void) => HTMLElement;

export interface GmailSettingsHost {
  toggle: Toggle;
  /** Whether the Gmail pill is among the active ones. */
  pillActive(): boolean;
  /** Turns the pill on (when a slot is free) or off, and saves. */
  setPill(on: boolean): void;
  /** How many pills may be active. */
  maxPills: number;
}

const COL = "display:flex;flex-direction:column;gap:10px";
const FIELD = "flex:1 1 auto;min-width:0";
const CONSOLE = "https://console.cloud.google.com/apis/credentials";

export function gmailSection(host: GmailSettingsHost): HTMLElement {
  let view: MailSettingsView | null = null;
  let busy = false;
  let clientFilled = false;
  let editingClient = false;
  let localError: MailSignInError | null = null;

  const enableSwitch = host.toggle(false, (on) => void setEnabled(on));
  const readSwitch = host.toggle(true, (on) => void setOptions({ markReadOnOpen: on }));
  const body = h("div", { style: COL });
  const dynamic = h("div", { style: COL });

  const idInput = h("input", { type: "text", placeholder: "123456789-abc….apps.googleusercontent.com", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;
  const secretInput = h("input", { type: "password", placeholder: "GOCSPX-…", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;

  const switchState = (el: HTMLElement, on: boolean) => {
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", String(on));
  };

  async function setOptions(change: Partial<{ enabled: boolean; markReadOnOpen: boolean }>) {
    const p = view?.prefs;
    if (!p) return;
    const next = { enabled: p.enabled, markReadOnOpen: p.markReadOnOpen, ...change };
    try {
      await Bridge.gmailSetOptions(next.enabled, next.markReadOnOpen);
    } catch {
      // The next report puts the switches back as they are.
    }
  }

  async function setEnabled(on: boolean) {
    await setOptions({ enabled: on });
    host.setPill(on);
    draw();
  }

  async function step(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    localError = null;
    draw();
    try {
      await action();
    } catch (err) {
      const code = String(err).replace(/^Error:\s*/, "");
      localError = (["badClient", "denied", "timeout", "network"] as string[]).includes(code) ? (code as MailSignInError) : "other";
    }
    busy = false;
    draw();
  }

  const saveClient = () => step(() => Bridge.gmailSaveClient(idInput.value, secretInput.value).then(() => {
    secretInput.value = "";
    editingClient = false;
  }));
  const signIn = () => step(() => Bridge.gmailSignIn());

  secretInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void saveClient();
  });

  const btn = (text: string, fn: () => void, primary = true) =>
    h("button", { class: primary ? "primary" : "", text, disabled: busy, onclick: fn });

  function clientBlock(v: MailSettingsView): HTMLElement[] {
    if (!clientFilled && v.clientId) {
      idInput.value = v.clientId;
      clientFilled = true;
    }
    const ready = v.clientId != null && v.hasSecret;
    return [
      h("div", { class: "hint", text: t("Gmail needs your own Google OAuth client (free, nothing leaves your computer except to Google):") }),
      h("ol", { class: "hint", style: "margin:0;padding-inline-start:18px;display:flex;flex-direction:column;gap:3px" },
        h("li", { text: t("In the Cloud Console, create a project and turn on the Gmail API.") }),
        h("li", { text: t("OAuth consent screen: type External, add your own address as a test user, then “Publish app” (it stays unverified, for you only) so the sign-in doesn’t expire after a week.") }),
        h("li", { text: t("Credentials → Create credentials → OAuth client ID → Desktop app. Copy the client id and secret below.") }),
      ),
      h("div", { class: "row" }, h("button", { text: t("Open the Cloud Console"), onclick: () => void Bridge.openUrl(CONSOLE) })),
      h("div", { class: "row" }, h("label", { text: t("Client id") }), idInput),
      h("div", { class: "row" }, h("label", { text: t("Client secret") }), secretInput),
      h("div", { class: "row" }, btn(ready ? t("Save again") : t("Save"), () => void saveClient())),
    ];
  }

  function statusRow(v: MailSettingsView): HTMLElement {
    const text = v.link.state === "connected" && v.account ? t("Connected as {name}", { name: v.account }) : linkLabel(v.link);
    return h("div", { class: "row", style: "gap:8px" },
      h("i", { class: "dot", style: `background:${linkColor(v.link)}` }),
      h("span", { style: "font-size:12.5px", text }),
    );
  }

  function draw() {
    const v = view;
    if (!v) return;
    switchState(enableSwitch, v.prefs.enabled);
    switchState(readSwitch, v.prefs.markReadOnOpen);
    body.style.display = v.prefs.enabled ? "" : "none";

    const parts: HTMLElement[] = [];
    if (v.prefs.enabled && !host.pillActive()) {
      parts.push(h("div", { class: "hint", style: "color:#F4505E", text: t("Turn off another pill to make room for Gmail ({max} at most).", { max: host.maxPills }) }));
    }
    parts.push(statusRow(v));
    const own = v.clientId != null && v.hasSecret;
    const ready = own || v.builtin;
    const signedIn = v.link.state === "connected" || v.link.state === "connecting" || v.link.state === "unreachable";
    if (signedIn && !editingClient) {
      parts.push(h("div", { class: "row" }, h("button", { class: "danger", text: t("Sign out of Gmail"), onclick: () => void Bridge.gmailSignOut() })));
    } else if (!ready || editingClient || (v.link.state === "needsSetup" && !v.builtin)) {
      parts.push(...clientBlock(v));
      if (v.builtin && editingClient) {
        parts.push(h("div", { class: "row" }, h("button", { text: t("Use Tobi’s Google client"), onclick: () => { editingClient = false; void Bridge.gmailForgetClient(); } })));
      }
    } else {
      parts.push(
        h("div", { class: "row" },
          btn(t("Sign in with Google"), () => void signIn()),
          h("button", { text: own ? t("Change client") : t("Use my own client"), onclick: () => { editingClient = true; draw(); } }),
        ),
        h("div", { class: "hint", text: v.link.state === "signingIn" ? t("Finish in the browser: pick your account and allow Tobi to read and send mail. Google warns that the app isn’t verified: that is your own client, choose Continue.") : t("Your browser opens Google’s page; Tobi gets the answer on this computer only.") }),
      );
    }
    const problem = localError ?? v.error;
    if (problem) parts.push(h("div", { class: "notice err", text: signInErrorLabel(problem) }));
    dynamic.replaceChildren(...parts);
  }

  body.append(
    dynamic,
    h("div", { class: "row" }, h("label", { text: t("Mark as read when I open a message") }), readSwitch),
    h("div", { class: "hint", text: t("Off: marked read only by the button. Only the text of a message is shown, never its pictures or links’ pages. Nothing is sent without your click on Send.") }),
    h("div", { class: "hint", text: t("Tobi talks to Gmail directly, every minute while this is on. Mail stays in memory, is never logged or saved, and is forgotten when Tobi quits.") }),
  );

  const section = h(
    "section",
    {},
    h("h2", {}, h("i", { class: "dot", style: `background:${GMAIL_RED}` }), h("span", { text: t("Gmail (experimental)") })),
    h("div", { class: "hint", style: "color:#F5B83D", text: t("Your own Gmail, through your own Google sign-in. Tobi may read, send, archive and delete to the bin, never delete for good.") }),
    h("div", { class: "row" }, h("label", { text: t("Show my unread Gmail") }), enableSwitch),
    body,
  );
  body.style.display = "none";

  const apply = (v: MailSettingsView | null) => {
    if (!v) return;
    view = v;
    draw();
  };
  void Bridge.gmailSettings().then(apply);
  let off: (() => void) | null = null;
  void onEvent<MailSettingsView>("gmail-settings", (v) => {
    // A section drawn again (another page, a language change) leaves this one behind.
    if (!section.isConnected && view) {
      off?.();
      return;
    }
    apply(v);
  }).then((unlisten) => {
    off = unlisten;
  });
  return section;
}
