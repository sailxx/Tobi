// The Tobi window: a short sidebar (voice: dictation, the Notetaker, words; agents,
// chat and settings, the island's among them) and the page on the right. A
// page with several parts shows them as tabs.

import "./hub.css";
import { h, clear } from "../views/dom";
import { t } from "../i18n/i18n";
import { onEvent } from "../core/bridge";
import { FlowBridge, type FlowPrefs, type FlowStatus, type ModelsStatus } from "../core/flow";
import { hero, liveTobi, setWindowShown } from "./hero";
import { icon, keyLabel } from "./ui";

export type PageId =
  | "dictation" | "notes" | "dictionary" | "snippets" | "styles" | "flowsettings"
  | "general" | "pills" | "agents" | "chat" | "voice" | "integrations" | "phone" | "shortcuts";

interface Tab {
  id: PageId;
  title: () => string;
  /** The line under the title (Notch pages draw it for themselves). */
  subtitle?: () => string;
}

/** One entry of the sidebar: a page, or several pages as tabs. */
interface Section {
  id: string;
  icon: string;
  title: () => string;
  tabs: Tab[];
}

export const SECTIONS: Section[] = [
  {
    id: "voice", icon: "mic", title: () => t("Voice"),
    tabs: [
      { id: "dictation", title: () => t("Dictation") },
      { id: "notes", title: () => t("Notetaker") },
      { id: "dictionary", title: () => t("Dictionary") },
      { id: "snippets", title: () => t("Snippets") },
      { id: "styles", title: () => t("Styles") },
    ],
  },
  {
    id: "agents", icon: "terminal", title: () => t("Agents"),
    tabs: [
      { id: "agents", title: () => t("Agents"), subtitle: () => t("Claude Code, Codex and the other agents Tobi follows.") },
      { id: "integrations", title: () => t("Integrations"), subtitle: () => t("Stripe, GitHub, Vercel, n8n, Notion and the rest.") },
      { id: "phone", title: () => t("Android phone"), subtitle: () => t("Your agents and their approvals on your Android phone, over your Wi-Fi.") },
    ],
  },
  {
    id: "assistant", icon: "chat", title: () => t("Chat"),
    tabs: [
      { id: "chat", title: () => t("Chat"), subtitle: () => t("The AI of the island's chat, with your own keys.") },
      { id: "voice", title: () => "OK Tobi" },
    ],
  },
  {
    id: "settings", icon: "sliders", title: () => t("Settings"),
    tabs: [
      { id: "general", title: () => t("General"), subtitle: () => t("Tobi, his sounds and how the island behaves.") },
      { id: "pills", title: () => t("Active pills"), subtitle: () => t("The pills shown in the island, their order and their colours.") },
      { id: "shortcuts", title: () => t("Shortcuts"), subtitle: () => t("The keys that open the island and its actions.") },
      { id: "flowsettings", title: () => t("Dictation") },
    ],
  },
];

const sectionOf = (page: PageId) => SECTIONS.find((s) => s.tabs.some((x) => x.id === page)) ?? SECTIONS[0];

/** What a page gets to draw itself and reach the rest of the window. */
export interface HubContext {
  status: FlowStatus;
  navigate(page: PageId): void;
  /** Reads the status again (prefs, models) and redraws the sidebar's line. */
  refresh(): Promise<FlowStatus>;
  /** Saves new preferences and keeps them as the window's. */
  setPrefs(change: (p: FlowPrefs) => void): Promise<void>;
  /** The band of a page, its Tobis walking. */
  hero(page: PageId, title: string, subtitle: string | null, actions?: HTMLElement[]): HTMLElement;
  /** Set by a page: called when the page is left. */
  onLeave?: () => void;
}

export type FlowPageRenderer = (container: HTMLElement, ctx: HubContext) => void | Promise<void>;

export interface HubOptions {
  version: string;
  flowPages: Partial<Record<PageId, FlowPageRenderer>>;
  /** Draws the island's settings for one of the Notch pages into `container`. */
  renderNotch(page: PageId, container: HTMLElement): Promise<void>;
}

const DEFAULT_STATUS: FlowStatus = {
  prefs: {
    enabled: false, key: "right_ctrl", mic: "", keepDays: 30, cleanup: false,
    defaultStyle: "natural", summaryEngine: "claude", openAtLaunch: true, voice: false, voiceOutput: "system", voiceGender: "female",
  },
  models: { parakeet: { state: "missing" }, downloadMb: 700 },
  keys: "ok",
  hasClaudeKey: false,
  mics: [],
  platform: navigator.userAgent.includes("Windows") ? "windows" : /Macintosh|Mac OS X/.test(navigator.userAgent) ? "macos" : "linux",
  autostarted: false,
};

export async function startHub(root: HTMLElement, opts: HubOptions) {
  document.body.classList.add("hub-window");
  // The window is created hidden and only shown and hidden afterwards: its
  // canvases animate only while it is on screen (#792).
  await onEvent<boolean>("hub-visible", setWindowShown);
  const shown = await FlowBridge.hubShown();
  if (shown !== null) setWindowShown(shown);
  let current: PageId = "dictation";
  let status: FlowStatus = (await FlowBridge.status()) ?? DEFAULT_STATUS;
  const items = new Map<string, HTMLElement>();
  const statusLine = h("div", { class: "hub-status" });
  const scroll = h("div", { class: "hub-scroll" });
  let rendering = 0;

  const ctx: HubContext = {
    get status() {
      return status;
    },
    navigate: (page) => void show(page),
    refresh: async () => {
      status = (await FlowBridge.status()) ?? status;
      drawStatus();
      return status;
    },
    setPrefs: async (change) => {
      const next = { ...status.prefs };
      change(next);
      status = { ...status, prefs: next };
      drawStatus();
      await FlowBridge.setPrefs(next);
    },
    hero: (page, title, subtitle, actions = []) => {
      // On a page with tabs the tab bar is the title.
      const tabbed = sectionOf(page).tabs.length > 1;
      return hero(page, tabbed ? "" : title, subtitle, actions);
    },
  };

  function drawStatus() {
    clear(statusLine);
    const models = status.models.parakeet.state;
    let color = "#6b7079";
    let text: string;
    if (!status.prefs.enabled) {
      text = t("Dictation is off");
    } else if (models !== "ready") {
      color = "#f7b32b";
      text = models === "downloading" ? t("Downloading the voice model…") : t("Download the voice model to dictate");
    } else if (status.keys !== "ok" && status.keys !== "wayland") {
      color = "#f7b32b";
      text = t("Tobi can't watch the keyboard here");
    } else {
      color = "#34d399";
      text = t("Ready · hold {0}", { 0: keyLabel(status.keys === "wayland" ? "wayland" : status.prefs.key, status.platform) });
    }
    statusLine.append(h("i", { class: "dot", style: `background:${color}` }), h("span", { text }));
  }

  async function show(page: PageId) {
    const section = sectionOf(page);
    const def = section.tabs.find((x) => x.id === page) ?? section.tabs[0];
    ctx.onLeave?.();
    ctx.onLeave = undefined;
    current = def.id;
    for (const [id, el] of items) el.classList.toggle("on", id === section.id);
    const token = ++rendering;
    const page_ = h("div", { class: "hub-page" });
    if (section.tabs.length > 1) {
      page_.append(h("div", { class: "hub-tabs" }, ...section.tabs.map((x) =>
        h("button", { class: x.id === def.id ? "on" : "", text: x.title(), onclick: () => void show(x.id) }),
      )));
    }
    const renderer = opts.flowPages[def.id];
    if (renderer) {
      await renderer(page_, ctx);
    } else {
      const sub = def.subtitle?.();
      if (sub) page_.append(h("p", { class: "hub-lead", text: sub }));
      const container = h("div", { id: "settings-root" });
      page_.append(container);
      await opts.renderNotch(def.id, container);
    }
    if (token !== rendering) return;
    clear(scroll);
    scroll.append(page_);
    scroll.scrollTop = 0;
  }

  // ── The sidebar ──
  const side = h("nav", { class: "hub-side" });
  const logo = h("canvas", {});
  side.append(h("div", { class: "hub-brand" }, logo, h("span", { text: "Tobi" })));
  liveTobi(logo as HTMLCanvasElement);
  for (const section of SECTIONS) {
    const b = h("button", { class: "hub-item", onclick: () => void show(section.tabs[0].id) });
    b.append(icon(section.icon), h("span", { text: section.title() }));
    items.set(section.id, b);
    side.append(b);
  }
  side.append(h("div", { class: "spacer" }), statusLine, h("div", { class: "hub-version", text: `Tobi ${opts.version}` }));

  clear(root);
  root.append(side, h("main", { class: "hub-panel" }, scroll));
  drawStatus();
  await show(current);

  void onEvent<string>("hub-page", (page) => {
    const id = (page === "settings" ? "general" : page) as PageId;
    if (SECTIONS.some((s) => s.tabs.some((x) => x.id === id))) void show(id);
  });
  void onEvent<FlowPrefs>("flow-prefs", (prefs) => {
    status = { ...status, prefs };
    drawStatus();
  });
  void onEvent<ModelsStatus>("speech-models", (models) => {
    status = { ...status, models };
    drawStatus();
  });
  return {
    redraw: () => void show(current),
    current: () => current,
  };
}
