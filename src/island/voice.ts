// « OK Tobi » asks the island what only it knows (src-tauri/src/voice): the
// pills, to add, remove or pick the main one, and the user's own data for
// Claude to answer from. Port of the Mac's VoiceTools pills and service_info.

import { invoke } from "@tauri-apps/api/core";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { FlowBridge } from "../core/flow";
import { MAX_DECLARED, availablePills, chooseMainPill, pillDefinition, sanitizeDeclared, toggleDeclared } from "../core/pills";
import { Spotify } from "../core/spotify";
import { State } from "../core/state";
import { serviceCards } from "./phone-services";

interface Ask {
  id: number;
  kind: "pills" | "info";
  input: { action?: string; names?: string[] };
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The pill a spoken name means: exact, then the start, then anywhere in it. */
export function findPill(name: string): string | null {
  const wanted = norm(name);
  if (!wanted) return null;
  const pills = availablePills(State.os).filter((p) => p.support !== "soon");
  const hit =
    pills.find((p) => norm(p.name) === wanted || norm(p.id.replace(/^(integration|agent)_/, "")) === wanted) ??
    pills.find((p) => norm(p.name).startsWith(wanted)) ??
    pills.find((p) => norm(p.name).includes(wanted) || wanted.includes(norm(p.name)));
  return hit?.id ?? null;
}

function describe(): string {
  const d = sanitizeDeclared(State.settings, State.os);
  const name = (id: string) => pillDefinition(id)?.name ?? id;
  const all = availablePills(State.os).filter((p) => p.support !== "soon").map((p) => p.name);
  return JSON.stringify({
    main: name(d.mainPill),
    shown: d.activeIntegrations.map(name),
    maxBesidesMain: MAX_DECLARED,
    available: all,
  });
}

function pills(input: Ask["input"]): string {
  const action = input.action ?? "list";
  if (action === "list") return describe();
  const names = input.names ?? [];
  const done: string[] = [];
  const failed: string[] = [];
  for (const spoken of names) {
    const id = findPill(spoken);
    if (!id) {
      failed.push(`${spoken}: unknown pill`);
      continue;
    }
    const d = sanitizeDeclared(State.settings, State.os);
    const label = pillDefinition(id)?.name ?? id;
    if (action === "set_main") {
      const next = chooseMainPill(d, id, State.os);
      if (!next) {
        failed.push(`${label}: cannot be the main pill (only workspace tools can)`);
        continue;
      }
      State.settings.mainPill = next.mainPill;
      State.settings.activeIntegrations = next.activeIntegrations;
      done.push(label);
      continue;
    }
    const shown = id === d.mainPill || d.activeIntegrations.includes(id);
    if ((action === "add" && shown) || (action === "remove" && !shown)) {
      done.push(label);
      continue;
    }
    const next = toggleDeclared(d, id, State.os);
    if (!next) {
      failed.push(action === "add" ? `${label}: already ${MAX_DECLARED} pills, remove one first` : `${label}: the main pill cannot be removed`);
      continue;
    }
    State.settings.activeIntegrations = next;
    done.push(label);
  }
  if (done.length) {
    const previousMain = State.mainPillId;
    State.loadIntegrationTasks();
    if (State.mainPillId !== previousMain) State.setFocus(State.mainPillId);
    void Bridge.saveSettings(State.settings);
  }
  return JSON.stringify({ done, failed, now: JSON.parse(describe()) });
}

function info(): string {
  const sessions = State.tasks
    .filter((t) => !t.isIntegration || t.state !== "idle" || t.steps.length > 0)
    .map((t) => ({ pill: t.name, state: t.state, doing: t.steps[t.stepIndex] ?? t.steps[t.steps.length - 1] ?? null }));
  const plan = (p: typeof State.planUsage) =>
    p && {
      fiveHourPercent: p.fiveHour?.usedPct ?? null,
      weekPercent: p.sevenDay?.usedPct ?? null,
    };
  const s = Spotify.state;
  return JSON.stringify({
    pills: JSON.parse(describe()),
    sessions,
    claudePlan: plan(State.planUsage),
    codexPlan: plan(State.codexPlanUsage),
    spotify: s.running && s.track ? { playing: s.playing, title: s.track.title, artist: s.track.artist } : null,
    services: serviceCards().map((c) => ({ service: c.title, headline: c.headline, about: c.reason, items: c.items })),
  });
}

// ── « OK Tobi » speaks ──

interface Say {
  id: number;
  text: string;
  lang: string | null;
  /** ElevenLabs' MP3, base64. */
  audio: string | null;
  gender: "female" | "male";
}

/** The system's voice in the answer's language, a woman's or a man's when the system says. */
function systemVoice(lang: string | null, gender: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const want = (lang ?? navigator.language).toLowerCase();
  const short = want.split("-")[0];
  const inLang = voices.filter((v) => v.lang.toLowerCase() === want).concat(voices.filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === short && v.lang.toLowerCase() !== want));
  const female = /(female|woman|zira|hortense|julie|denise|aria|jenny|samantha|amelie|eloise)/i;
  const male = /(male|man\b|david|paul|guy|henri|claude|mark|thomas)/i;
  const pick = inLang.find((v) => (gender === "male" ? male.test(v.name) && !female.test(v.name) : female.test(v.name)));
  return pick ?? inLang[0] ?? null;
}

async function sayWithSystem(text: string, lang: string | null, gender: string): Promise<void> {
  const synth = window.speechSynthesis;
  if (synth && synth.getVoices().length === 0) {
    await new Promise<void>((r) => {
      synth.addEventListener("voiceschanged", () => r(), { once: true });
      setTimeout(r, 600);
    });
  }
  if (synth && synth.getVoices().length > 0) {
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = systemVoice(lang, gender);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? lang ?? navigator.language;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.cancel();
      synth.speak(u);
    });
    return;
  }
  await FlowBridge.sayNative(text, lang);
}

async function sayMp3(base64: string): Promise<boolean> {
  try {
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
    });
    return true;
  } catch {
    return false;
  }
}

async function say(s: Say) {
  try {
    if (!(s.audio && (await sayMp3(s.audio)))) await sayWithSystem(s.text, s.lang, s.gender);
  } finally {
    void FlowBridge.voiceDone(s.id);
  }
}

export function registerVoiceHandlers() {
  if (!IS_TAURI) return;
  void onEvent<Say>("voice-say", (s) => void say(s));
  void onEvent<Ask>("voice-ask", (ask) => {
    let text: string;
    try {
      text = ask.kind === "pills" ? pills(ask.input ?? {}) : info();
    } catch (err) {
      text = `error: ${String(err)}`;
    }
    void invoke("voice_done", { id: ask.id, text }).catch(() => {});
  });
}
