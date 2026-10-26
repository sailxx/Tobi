<div align="center">

<img src="assets/readme/hero-en.svg" width="100%" alt="Tobi — an AI helper for Windows 11">

<a href="https://github.com/sailxx/Tobi/releases/latest/download/Tobi-Windows-setup.exe"><img src="assets/readme/btn-windows-en.svg" height="52" alt="Download for Windows"></a>&nbsp;&nbsp;<a href="https://github.com/sailxx/Tobi/releases/latest"><img src="assets/readme/btn-new-en.svg" height="52" alt="What’s new"></a>

**Tobi is an AI helper for working on Windows 11.** Press `Ctrl+Alt+N` and he drops in from the top of your screen to show what Claude Code is doing: thinking, reading, editing files, running commands. Allow or deny an agent’s request in one click. No telemetry, no account.

</div>

<br>

<img src="assets/readme/features-en.svg" width="100%" alt="Features: agents, permissions, terminal and VS Code, GitHub, chat, character">

<details>
<summary><b>More about the features</b></summary>

### 🤖 Live agents

Claude Code, Codex, Cursor, Gemini CLI, Antigravity, Copilot CLI, OpenCode, Amp, Claude Desktop and more. Every step of a session shows in the window: what the agent reads, edits and runs. A file edit shows its name with `+N −M`, and a click opens the whole diff. When the task is done, Tobi does a happy little jump.

### ✅ Permissions and questions

A Claude Code permission request comes with **Allow / Deny / Always**. `AskUserQuestion` prompts show their choices right in the window, up to 4 questions at once. The card stays until you answer; fold it and come back with `Ctrl+Alt+A`.

### 🧑‍💻 Terminal and VS Code

`Ctrl+Alt+T` brings the session’s window to the front. One button in the diff opens the edited file in VS Code.

### 🔌 GitHub and services

Open PRs, review requests and CI status on GitHub, plus Vercel, Stripe, n8n, Notion, Resend, Cal.com and Spotify, each in its own colored pill with a little Tobi. Keys live in Windows Credential Manager.

### 💬 Chat and files

Chat with Claude, OpenAI, Gemini, DeepSeek, Qwen, Moonshot or a local model (Ollama, LM Studio) with your own key. Drop a file on the window: Tobi turns into a box, swallows it and answers questions about it.

### ✈️ Telegram and WhatsApp (experimental)

Your unread chats in the island: open one to read its last messages and reply (Enter sends, Shift+Enter starts a new line). Telegram signs in with your own account through your own API id (free, from my.telegram.org), the phone number and the code Telegram sends; WhatsApp goes through a gateway on this computer. Both are off by default, keep messages in memory only and never write them anywhere: **Settings → Integrations**.

### 🫥 Hide when idle

While Tobi has nothing to show, nothing stays at the top of the screen. `Ctrl+Alt+N` and your agents’ requests bring him out. Turn off **Settings → Hide when idle** to have him peek out when the pointer touches the top edge.

### 🎭 Character

Tobi blinks, follows your cursor, cheers, dozes off, grumbles when poked and gets dizzy if you keep going. Drag him onto the desktop, or right-click him for the wardrobe; he also dresses up for the seasons on his own. All 29 sounds are synthesized in code.

</details>

<br>

<img src="assets/readme/keys-en.svg" width="100%" alt="Keyboard shortcuts: open Tobi, chat, request, terminal, pills, sound">

<br>

<img src="assets/readme/states-en.svg" width="100%" alt="Tobi’s states: idle, thinking, working, needs you, done, asleep">

<br>

<img src="assets/readme/numbers-en.svg" width="100%" alt="By the numbers: 9 MB, no telemetry, 10+ agents, 12 languages, 29 sounds">

<details>
<summary><b>Install</b></summary>

1. Download [`Tobi-Windows-setup.exe`](https://github.com/sailxx/Tobi/releases/latest/download/Tobi-Windows-setup.exe) or [`Tobi-Windows.msi`](https://github.com/sailxx/Tobi/releases/latest/download/Tobi-Windows.msi).
2. The installer isn’t signed yet, so SmartScreen warns you: **More info → Run anyway**.
3. Open Tobi with `Ctrl+Alt+N` → **Settings → Agents** and connect Claude Code. Tobi backs up `~/.claude/settings.json` and shows the changes before writing them.
4. Windows 10 or 11. The interface is in Russian by default; switch it in **Settings → Language**.

</details>

<details>
<summary><b>Development</b></summary>

Tauri 2: Rust in `src-tauri/`, TypeScript in `src/`, the agents’ hook relay in `hook/`.

```bash
npm install
npm run tauri dev                       # run with hot reload
npm run pack                            # installers in release/
npm test                                # island tests (Node)
cargo test --release --workspace        # Rust tests
```

Needs Node 24, Rust (MSVC) and Visual Studio Build Tools with C++. A `vX.Y.Z` tag releases; CI builds the installers.

The icon is the logo in `assets/logo.png` (cut into `src-tauri/icons/`). The sounds and the README images are generated; don’t edit them by hand:

```bash
npm run sounds                                     # sounds/
cd tools/readme && npm install && node build.mjs   # assets/readme/
```

Tobi is based on the code of [Coucou for Windows](https://github.com/louis-cfm/coucou) (MIT, © Louis Raillé), see [NOTICE.md](NOTICE.md). The character, icon and sounds are his own. Golos Text and JetBrains Mono in the README images are under the SIL Open Font License 1.1.

</details>
