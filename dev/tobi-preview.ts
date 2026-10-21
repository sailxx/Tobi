// Dev harness: every state, a few emotes, a mini and an outfit, side by side,
// to check Tobi's look in a plain browser. Not part of the app bundle.

import { BotEngine } from "../src/tobi/engine";
import type { BotEmoteName, BotStateName } from "../src/core/layout";

type Spec = { label: string; state?: BotStateName; emote?: BotEmoteName; mini?: [number, number, number]; outfit?: string; morph?: number };

const SPECS: Spec[] = [
  ...(["idle", "working", "thinking", "searching", "approval", "question", "error", "finished", "ratelimit", "sleeping", "dizzy"] as BotStateName[])
    .map((state) => ({ label: state, state })),
  { label: "love", emote: "love" }, { label: "proud", emote: "proud" }, { label: "wink", emote: "wink" },
  { label: "mini (GitHub)", mini: [0.3, 0.32, 0.38], state: "working" },
  { label: "mini (Stripe)", mini: [0.39, 0.36, 0.98] },
  { label: "outfit: santa", outfit: "santa" },
  { label: "box", morph: 1 },
];

const grid = document.getElementById("grid")!;
const items = SPECS.map((spec) => {
  const cell = document.createElement("div");
  cell.className = "cell";
  const canvas = document.createElement("canvas");
  const dpr = 2;
  canvas.width = 140 * dpr;
  canvas.height = 140 * dpr;
  cell.append(canvas, Object.assign(document.createElement("div"), { textContent: spec.label }));
  grid.append(cell);
  const e = new BotEngine();
  if (spec.mini) { e.isMini = true; e.bodyColor = spec.mini; }
  if (spec.state) e.setState(spec.state, true);
  if (spec.emote) e.setPermanentEmote(spec.emote);
  if (spec.outfit) e.setOutfit(spec.outfit as never, false);
  if (spec.morph) e.animateMorph(spec.morph, 1);
  return { e, ctx: canvas.getContext("2d")!, dpr };
});

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  for (const { e, ctx, dpr } of items) {
    e.lookX = Math.sin(t * 0.7) * 0.8;
    e.lookY = Math.cos(t * 0.5) * 0.3;
    e.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 140, 140);
    e.draw(ctx, 140, 140);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
