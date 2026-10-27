// The island's side of the code window: what it tells the window about a session, when the user
// opens it from a diff, and the fresh snapshots while it stays open. The files themselves are
// never read here: the window asks Rust, which keeps to the session's folder.

import { Bridge, onEvent, type CodeFileRef, type CodeSession } from "../core/bridge";
import { addedRuns } from "../core/code";
import { parseDiffStep } from "../core/diff";
import { State, type AgentTask } from "../core/state";
import { agentName } from "../recap/summary";

/** The session whose snapshots the open window follows; null when it is closed. */
let following: string | null = null;
let timer: number | null = null;

export function buildCodeSession(task: AgentTask, active = ""): CodeSession {
  // One entry per file, in the order of the agent's latest touch of it.
  const files = new Map<string, CodeFileRef>();
  for (const diff of State.sessionDiffs.get(task.id) ?? []) {
    const prev = files.get(diff.path);
    files.delete(diff.path);
    files.set(diff.path, {
      path: diff.path,
      added: (prev?.added ?? 0) + diff.added,
      removed: (prev?.removed ?? 0) + diff.removed,
      runs: [...(prev?.runs ?? []), ...(diff.tooLarge ? [] : addedRuns(diff.hunks))],
    });
  }
  return {
    pillId: task.id,
    name: task.name,
    agent: agentName(task.id),
    color: task.color,
    state: task.state,
    root: task.sessionCwd ?? "",
    // A diff step is stored encoded; the window shows it as the ticker does: the file and its counts.
    steps: task.steps.map((step) => {
      const d = parseDiffStep(step);
      return d ? `${d.filename}  +${d.added} −${d.removed}` : step;
    }),
    stepIndex: task.stepIndex,
    files: [...files.values()],
    active,
  };
}

/** Opens the window on `path` (a file of the session's diffs). */
export function openCodeWindow(pillId: string, path: string) {
  const task = State.tasks.find((t) => t.id === pillId);
  if (!task) return;
  following = pillId;
  void Bridge.openCodeWindow(buildCodeSession(task, path));
}

function push() {
  timer = null;
  const task = following ? State.tasks.find((t) => t.id === following) : null;
  if (task) void Bridge.updateCodeWindow(buildCodeSession(task));
}

export function registerCodeLink() {
  // A new step or edit while the window is open: at most four snapshots a second.
  State.subscribe(() => {
    if (following && timer == null) timer = window.setTimeout(push, 250);
  });
  void onEvent<CodeSession | null>("code-session", (s) => {
    following = s?.pillId ?? null;
  });
}
