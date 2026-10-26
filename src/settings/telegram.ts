// Settings → Integrations → Telegram (experimental). Off until turned on. The user brings their own
// API id and hash (my.telegram.org, free), then signs in with the phone number, the code Telegram
// sends and, if set, the cloud password. The hash and the session go to the credential store
// through Rust, which never hands them back; the page only learns whether they exist.

import { Bridge, onEvent } from "../core/bridge";
import { TELEGRAM_BLUE, linkColor, linkLabel, loginErrorLabel, type TgLoginError, type TgSettingsView } from "../core/telegram";
import { h } from "../views/dom";
import { t } from "../i18n/i18n";

type Toggle = (on: boolean, onChange: (v: boolean) => void) => HTMLElement;

export interface TelegramSettingsHost {
  toggle: Toggle;
  /** Whether the Telegram pill is among the active ones. */
  pillActive(): boolean;
  /** Turns the pill on (when a slot is free) or off, and saves. */
  setPill(on: boolean): void;
  /** How many pills may be active. */
  maxPills: number;
}

const COL = "display:flex;flex-direction:column;gap:10px";
const FIELD = "flex:1 1 auto;min-width:0";

export function telegramSection(host: TelegramSettingsHost): HTMLElement {
  let view: TgSettingsView | null = null;
  let busy = false;
  let apiFilled = false;
  /** A problem from a step the user just took (the report's own `login.error` is the other source). */
  let localError: TgLoginError | null = null;

  const enableSwitch = host.toggle(false, (on) => void setEnabled(on));
  const muteSwitch = host.toggle(true, (on) => void setOptions({ muteGroups: on }));
  const readSwitch = host.toggle(true, (on) => void setOptions({ markReadOnOpen: on }));
  const body = h("div", { style: COL });
  const dynamic = h("div", { style: COL });
  const ignoredList = h("div", { style: "display:flex;flex-direction:column;gap:4px" });

  const apiIdInput = h("input", { type: "text", inputmode: "numeric", placeholder: "12345678", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;
  const apiHashInput = h("input", { type: "password", placeholder: "0123456789abcdef…", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;
  const phoneInput = h("input", { type: "tel", placeholder: "+7 900 000 00 00", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;
  const codeInput = h("input", { type: "text", inputmode: "numeric", placeholder: "12345", autocomplete: "off", spellcheck: "false", style: "width:110px" }) as HTMLInputElement;
  const passwordInput = h("input", { type: "password", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;

  const switchState = (el: HTMLElement, on: boolean) => {
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", String(on));
  };

  async function setOptions(change: Partial<{ enabled: boolean; muteGroups: boolean; markReadOnOpen: boolean }>) {
    const p = view?.prefs;
    if (!p) return;
    const next = { enabled: p.enabled, muteGroups: p.muteGroups, markReadOnOpen: p.markReadOnOpen, ...change };
    try {
      await Bridge.telegramSetOptions(next.enabled, next.muteGroups, next.markReadOnOpen);
    } catch {
      // The next report puts the switches back as they are.
    }
  }

  async function setEnabled(on: boolean) {
    await setOptions({ enabled: on });
    host.setPill(on);
    draw();
  }

  /** Runs one step of the sign-in: the button is busy meanwhile, a refusal becomes a message. */
  async function step(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    localError = null;
    draw();
    try {
      await action();
    } catch (err) {
      const code = String(err).replace(/^Error:\s*/, "");
      localError = (["badPhone", "badApi", "invalidCode", "invalidPassword", "flood", "signUp"] as string[]).includes(code)
        ? (code as TgLoginError)
        : "other";
    }
    busy = false;
    draw();
  }

  const saveApi = () => step(() => Bridge.telegramSaveApi(apiIdInput.value, apiHashInput.value).then(() => {
    apiHashInput.value = "";
  }));
  const sendCode = () => step(() => Bridge.telegramRequestCode(phoneInput.value));
  const sendLoginCode = () => step(() => Bridge.telegramSubmitCode(codeInput.value).then(() => {
    codeInput.value = "";
  }));
  const sendPassword = () => step(() => Bridge.telegramSubmitPassword(passwordInput.value).then(() => {
    passwordInput.value = "";
  }));

  const enter = (input: HTMLInputElement, fn: () => void) => input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fn();
  });
  enter(apiHashInput, () => void saveApi());
  enter(phoneInput, () => void sendCode());
  enter(codeInput, () => void sendLoginCode());
  enter(passwordInput, () => void sendPassword());

  const btn = (text: string, fn: () => void, primary = true) =>
    h("button", { class: primary ? "primary" : "", text, disabled: busy, onclick: fn });

  function apiBlock(v: TgSettingsView): HTMLElement[] {
    if (!apiFilled && v.apiId) {
      apiIdInput.value = v.apiId;
      apiFilled = true;
    }
    const ready = v.apiId != null && v.hasApiHash;
    return [
      h("div", { class: "hint", text: t("Telegram needs your own API id and hash (free): sign in at my.telegram.org, open “API development tools” and create an app. Tobi keeps them in the system’s credential store.") }),
      h("div", { class: "row" }, h("label", { text: t("API id") }), apiIdInput),
      h("div", { class: "row" }, h("label", { text: t("API hash") }), apiHashInput),
      h("div", { class: "row" },
        btn(ready ? t("Save again") : t("Save"), () => void saveApi()),
        ready ? h("span", { class: "hint", style: `color:${TELEGRAM_BLUE}`, text: t("Saved") }) : h("span", {}),
      ),
    ];
  }

  function loginBlock(v: TgSettingsView): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (v.login.stage === "password") {
      out.push(
        h("div", { class: "hint", text: v.login.hint ? t("Your Telegram has a cloud password (hint: {hint}).", { hint: v.login.hint }) : t("Your Telegram has a cloud password.") }),
        h("div", { class: "row" }, h("label", { text: t("Password") }), passwordInput, btn(t("Sign in"), () => void sendPassword())),
      );
    } else if (v.login.stage === "code") {
      out.push(
        h("div", { class: "hint", text: t("Telegram sent a code to your Telegram app (or by SMS). Enter it here.") }),
        h("div", { class: "row" }, h("label", { text: t("Code") }), codeInput, btn(t("Confirm"), () => void sendLoginCode())),
      );
    } else {
      out.push(
        h("div", { class: "row" }, h("label", { text: t("Phone number") }), phoneInput, btn(t("Send code"), () => void sendCode())),
        h("div", { class: "hint", text: t("International form, with the +. The code goes to your Telegram app, as when you sign in on a new device.") }),
      );
    }
    return out;
  }

  function statusRow(v: TgSettingsView): HTMLElement {
    const text = v.link.state === "connected" && v.me ? t("Connected as {name}", { name: v.me }) : linkLabel(v.link);
    return h("div", { class: "row", style: "gap:8px" },
      h("i", { class: "dot", style: `background:${linkColor(v.link)}` }),
      h("span", { style: "font-size:12.5px", text }),
    );
  }

  function draw() {
    const v = view;
    if (!v) return;
    switchState(enableSwitch, v.prefs.enabled);
    switchState(muteSwitch, v.prefs.muteGroups);
    switchState(readSwitch, v.prefs.markReadOnOpen);
    body.style.display = v.prefs.enabled ? "" : "none";

    const parts: HTMLElement[] = [];
    if (v.prefs.enabled && !host.pillActive()) {
      parts.push(h("div", { class: "hint", style: "color:#F4505E", text: t("Turn off another pill to make room for Telegram ({max} at most).", { max: host.maxPills }) }));
    }
    parts.push(statusRow(v));
    const ready = v.apiId != null && v.hasApiHash;
    if (v.link.state === "connected") {
      parts.push(h("div", { class: "row" }, h("button", { class: "danger", text: t("Sign out of Telegram"), onclick: () => void Bridge.telegramSignOut() })));
    } else {
      if (!ready || v.link.state === "needsSetup") parts.push(...apiBlock(v));
      else if (v.link.state === "needsLogin" || v.login.stage !== "none") parts.push(...loginBlock(v));
      else parts.push(h("div", { class: "row" }, h("button", { text: t("Change API id and hash"), onclick: () => { apiFilled = false; view = { ...v, hasApiHash: false }; draw(); } })));
    }
    const problem = localError ?? v.login.error;
    if (problem) parts.push(h("div", { class: "notice err", text: loginErrorLabel(problem) }));
    dynamic.replaceChildren(...parts);

    ignoredList.replaceChildren(...v.ignored.map((chat) => h("div", { class: "row", style: "gap:8px" },
      h("span", { style: "font-size:12.5px", text: chat.name }),
      h("span", { class: "spacer" }),
      h("button", { text: t("Remove"), onclick: () => void Bridge.telegramUnignore(chat.id) }),
    )));
  }

  body.append(
    dynamic,
    h("div", { class: "row" }, h("label", { text: t("Mute groups (unless I’m mentioned)") }), muteSwitch),
    h("div", { class: "row" }, h("label", { text: t("Mark as read when I open a conversation") }), readSwitch),
    h("div", { class: "hint", text: t("Off: marked read only when you reply. Never when a message just arrives.") }),
    h("div", { class: "subhead", text: t("Ignored chats") }),
    ignoredList,
    h("div", { class: "hint", text: t("Right-click a chat in the island to ignore it. Tobi talks to Telegram directly, like its own apps. Messages stay in memory, are never logged or saved, and are forgotten when Tobi quits. No photo or media is ever downloaded.") }),
  );

  const section = h(
    "section",
    {},
    h("h2", {}, h("i", { class: "dot", style: `background:${TELEGRAM_BLUE}` }), h("span", { text: t("Telegram (experimental)") })),
    h("div", { class: "hint", style: "color:#F5B83D", text: t("Your own Telegram account, through your own API id. Use it with care: signing in on a new device makes Telegram send a security notice to your other devices.") }),
    h("div", { class: "row" }, h("label", { text: t("Show my Telegram messages") }), enableSwitch),
    body,
  );
  body.style.display = "none";

  const apply = (v: TgSettingsView | null) => {
    if (!v) return;
    view = v;
    draw();
  };
  void Bridge.telegramSettings().then(apply);
  let off: (() => void) | null = null;
  void onEvent<TgSettingsView>("telegram-settings", (v) => {
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
