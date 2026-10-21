// Dev harness: the "Claude's whole text" view with a sample answer, in a plain
// browser. Not part of the app bundle.

import "../src/style.css";
import { buildReply } from "../src/views/reply";
import { State } from "../src/core/state";

State.tasks = [{
  id: "agent_claude-desktop", name: "Claude Desktop", color: "#D97757", state: "finished",
  stepIndex: 0, steps: [], source: "agent", isIntegration: false,
  finalLine: "Готово: добавил просмотр всего текста.",
  finalText: "**Готово.** Добавил просмотр всего текста Claude.\n\n## Что изменилось\n- хук читает текст хода из транскрипта\n- карточка «Текст» открывается кликом\n- финальный ответ виден целиком\n\n```bash\nnpm test\n```\n\nПроверь в Tobi: кликни по строке в карточке сессии. ".repeat(2),
}] as never;
State.focusId = "agent_claude-desktop";

const view = buildReply({ back: () => console.log("back") });
document.getElementById("stage")!.append(view.el);
view.sync();
