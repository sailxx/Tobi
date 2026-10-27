// The Tobi window's small animations: the Tobi of the sidebar and the one
// asleep on an empty page. One loop draws every live canvas; it stops when
// none is left or the window is hidden, so a hidden window costs nothing.

import { BotEngine, hexToRGB } from "../tobi/engine";
import { onScreen, shouldAnimate } from "./frames";
import { FRAME_GAP, frameDue } from "../core/anim";
import type { BotStateName } from "../core/layout";

interface Animated {
  el: HTMLCanvasElement;
  draw(dt: number, t: number): void;
  /** Pages are built before they are put in the window: dropped only once gone. */
  shown?: boolean;
  born?: number;
}

const live = new Set<Animated>();
let frame: number | null = null;
let last = performance.now();
const start = performance.now();
/** The Tobi window is on screen, as Rust last said (`setWindowShown`). */
let windowShown = true;

function running(): boolean {
  return shouldAnimate(live.size, document.visibilityState, windowShown);
}

function loop(now: number) {
  frame = null;
  // These are only breathing and blinking: 30 a second is plenty.
  if (!frameDue(now, last, FRAME_GAP.ambient)) {
    if (running()) frame = requestAnimationFrame(loop);
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = (now - start) / 1000;
  for (const a of live) {
    if (!a.el.isConnected) {
      // Built but not shown yet: wait for it (a few seconds at most).
      if (a.shown || now - (a.born ??= now) > 5000) live.delete(a);
      continue;
    }
    a.shown = true;
    if (onScreen(a.el.getBoundingClientRect(), window.innerWidth, window.innerHeight)) a.draw(dt, t);
  }
  if (running()) frame = requestAnimationFrame(loop);
}

function wake() {
  if (frame === null && running()) {
    last = performance.now();
    frame = requestAnimationFrame(loop);
  }
}

document.addEventListener("visibilitychange", wake);

/** The window was shown or hidden (the `hub-visible` event): hidden, the loop
 *  stops at once; shown, it starts again. */
export function setWindowShown(shown: boolean) {
  windowShown = shown;
  if (!shown && frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  wake();
}

function add(a: Animated) {
  live.add(a);
  wake();
}

function fit(canvas: HTMLCanvasElement): { w: number; h: number; ctx: CanvasRenderingContext2D | null } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, ctx };
}

/** One Tobi alone (the sidebar's logo, an empty page). */
export function liveTobi(canvas: HTMLCanvasElement, color = "#F5F6F8", state: BotStateName = "idle") {
  const engine = new BotEngine();
  engine.bodyColor = hexToRGB(color);
  engine.setState(state, true);
  canvas.addEventListener("click", () => engine.slap());
  let mouse: { x: number; y: number } | null = null;
  window.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse = { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
  });
  add({
    el: canvas,
    draw(dt) {
      const { w, h, ctx } = fit(canvas);
      if (!ctx || w === 0) return;
      if (mouse) {
        engine.lookX = Math.max(-1, Math.min(1, mouse.x / 300));
        engine.lookY = Math.max(-1, Math.min(1, mouse.y / 300));
      }
      engine.update(dt);
      ctx.clearRect(0, 0, w, h);
      engine.draw(ctx, w, h);
    },
  });
  return engine;
}

/** A page header: its title, a line, and the actions that go with it. */
export function hero(_page: string, title: string, subtitle: string | null, actions: HTMLElement[] = []): HTMLElement {
  const el = document.createElement("header");
  el.className = "hub-head";
  const copy = document.createElement("div");
  const h1 = document.createElement("h1");
  if (title) {
    h1.textContent = title;
    copy.append(h1);
  }
  if (subtitle) {
    const p = document.createElement("p");
    p.textContent = subtitle;
    copy.append(p);
  }
  el.append(copy);
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "actions";
    row.append(...actions);
    el.append(row);
  }
  return el;
}

/** An empty page: a Tobi asleep, and a line. */
export function emptyState(text: string, state: BotStateName = "sleeping", color = "#F5F6F8"): HTMLElement {
  const el = document.createElement("div");
  el.className = "hub-empty";
  const canvas = document.createElement("canvas");
  const p = document.createElement("div");
  p.textContent = text;
  el.append(canvas, p);
  liveTobi(canvas, color, state);
  return el;
}

/** A card that asks for attention: set-up steps, a download. */
export function glowCard(_color: string, ...content: (HTMLElement | string)[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "hub-glow";
  el.append(...content);
  return el;
}
