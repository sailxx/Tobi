// Every pill's Tobi, at pill size and enlarged, in any state: `npm run dev`, then /dev/pills-preview.html.
import { PILL_CATALOG } from "../src/core/pills";
import { createMiniBot, syncMiniBotStates, tickMiniBots } from "../src/tobi/minibots";
import type { AgentTask } from "../src/core/state";
import type { BotStateName } from "../src/core/layout";

const STATES: BotStateName[] = ["idle", "working", "thinking", "searching", "approval", "question", "error", "finished", "ratelimit", "sleeping", "dizzy"];
const q = new URLSearchParams(location.search);
let state = (q.get("state") as BotStateName) || "idle";
const tasks: AgentTask[] = [];

const grid = document.getElementById("grid")!;
for (const def of PILL_CATALOG) {
  const task: AgentTask = { id: def.id, name: def.name, color: def.color, state, stepIndex: 0, steps: [], source: def.source, isIntegration: true };
  tasks.push(task);
  const cell = document.createElement("div");
  cell.className = "cell";
  const big = document.createElement("div"); big.className = "big";
  big.append(createMiniBot(task, 24));
  const col = document.createElement("div"); col.className = "col";
  const pill = document.createElement("div"); pill.className = "pill";
  pill.style.borderColor = def.color + "40";
  pill.append(createMiniBot(task, 24));
  const lbl = document.createElement("span"); lbl.textContent = def.name; pill.append(lbl);
  col.append(pill);
  cell.append(big, col);
  grid.append(cell);
}
const bar = document.getElementById("bar")!;
for (const s of STATES) {
  const b = document.createElement("button");
  b.textContent = s;
  b.className = s === state ? "on" : "";
  b.onclick = () => { state = s; for (const t of tasks) t.state = s; syncMiniBotStates(tasks); [...bar.children].forEach((c) => c.classList.toggle("on", c === b)); };
  bar.append(b);
}
let last = performance.now();
const loop = (n: number) => { tickMiniBots(Math.min(0.05, (n - last) / 1000)); last = n; requestAnimationFrame(loop); };
requestAnimationFrame(loop);
