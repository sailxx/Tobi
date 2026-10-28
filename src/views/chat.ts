// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView /
// ModelPickerView from IslandViewContent.swift.
//
// Answers are rendered as Markdown (markdown.ts). A local model streams its
// answer: Rust sends `chat-delta` events with the text visible so far. The
// model name above the text field opens the picker: provider chips, then the
// models of the chosen provider, asked for only once it is picked.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { renderMarkdown } from "./markdown";
import { Bridge, onEvent, type ChatContext, type ModelInfo } from "../core/bridge";
import {
  activeModel, pickModel, providerDef, visibleProviders, withModel, type ProviderDef,
} from "../core/providers";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import type { ViewActions, ViewHost } from "./views";
import { N_, language, t, tl } from "../i18n/i18n";

const STRINGS = {
  placeholderFirst: N_("Ask me anything…"),
  placeholderNext: N_("Continue…"),
  send: N_("Send"),
  switchModel: N_("Switch provider or model"),
  noModel: N_("Choose a model"),
  loading: N_("Loading models…"),
  noKey: N_("No API key — add it in Settings."),
  openSettings: N_("Open Settings"),
  notInstalled: N_("Claude Code is not installed."),
  getIt: N_("Get Claude Code"),
  signInLine: N_("Sign in with your Claude account to chat on your subscription."),
  signIn: N_("Sign in"),
  waiting: N_("Waiting for the browser…"),
  via: N_("via {0}"),
  textFor: N_("Paste or type the text…"),
};

// ── Quick actions ─────────────────────────────────────────────────────────────
//
// The chips over the text field: with text typed, a click sends it with the
// action's instruction; with none, the chip stays lit and the next message
// gets it. The instruction goes to the model in English; the bubble shows the
// chip's name and the text.

export interface QuickAction {
  id: "explain" | "spell" | "translate" | "summarize";
  icon: string;
  label: string;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: "explain", icon: ICONS.bulb, label: N_("Explain") },
  { id: "spell", icon: ICONS.spell, label: N_("Check my spelling") },
  { id: "translate", icon: ICONS.globe, label: N_("Translate") },
  { id: "summarize", icon: ICONS.lines, label: N_("Summarize") },
];

/** The language's name in English ("Russian"), for the translate instruction. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? "English";
  } catch {
    return "English";
  }
}

/** What the model is asked for `text` with a quick action. */
export function quickPrompt(id: QuickAction["id"], text: string, lang: string): string {
  switch (id) {
    case "explain":
      return `Explain this simply and briefly, in the language it is written in:

${text}`;
    case "spell":
      return `Correct the spelling, grammar and punctuation of this text. Keep its language and meaning. Reply with the corrected text only:

${text}`;
    case "translate": {
      const to = languageName(lang);
      return `Translate this into ${to}; if it is already in ${to}, translate it into English. Reply with the translation only:

${text}`;
    }
    case "summarize":
      return `Summarize this in a few short points, in the language it is written in:

${text}`;
  }
}

let nextId = 1;

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  const reply = h("div", { class: "reply" });
  renderMarkdown(reply, message.content);
  return h("div", { class: "chat-row" }, reply);
}

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string): HTMLElement {
  const chip = h("div", { class: "chip" }, h("i", { class: "chip-dot" }), h("span", { text: label }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

function saveSettings() {
  void Bridge.saveSettings(State.settings);
}

// ── Model picker ──────────────────────────────────────────────────────────────

interface Picker {
  el: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/** Provider chips, then the chosen provider's models — ModelPickerView. */
function buildPicker(onChange: () => void): Picker {
  const chips = h("div", { class: "picker-chips" });
  const list = h("div", { class: "picker-list" });
  const el = h("div", { class: "picker" }, chips, h("div", { class: "picker-rule" }), list);

  /** Models already asked for, by provider; a model server is asked again each time. */
  const cache = new Map<string, ModelInfo[]>();
  let isOpen = false;
  let request = 0;

  function drawChips() {
    clear(chips);
    for (const p of visibleProviders(State.settings)) {
      const on = p.id === State.settings.chatProvider;
      const chip = h(
        "button",
        { class: on ? "picker-chip on" : "picker-chip", style: `--accent:${p.accent}` },
        h("i", { class: "picker-dot" }),
        h("span", { text: t(p.name) }),
      );
      chip.addEventListener("click", () => {
        if (p.id === State.settings.chatProvider) return;
        State.settings = { ...State.settings, chatProvider: p.id };
        saveSettings();
        Sound.play("pop");
        drawChips();
        void loadModels();
        onChange();
      });
      chips.append(chip);
    }
  }

  function status(text: string, withSettings = false) {
    clear(list);
    const line = h("div", { class: "picker-status", text });
    if (withSettings) {
      line.append(
        h("button", {
          class: "picker-link",
          text: tl(STRINGS.openSettings),
          onclick: () => void Bridge.openSettingsWindow(),
        }),
      );
    }
    list.append(line);
  }

  /** Claude (subscription): the way to get Claude Code, or to sign in, without a terminal. */
  function claudeCodeSetup(text: string, button: string, act: () => void) {
    clear(list);
    const line = h("div", { class: "picker-status", text });
    line.append(h("button", { class: "picker-link", text: button, onclick: act }));
    list.append(line);
  }

  async function loadClaudeCode(ticket: number) {
    status(t(STRINGS.loading));
    const state = await Bridge.claudeCodeStatus();
    if (ticket !== request) return;
    if (state && !state.installed) {
      claudeCodeSetup(t(STRINGS.notInstalled), t(STRINGS.getIt), () => void Bridge.openUrl("https://claude.com/claude-code"));
      return;
    }
    if (state && !state.signedIn) {
      claudeCodeSetup(t(STRINGS.signInLine), t(STRINGS.signIn), () => {
        status(t(STRINGS.waiting));
        void Bridge.claudeCodeLogin().then(() => {
          if (ticket === request) void loadModels();
        });
      });
      return;
    }
    drawModels(providerDef("claude-code"), await Bridge.chatModels("claude-code"));
  }

  function drawModels(p: ProviderDef, models: ModelInfo[]) {
    clear(list);
    const current = activeModel(State.settings);
    for (const m of models) {
      const on = m.id === current;
      const row = h(
        "button",
        { class: on ? "picker-model on" : "picker-model", style: `--accent:${p.accent}`, title: m.id },
        h("span", { class: "picker-model-name", text: m.label }),
        on ? svg(ICONS.check, 11, { stroke: 2.2 }) : null,
      );
      row.addEventListener("click", () => {
        State.settings = withModel(State.settings, p.id, m.id);
        saveSettings();
        Sound.play("blip");
        close();
      });
      list.append(row);
    }
    list.querySelector(".picker-model.on")?.scrollIntoView({ block: "nearest" });
  }

  async function loadModels() {
    const p = providerDef(State.settings.chatProvider);
    const ticket = ++request;
    if (p.id === "claude-code") {
      void loadClaudeCode(ticket);
      return;
    }
    const cached = p.urlField ? undefined : cache.get(p.id);
    if (cached) {
      drawModels(p, cached);
      return;
    }
    // Nothing is asked of a provider that has no key yet.
    if (p.key && !(await Bridge.secretPresent(p.key))) {
      if (ticket === request) status(t(STRINGS.noKey), true);
      return;
    }
    if (ticket !== request) return;
    status(t(STRINGS.loading));
    try {
      const models = await Bridge.chatModels(p.id);
      if (ticket !== request) return;
      if (!p.urlField) cache.set(p.id, models);
      const keep = pickModel(p, models.map((m) => m.id), activeModel(State.settings));
      if (keep && keep !== activeModel(State.settings)) {
        State.settings = withModel(State.settings, p.id, keep);
        saveSettings();
        onChange();
      }
      drawModels(p, models);
    } catch (err) {
      if (ticket === request) status(String(err).replace(/^Error:\s*/, ""), Boolean(p.key));
    }
  }

  function open() {
    isOpen = true;
    el.classList.add("on");
    drawChips();
    onChange();
    void loadModels();
  }

  function close() {
    isOpen = false;
    request++;
    el.classList.remove("on");
    onChange();
  }

  return {
    el,
    open,
    close,
    get isOpen() {
      return isOpen;
    },
  };
}

// ── View ──────────────────────────────────────────────────────────────────────

export function buildPrompt(onHeightChange: () => void, actions?: Pick<ViewActions, "blip">): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: t(STRINGS.placeholderFirst),
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: tl(STRINGS.send) }, svg(ICONS.arrowUp, 11));
  const bar = h("div", { class: "chat-bar" }, input, send);

  const modelDot = h("i", { class: "model-dot" });
  const modelVia = h("span", { class: "model-via" });
  const modelName = h("span", { class: "model-name" });
  const modelBtn = h(
    "button",
    { class: "model-btn", title: tl(STRINGS.switchModel) },
    modelDot,
    modelVia,
    modelName,
    svg(ICONS.chevronUpDown, 9, { stroke: 2 }),
  );
  const modelRow = h("div", { class: "model-row" }, modelBtn);

  let armed: QuickAction | null = null;
  const quickRow = h("div", { class: "quick-row" });
  const quickButtons = QUICK_ACTIONS.map((q) => {
    const b = h("button", { class: "quick", title: tl(q.label) }, svg(q.icon, 13, { stroke: 1.9 }), h("span", { text: tl(q.label) }));
    b.addEventListener("click", () => {
      if (sending) return;
      actions?.blip();
      const text = input.value.trim();
      if (text) {
        armed = q;
        void submit();
        return;
      }
      armed = armed?.id === q.id ? null : q;
      drawQuick();
      input.focus();
    });
    quickRow.append(b);
    return b;
  });

  function drawQuick() {
    QUICK_ACTIONS.forEach((q, i) => quickButtons[i].classList.toggle("on", armed?.id === q.id));
    input.placeholder = armed
      ? t(STRINGS.textFor)
      : t(State.chatHistory.length === 0 ? STRINGS.placeholderFirst : STRINGS.placeholderNext);
  }

  const body = h("div", { class: "chat-body" });
  const picker = buildPicker(() => {
    body.classList.toggle("picking", picker.isOpen);
    drawModelButton();
  });
  body.append(modelRow, chipRow, log, picker.el, quickRow, bar);

  // No card of its own: the chat sits right on the island, which lights up warm under it.
  const el = h("div", { class: "view" }, h("div", { class: "chat-card open-chat" }, body));

  let sending = false;
  let renderedCount = -1;
  // A local model answers token by token: where its text so far is shown.
  let live: HTMLElement | null = null;

  function drawModelButton() {
    const p = providerDef(State.settings.chatProvider);
    modelDot.style.background = p.accent;
    const model = activeModel(State.settings);
    modelVia.textContent = model ? t(STRINGS.via, { 0: t(p.name) }) : "";
    modelName.textContent = model || t(STRINGS.noModel);
    modelBtn.classList.toggle("open", picker.isOpen);
    modelBtn.disabled = sending;
  }

  modelBtn.addEventListener("click", () => {
    if (sending) return;
    if (picker.isOpen) picker.close();
    else picker.open();
  });

  void onEvent<string>("chat-delta", (text) => {
    if (!sending || !text) return; // nothing visible yet: the dots stay
    if (!live) {
      live = h("div", { class: "reply" });
      log.querySelector(".typing")?.parentElement?.remove();
      log.append(h("div", { class: "chat-row" }, live));
    }
    renderMarkdown(live, text);
    log.scrollTop = log.scrollHeight;
  });

  async function submit() {
    const query = input.value.trim();
    if (!query || sending) return;
    if (picker.isOpen) picker.close();
    const quick = armed;
    armed = null;
    drawQuick();
    input.value = "";
    sending = true;
    drawModelButton();
    Sound.play("send");

    const shown = quick ? `${t(quick.label)}: ${query}` : query;
    const asked = quick ? quickPrompt(quick.id, query, language()) : query;
    State.chatHistory.push({ id: nextId++, role: "user", content: shown });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const file = State.droppedFile;
    const context: ChatContext | null =
      State.chatHistory.length === 1 && file ? { kind: "file", name: file.name, path: file.path } : null;

    try {
      const reply = await Bridge.chatSend(asked, context);
      State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      State.stateOverride = null;
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      Sound.play("error");
    } finally {
      sending = false;
      live = null;
      renderedCount = -1; // the finished answer replaces the streamed one
      drawModelButton();
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (key === "Escape" && picker.isOpen) {
      e.preventDefault();
      picker.close();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });

  return {
    el,
    sync() {
      const file = State.droppedFile;
      const wantChip = file?.name ?? "";
      if (chipRow.dataset.label !== wantChip) {
        chipRow.dataset.label = wantChip;
        clear(chipRow);
        if (wantChip) chipRow.append(contextChip(wantChip));
      }

      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0);
      if (count !== renderedCount && !live) {
        renderedCount = count;
        clear(log);
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }

      // Leaving the chat folds the picker away.
      if (State.view !== "prompt" && picker.isOpen) picker.close();
      drawModelButton();

      drawQuick();
      input.disabled = sending;
      quickRow.classList.toggle("off", sending);
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
