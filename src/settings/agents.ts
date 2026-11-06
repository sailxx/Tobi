// Settings → Agents: one section for every agent other than Claude Code, all
// going through the same steps — preview the exact diff, click to confirm, and
// only then does agents.rs back the file up and write it.

import { Bridge, type AgentHookStatus } from "../core/bridge";
import { clear, h } from "../views/dom";
import { renderDiff } from "./parts";
import { t } from "../i18n/i18n";
import { createMiniStill } from "../tobi/minibots";
import { pillDefinition } from "../core/pills";

/** In the current language (src/i18n); the settings window redraws on a change. */
const TEXT = {
  get title() { return t("Agents"); },
  get intro() {
    return t("Show other coding agents in the island. Tobi adds its entries to each agent's own config: you see the exact change and where the backup goes before anything is written, and uninstalling removes only what Tobi added.");
  },
  get none() { return t("Tobi could not list the agents."); },
  get approvals() { return t("Sessions, and Allow / Deny from the island"); },
  get displayOnly() { return t("Sessions — approvals stay in the agent"); },
  get install() { return t("Install…"); },
  get reinstall() { return t("Reinstall…"); },
  get uninstall() { return t("Uninstall…"); },
  get relayMissing() { return t("The relay isn't installed yet. Restart Tobi."); },
  previewInstall: (name: string) => t("This is exactly what changes for {name}. Nothing else is touched.", { name }),
  get previewRemove() { return t("This removes Tobi's entries only. Everything else stays."); },
  backup: (to: string) => (to ? t("Backup → {path}", { path: to }) : t("No existing file — nothing to back up.")),
  get confirmInstall() { return t("Back up and write"); },
  get confirmRemove() { return t("Back up and remove"); },
  get cancel() { return t("Cancel"); },
  get back() { return t("Back"); },
  done: (backups: string, note: string) => {
    const saved = backups
      ? t("Done. Previous version saved as {paths}.", { paths: backups.split("\n").join(", ") })
      : t("Done.");
    return `${saved} ${note}`;
  },
  failed: (err: unknown) => t("Could not write: {error}", { error: errorText(err) }),
};

function errorText(err: unknown): string {
  return String(err).replace(/^Error:\s*/, "");
}

export function agentsSection(list: AgentHookStatus[] | null): HTMLElement {
  const blocks = h("div", { class: "conn-list" });
  if (!list || list.length === 0) {
    blocks.append(h("div", { class: "hint", text: TEXT.none }));
  }
  for (const status of list ?? []) blocks.append(agentBlock(status));
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: TEXT.title })),
    h("div", { class: "hint", text: TEXT.intro }),
    blocks,
  );
}

function agentBlock(initial: AgentHookStatus): HTMLElement {
  let status = initial;
  const head = h("div", { class: "conn-row" });
  const body = h("div", { class: "conn-body" });
  const block = h("div", { class: "conn" }, head, body);

  async function refresh() {
    const fresh = (await Bridge.agentHooksList())?.find((a) => a.id === status.id);
    if (fresh) status = fresh;
    draw();
  }

  function draw() {
    clear(head);
    clear(body);
    const install = h("button", {
      class: "primary",
      text: status.installed ? TEXT.reinstall : TEXT.install,
      onclick: () => void showPreview(true),
    });
    // A hook pointing at a relay that isn't there would break the agent's hooks.
    if (!status.hookReady) {
      install.disabled = true;
      install.title = TEXT.relayMissing;
    }
    const pill = pillDefinition(`agent_${status.id}`);
    head.append(
      h("span", { class: "app-tile" }, createMiniStill(`agent_${status.id}`, pill?.color ?? "#9398A1", 26)),
      h("div", { class: "app-text" },
        h("div", { class: "app-name", text: status.name }),
        h("span", { class: "app-state", text: status.approvals ? TEXT.approvals : TEXT.displayOnly }),
      ),
    );
    if (status.installed) head.append(h("span", { class: "tag ok", text: t("Connected") }));
    head.append(install);
    if (status.installed) {
      head.append(h("button", {
        class: "danger",
        text: TEXT.uninstall,
        onclick: () => void showPreview(false),
      }));
    }
    body.append(h("span", { class: "path", text: status.path }));
  }

  async function showPreview(install: boolean) {
    let plan;
    try {
      plan = await Bridge.agentHooksPreview(status.id, install);
    } catch (err) {
      // An unreadable or unexpected config stops here rather than being
      // treated as empty and written over.
      clear(body);
      body.append(
        h("div", { class: "notice err", text: errorText(err) }),
        h("div", { class: "row" }, h("button", { text: TEXT.back, onclick: draw })),
      );
      return;
    }
    clear(body);
    body.append(
      h("div", { class: "hint", text: install ? TEXT.previewInstall(status.name) : TEXT.previewRemove }),
      renderDiff(plan.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: TEXT.backup(plan.backup) })),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? TEXT.confirmInstall : TEXT.confirmRemove,
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backups = await Bridge.agentHooksApply(status.id, install, plan.fingerprint);
        clear(body);
        body.append(h("div", { class: "notice ok", text: TEXT.done(backups, install ? status.note : "") }));
        window.setTimeout(() => void refresh(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: TEXT.failed(err) }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", { text: TEXT.cancel, onclick: draw })));
  }

  draw();
  return block;
}
