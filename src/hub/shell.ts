// The Tobi window: a sidebar of pages in three groups (Tobi himself and his
// agents, voice, settings) and the page on the right, under its own title.

import "./hub.css";
import { h, clear } from "../views/dom";
import { t } from "../i18n/i18n";
import { onEvent } from "../core/bridge";
import { FlowBridge, type FlowPrefs, type FlowStatus, type ModelsStatus } from "../core/flow";
import { hero, liveTobi, setWindowShown } from "./hero";
import { icon, keyLabel } from "./ui";
import { greeting } from "./pages/home";

export type PageId =
  | "home" | "tobi" | "wardrobe" | "dictation" | "notes" | "dictionary" | "snippets" | "styles" | "flowsettings"
  | "general" | "pills" | "agents" | "chat" | "voice" | "integrations" | "phone" | "shortcuts";

/** One page of the sidebar. */
interface Item {
  id: PageId;
  icon: string;
  title: () => string;
  /** The line under the title (Flow pages draw it for themselves). */
  subtitle?: () => string;
  /** More pages drawn under it, each under its own smaller title. */
  parts?: PageId[];
  /** Pages of the island's settings drawn into this one (renderNotch draws them together). */
  holds?: PageId[];
}

/** A group of the sidebar, under its small label. */
interface Section {
  id: string;
  title: () => string;
  items: Item[];
}

export const SECTIONS: Section[] = [
  {
    id: "tobi", title: () => "Tobi",
    items: [
      { id: "home", icon: "home", title: () => t("Home") },
      { id: "tobi", icon: "bot", title: () => "Tobi", subtitle: () => t("His name, his colours and what he wears."), holds: ["wardrobe"] },
      { id: "agents", icon: "terminal", title: () => t("Agents"), subtitle: () => t("Claude Code, Codex and the other agents Tobi follows, and your Android phone."), holds: ["phone"] },
      { id: "integrations", icon: "puzzle", title: () => t("Integrations"), subtitle: () => t("Services in the island and the AI of its chat."), holds: ["chat"] },
    ],
  },
  {
    id: "voice", title: () => t("Voice"),
    items: [
      { id: "dictation", icon: "mic", title: () => t("Dictation"), parts: ["voice", "flowsettings"] },
      { id: "notes", icon: "record", title: () => t("Notetaker") },
      { id: "dictionary", icon: "book", title: () => t("Dictionary"), parts: ["snippets", "styles"] },
    ],
  },
  {
    id: "settings", title: () => t("Settings"),
    items: [
      { id: "general", icon: "sliders", title: () => t("General"), subtitle: () => t("Tobi, his sounds, how the island behaves and its keys."), holds: ["shortcuts"] },
      { id: "pills", icon: "grid", title: () => t("Active pills"), subtitle: () => t("The pills shown in the island, their order and their colours.") },
    ],
  },
];

/** The title of a page drawn as a part of another. */
const PART_TITLES: Partial<Record<PageId, () => string>> = {
  voice: () => "OK Tobi",
  flowsettings: () => t("Settings"),
  snippets: () => t("Snippets"),
  styles: () => t("Styles"),
};

const ITEMS: Item[] = SECTIONS.flatMap((s) => s.items);

/** The sidebar page that shows `page`, itself or as one of its parts. */
const itemOf = (page: PageId) =>
  ITEMS.find((x) => x.id === page || x.parts?.includes(page) || x.holds?.includes(page)) ?? ITEMS[0];

/** What a page gets to draw itself and reach the rest of the window. */
export interface HubContext {
  status: FlowStatus;
  navigate(page: PageId): void;
  /** Reads the status again (prefs, models) and redraws the sidebar's line. */
  refresh(): Promise<FlowStatus>;
  /** Saves new preferences and keeps them as the window's. */
  setPrefs(change: (p: FlowPrefs) => void): Promise<void>;
  /** The head of a page: the sidebar's name for it, a line and its actions. */
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
  let current: PageId = "home";
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
    // A page is called what the sidebar calls it; a part of a page gets a smaller title of its own.
    hero: (page, _title, subtitle, actions = []) => {
      const part = PART_TITLES[page];
      if (part && itemOf(page).id !== page) {
        const el = hero(page, part(), subtitle, actions);
        el.classList.add("sub");
        return el;
      }
      return hero(page, itemOf(page).title(), subtitle, actions);
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
    const def = itemOf(page);
    ctx.onLeave?.();
    ctx.onLeave = undefined;
    current = def.id;
    // The window lives for days: his hello follows the time of day.
    hello.textContent = greeting(null);
    for (const [id, el] of items) el.classList.toggle("on", id === def.id);
    const token = ++rendering;
    const page_ = h("div", { class: "hub-page" });
    const leaves: (() => void)[] = [];
    let target: HTMLElement | null = null;
    for (const part of [def.id, ...(def.parts ?? [])]) {
      const box = h("div", { class: "hub-part" });
      page_.append(box);
      if (part === page) target = box;
      const renderer = opts.flowPages[part];
      if (renderer) {
        ctx.onLeave = undefined;
        await renderer(box, ctx);
        if (ctx.onLeave) leaves.push(ctx.onLeave);
      } else {
        box.append(hero(part, def.title(), def.subtitle?.() ?? null));
        const container = h("div", { id: "settings-root" });
        box.append(container);
        await opts.renderNotch(part, container);
      }
      if (token !== rendering) return;
    }
    ctx.onLeave = leaves.length ? () => leaves.forEach((leave) => leave()) : undefined;
    clear(scroll);
    scroll.append(page_);
    scroll.scrollTop = 0;
    if (target && target !== page_.firstElementChild) target.scrollIntoView({ block: "start" });
  }

  // ── The sidebar ──
  const side = h("nav", { class: "hub-side" });
  // Tobi himself at the top, saying hello in a bubble with his name on it.
  const logo = h("canvas", {});
  const brandName = h("b", { text: "Tobi" });
  const hello = h("span", { text: greeting(null) });
  side.append(h("div", { class: "hub-brand" },
    h("span", { class: "me" }, logo),
    h("div", { class: "say" }, brandName, hello),
  ));
  liveTobi(logo as HTMLCanvasElement);
  for (const section of SECTIONS) {
    side.append(h("div", { class: "hub-group", text: section.title() }));
    for (const item of section.items) {
      const b = h("button", { class: "hub-item", onclick: () => void show(item.id) });
      b.append(icon(item.icon), h("span", { text: item.title() }));
      items.set(item.id, b);
      side.append(b);
    }
  }
  side.append(h("div", { class: "spacer" }), h("div", { class: "hub-foot" }, statusLine,
    opts.version ? h("span", { class: "hub-ver", text: `v${opts.version}` }) : null));

  clear(root);
  root.append(side, h("main", { class: "hub-panel" }, scroll));
  drawStatus();
  await show(current);

  void onEvent<string>("hub-page", (page) => {
    const id = (page === "settings" ? "general" : page) as PageId;
    if (ITEMS.some((x) => x.id === id || x.parts?.includes(id) || x.holds?.includes(id))) void show(id);
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
    /** The name he was given (Tobi → Tobi), in the sidebar. */
    setName: (name: string) => void (brandName.textContent = name),
    current: () => current,
  };
}
