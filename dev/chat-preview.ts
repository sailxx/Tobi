// Dev harness: the whole island with a Telegram chat, Tauri mocked, in a plain browser (screenshots
// of the open conversation). ?chat=0 stays on the list. Not part of the app bundle.

(window as never as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: (cb: unknown) => cb,
  invoke: async () => null,
};

const { Island } = await import("../src/island/island");
const { State, DEFAULT_SETTINGS } = await import("../src/core/state");
const { Telegram, IDLE_TELEGRAM, TELEGRAM_ID } = await import("../src/core/telegram");
await import("../src/style.css");

const now = Date.now();
const m = (id: number, fromMe: boolean, text: string, ago: number, extra = {}) => ({
  id: String(id), chat: "1", sender: fromMe ? "me" : "1", senderName: "", text, media: { kind: "none" },
  date: now - ago * 1000, fromMe, mentionsMe: false, ...extra,
});
const chat = (id: string, name: string, unread: number, messages: ReturnType<typeof m>[], isGroup = false) => ({
  id, name, isGroup, unread, messages, lastActivity: messages[messages.length - 1].date,
});

Telegram.view = {
  ...IDLE_TELEGRAM, on: true, link: { state: "connected" }, unread: 3,
  conversations: [
    chat("1", "Владислав", 2, [
      m(1, false, "Привет! Ты видел новый релиз?", 900),
      m(2, true, "Да, смотрю прямо сейчас", 860),
      m(3, false, "https://www.instagram.com/reel/DKq9xPzT_ab/?utm_source=ig_web_button_share_sheet&igsh=MzRlODBiNWFlZA%3D%3D&utm_medium=link_in_bio&fbclid=PAbZ1jCAexample", 300),
      m(4, false, "Скинь потом, как будет время, нужно понять, что делаем с обновлением и когда его выпускать, чтобы не сломать у всех остальных", 120),
      m(5, true, "Хорошо, вечером напишу подробно.", 60),
      m(6, false, "Ок, жду", 20),
    ]),
    chat("2", "Мама", 1, [m(7, false, "Ты поел?", 3600)]),
    chat("3", "Рабочий чат", 0, [m(8, false, "Созвон в 15:00", 7200, { senderName: "Анна" })], true),
    chat("4", "Дима", 0, [m(9, true, "Договорились", 86000)]),
  ],
} as never;

State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: [TELEGRAM_ID], autoCloseInterval: 3600 };
const root = document.getElementById("root")!;
const island = new Island(root);
State.loadIntegrationTasks();
State.focusId = TELEGRAM_ID;
await new Promise((r) => setTimeout(r, 4500));
island.setPointerInside(true);
island.alert("overview");
State.notify();

const open = new URLSearchParams(location.search).get("chat");
if (open !== "0") {
  await new Promise((r) => setTimeout(r, 900));
  (document.querySelector(".wa-row") as HTMLElement | null)?.click();
}
