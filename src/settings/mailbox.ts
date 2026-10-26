// Settings → Integrations → Mail (experimental): any mailbox over IMAP and SMTP with an app password.
// Off until turned on. The user picks a provider (or types their own servers), the address and an app
// password; the password goes to the credential store through Rust, which never hands it back (the
// page only learns whether one is stored).

import { Bridge, onEvent } from "../core/bridge";
import { linkColor } from "../core/gmail";
import { MAILBOX_BLUE, linkLabel, type MailboxSettingsView } from "../core/mailbox";
import { h } from "../views/dom";
import { t } from "../i18n/i18n";

type Toggle = (on: boolean, onChange: (v: boolean) => void) => HTMLElement;

export interface MailboxSettingsHost {
  toggle: Toggle;
  /** Whether the Mail pill is among the active ones. */
  pillActive(): boolean;
  /** Turns the pill on (when a slot is free) or off, and saves. */
  setPill(on: boolean): void;
  /** How many pills may be active. */
  maxPills: number;
}

const COL = "display:flex;flex-direction:column;gap:10px";
const FIELD = "flex:1 1 auto;min-width:0";

export function mailboxSection(host: MailboxSettingsHost): HTMLElement {
  let view: MailboxSettingsView | null = null;
  let busy = false;
  let filled = false;
  let error = "";

  const enableSwitch = host.toggle(false, (on) => void setEnabled(on));
  const readSwitch = host.toggle(true, (on) => void setOptions({ markReadOnOpen: on }));
  const body = h("div", { style: COL });
  const dynamic = h("div", { style: COL });

  const providerSelect = h("select", {}) as HTMLSelectElement;
  const emailInput = h("input", { type: "email", placeholder: "you@example.com", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;
  const passwordInput = h("input", { type: "password", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;
  const imapHost = h("input", { type: "text", placeholder: "imap.example.com", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;
  const imapPort = h("input", { type: "number", min: "1", max: "65535", style: "width:84px" }) as HTMLInputElement;
  const smtpHost = h("input", { type: "text", placeholder: "smtp.example.com", autocomplete: "off", spellcheck: "false", style: FIELD }) as HTMLInputElement;
  const smtpPort = h("input", { type: "number", min: "1", max: "65535", style: "width:84px" }) as HTMLInputElement;

  const switchState = (el: HTMLElement, on: boolean) => {
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", String(on));
  };

  async function setOptions(change: Partial<{ enabled: boolean; markReadOnOpen: boolean }>) {
    const p = view?.prefs;
    if (!p) return;
    const next = { enabled: p.enabled, markReadOnOpen: p.markReadOnOpen, ...change };
    try {
      await Bridge.mailboxSetOptions(next.enabled, next.markReadOnOpen);
    } catch {
      // The next report puts the switches back as they are.
    }
  }

  async function setEnabled(on: boolean) {
    await setOptions({ enabled: on });
    host.setPill(on);
    draw();
  }

  async function save() {
    if (busy) return;
    busy = true;
    error = "";
    draw();
    try {
      const pw = passwordInput.value.trim();
      await Bridge.mailboxSaveAccount({
        provider: providerSelect.value,
        email: emailInput.value,
        password: pw ? pw : null,
        imapHost: imapHost.value,
        imapPort: Number(imapPort.value) || 993,
        smtpHost: smtpHost.value,
        smtpPort: Number(smtpPort.value) || 465,
      });
      passwordInput.value = "";
    } catch {
      error = t("Check the address, the app password and the servers.");
    }
    busy = false;
    draw();
  }

  providerSelect.addEventListener("change", draw);
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void save();
  });

  function fill(v: MailboxSettingsView) {
    providerSelect.replaceChildren(
      ...v.presets.map((p) => h("option", { value: p.id, text: p.name })),
      h("option", { value: "custom", text: t("Other server…") }),
    );
    providerSelect.value = v.prefs.provider;
    emailInput.value = v.prefs.email;
    imapHost.value = v.prefs.imapHost;
    imapPort.value = String(v.prefs.imapPort);
    smtpHost.value = v.prefs.smtpHost;
    smtpPort.value = String(v.prefs.smtpPort);
    filled = true;
  }

  function accountBlock(v: MailboxSettingsView): HTMLElement[] {
    const custom = providerSelect.value === "custom";
    const preset = v.presets.find((p) => p.id === providerSelect.value);
    passwordInput.placeholder = v.hasPassword ? `••••••••  ${t("(stored)")}` : t("App password");
    const out: HTMLElement[] = [
      h("div", { class: "hint", text: t("Works with Gmail, Yandex, Mail.ru, Yahoo, iCloud and any server with IMAP. Use an app password, not your usual one: turn on two-step verification, then make one for Tobi.") }),
      h("div", { class: "row" }, h("label", { text: t("Provider") }), providerSelect),
      h("div", { class: "row" }, h("label", { text: t("Address") }), emailInput),
      h("div", { class: "row" }, h("label", { text: t("App password") }), passwordInput),
    ];
    if (preset) {
      out.push(h("div", { class: "row" }, h("button", { text: t("Make an app password"), onclick: () => void Bridge.openUrl(preset.helpUrl) })));
    }
    if (custom) {
      out.push(
        h("div", { class: "row" }, h("label", { text: t("IMAP server") }), imapHost, imapPort),
        h("div", { class: "row" }, h("label", { text: t("SMTP server") }), smtpHost, smtpPort),
        h("div", { class: "hint", text: t("IMAP over TLS (usually port 993). SMTP port 465 is TLS from the start, 587 upgrades with STARTTLS.") }),
      );
    }
    out.push(h("div", { class: "row" }, h("button", { class: "primary", text: v.hasPassword ? t("Save again") : t("Save"), disabled: busy, onclick: () => void save() })));
    return out;
  }

  function draw() {
    const v = view;
    if (!v) return;
    if (!filled) fill(v);
    switchState(enableSwitch, v.prefs.enabled);
    switchState(readSwitch, v.prefs.markReadOnOpen);
    body.style.display = v.prefs.enabled ? "" : "none";

    const parts: HTMLElement[] = [];
    if (v.prefs.enabled && !host.pillActive()) {
      parts.push(h("div", { class: "hint", style: "color:#F4505E", text: t("Turn off another pill to make room for Mail ({max} at most).", { max: host.maxPills }) }));
    }
    const text = v.link.state === "connected" && v.account ? t("Connected as {name}", { name: v.account }) : linkLabel(v.link);
    parts.push(h("div", { class: "row", style: "gap:8px" },
      h("i", { class: "dot", style: `background:${linkColor(v.link)}` }),
      h("span", { style: "font-size:12.5px", text }),
    ));
    parts.push(...accountBlock(v));
    if (v.hasPassword) {
      parts.push(h("div", { class: "row" }, h("button", { class: "danger", text: t("Forget this account"), onclick: () => { filled = false; void Bridge.mailboxSignOut(); } })));
    }
    if (error) parts.push(h("div", { class: "notice err", text: error }));
    dynamic.replaceChildren(...parts);
  }

  body.append(
    dynamic,
    h("div", { class: "row" }, h("label", { text: t("Mark as read when I open a message") }), readSwitch),
    h("div", { class: "hint", text: t("Off: marked read only by the button. Only the text of a message is shown, never its pictures or links’ pages. Nothing is sent without your click on Send.") }),
    h("div", { class: "hint", text: t("Tobi talks to your mail server directly, every minute while this is on. Mail stays in memory, is never logged or saved, and is forgotten when Tobi quits. The app password stays in the system’s credential store.") }),
  );

  const section = h(
    "section",
    {},
    h("h2", {}, h("i", { class: "dot", style: `background:${MAILBOX_BLUE}` }), h("span", { text: t("Mail (experimental)") })),
    h("div", { class: "hint", style: "color:#F5B83D", text: t("Your own mailbox, through an app password. Tobi may read, send, archive and move to the bin; it never deletes for good.") }),
    h("div", { class: "row" }, h("label", { text: t("Show my unread mail") }), enableSwitch),
    body,
  );
  body.style.display = "none";

  const apply = (v: MailboxSettingsView | null) => {
    if (!v) return;
    view = v;
    draw();
  };
  void Bridge.mailboxSettings().then(apply);
  let off: (() => void) | null = null;
  void onEvent<MailboxSettingsView>("mailbox-settings", (v) => {
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
