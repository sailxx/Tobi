// The code window: the file an agent is writing, live, with line numbers and highlighting, and an
// edit mode that saves it back to disk. The island sends a snapshot of the session (its steps and
// the files the agent changed) when the user opens it; the snapshot is kept here in memory only.
//
// Reading and writing are the one place Tobi touches the user's source files, so they are narrow:
//  - the file must lie inside the session's own folder (the `cwd` its hooks reported), by its real
//    path, so a symlink or `..` cannot leave it;
//  - secrets are never opened: `.env*`, keys, certificates, credential stores, `.ssh`, `.aws` …;
//  - only an existing, regular, UTF-8 text file under 1 MB, and never a read-only one for a save;
//  - a save carries the version the editor was shown; if the file has changed since (the agent
//    wrote again), nothing is written and the editor shows the conflict;
//  - a save is a temp file in the same folder, then a rename, so a crash never leaves half a file;
//    the line ends and the byte-order mark the file had are kept.
// Nothing here is ever sent anywhere.
//
// Created hidden at launch, like the message window, and only shown and hidden afterwards: a
// WebView2 window created later comes up blank in this app (see create_settings_window in lib.rs).

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "code";

/// Bigger files are not shown: a text editor in a textarea would crawl.
const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeFileRef {
    pub path: String,
    pub added: u32,
    pub removed: u32,
    /// The lines the agent's recent edits of this file added, one run per edit (newest last), to
    /// mark them in the text: the file on disk does not say which lines are new.
    #[serde(default)]
    pub runs: Vec<Vec<String>>,
}

/// What the island knows of the session, as the window's left side shows it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSession {
    pub pill_id: String,
    /// The project's name (the folder the agent works in).
    pub name: String,
    /// The agent: "Claude Code", "Codex" …
    pub agent: String,
    pub color: String,
    /// "working", "idle", "done" … as the island's state machine names it.
    pub state: String,
    /// The session's folder; every file the window opens must lie in it.
    pub root: String,
    pub steps: Vec<String>,
    pub step_index: usize,
    /// The files the agent changed, oldest first.
    pub files: Vec<CodeFileRef>,
    /// The file to show, when the user asked for a particular one.
    pub active: String,
}

impl CodeSession {
    fn bounded(mut self) -> Self {
        self.steps.truncate(40);
        self.files.truncate(40);
        for f in &mut self.files {
            let keep = f.runs.len().saturating_sub(12);
            f.runs.drain(..keep);
            for run in &mut f.runs {
                run.truncate(300);
            }
        }
        self
    }
}

static CURRENT: Mutex<Option<CodeSession>> = Mutex::new(None);

fn current() -> MutexGuard<'static, Option<CodeSession>> {
    CURRENT.lock().unwrap_or_else(PoisonError::into_inner)
}

fn page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/code.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("code.html".into())
}

/// Builds the hidden window. Closing it only hides it, and forgets the session.
pub fn setup(app: &AppHandle) {
    match WebviewWindowBuilder::new(app, LABEL, page_url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Tobi")
        .inner_size(980.0, 600.0)
        .min_inner_size(640.0, 360.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => {
            let this = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = this.hide();
                    *current() = None;
                    // Tells the page to let go of the text it holds.
                    let _ = this.emit("code-session", Option::<CodeSession>::None);
                }
            });
        }
        Err(err) => crate::log::line(format!("code window failed: {err}")),
    }
}

/// Shows the session in the window, in front.
#[tauri::command]
pub fn open_code_window(app: AppHandle, session: CodeSession) {
    let session = session.bounded();
    *current() = Some(session.clone());
    let Some(win) = app.get_webview_window(LABEL) else {
        crate::log::line("code window missing");
        return;
    };
    let _ = win.emit("code-session", session);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

/// A fresher snapshot (a new step, a new file) for a window that is open; nothing happens when it
/// is not, so a session working away in the background never wakes the window.
#[tauri::command]
pub fn update_code_window(app: AppHandle, session: CodeSession) {
    let mut cur = current();
    let Some(open) = cur.as_ref() else { return };
    if open.pill_id != session.pill_id {
        return;
    }
    // Which file is on show is the window's own business after it was opened.
    let mut session = session.bounded();
    session.active = open.active.clone();
    *cur = Some(session.clone());
    drop(cur);
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.emit("code-session", session);
    }
}

#[tauri::command]
pub fn code_window_session() -> Option<CodeSession> {
    current().clone()
}

#[tauri::command]
pub fn close_code_window(app: AppHandle) {
    *current() = None;
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
        let _ = win.emit("code-session", Option::<CodeSession>::None);
    }
}

// ── The files ─────────────────────────────────────────────────────────────────

/// A file as the editor gets it: the text with `\n` ends and no byte-order mark, and the version
/// to hand back when saving.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeFile {
    pub text: String,
    pub version: String,
    /// Whether a save is allowed: not read-only, and one kind of line end throughout.
    pub editable: bool,
}

/// How a file's lines end, so a save writes them back the same way.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Eol {
    Lf,
    Crlf,
    /// Both kinds: a save through a text box would change lines the user never touched.
    Mixed,
}

fn eol_of(text: &str) -> Eol {
    let lf = text.matches('\n').count();
    let crlf = text.matches("\r\n").count();
    match (lf, crlf) {
        (_, 0) => Eol::Lf,
        (a, b) if a == b => Eol::Crlf,
        _ => Eol::Mixed,
    }
}

const BOM: &str = "\u{feff}";

fn version_of(bytes: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    format!("{}:{:x}", bytes.len(), h.finish())
}

/// Names that hold secrets, whatever folder they are in. Lower-cased.
fn secret_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with(".env")
        || n.ends_with(".env")
        || matches!(
            n.as_str(),
            "id_rsa" | "id_dsa" | "id_ecdsa" | "id_ed25519" | ".npmrc" | ".netrc" | "_netrc" | ".pgpass"
                | ".git-credentials" | "credentials" | "credentials.json" | "secrets.json" | "secrets.yml"
                | "secrets.yaml" | "secrets.toml" | "service-account.json" | "token.json" | ".pypirc"
                | "kubeconfig" | "authorized_keys" | "known_hosts"
        )
        || [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".kdbx", ".ppk", ".gpg", ".asc", ".secret", ".secrets"]
            .iter()
            .any(|ext| n.ends_with(ext))
}

/// Folders that hold secrets or that Git itself keeps.
fn secret_folder(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        ".ssh" | ".aws" | ".gnupg" | ".azure" | ".kube" | ".git" | ".secrets"
    )
}

/// The file `path` names, if the window may open it: absolute, existing, a regular file, inside
/// `root` by its real path, and not a secret. The error is a code the page turns into words.
fn locate(root: &str, path: &str) -> Result<PathBuf, &'static str> {
    if root.trim().is_empty() {
        return Err("outside");
    }
    let given = Path::new(path);
    if !given.is_absolute() {
        return Err("outside");
    }
    let real = fs::canonicalize(given).map_err(|_| "missing")?;
    let base = fs::canonicalize(root).map_err(|_| "outside")?;
    let Ok(inside) = real.strip_prefix(&base) else { return Err("outside") };
    if !real.is_file() {
        return Err("missing");
    }
    let secret = real.file_name().is_some_and(|n| secret_name(&n.to_string_lossy()))
        || inside.components().any(|c| secret_folder(&c.as_os_str().to_string_lossy()));
    if secret {
        return Err("secret");
    }
    Ok(real)
}

fn read_checked(root: &str, path: &str) -> Result<(PathBuf, Vec<u8>), &'static str> {
    let real = locate(root, path)?;
    let meta = fs::metadata(&real).map_err(|_| "missing")?;
    if meta.len() > MAX_BYTES {
        return Err("big");
    }
    let bytes = fs::read(&real).map_err(|_| "missing")?;
    Ok((real, bytes))
}

fn load(root: &str, path: &str) -> Result<CodeFile, &'static str> {
    let (real, bytes) = read_checked(root, path)?;
    let raw = std::str::from_utf8(&bytes).map_err(|_| "binary")?;
    if raw.contains('\0') {
        return Err("binary");
    }
    let readonly = fs::metadata(&real).map(|m| m.permissions().readonly()).unwrap_or(true);
    let eol = eol_of(raw);
    let body = raw.strip_prefix(BOM).unwrap_or(raw);
    let text = if eol == Eol::Crlf { body.replace("\r\n", "\n") } else { body.to_string() };
    Ok(CodeFile { text, version: version_of(&bytes), editable: !readonly && eol != Eol::Mixed })
}

/// The file's text and version.
#[tauri::command]
pub fn code_read(root: String, path: String) -> Result<CodeFile, String> {
    load(&root, &path).map_err(str::to_string)
}

/// Just the version, to see whether the agent wrote the file again.
#[tauri::command]
pub fn code_version(root: String, path: String) -> Result<String, String> {
    read_checked(&root, &path).map(|(_, bytes)| version_of(&bytes)).map_err(str::to_string)
}

/// Writes `text` over the file the editor showed at `base`. With `force` the version is not
/// compared (the user chose to overwrite what the agent wrote). Returns the new version, or
/// "conflict" when the file is no longer the one that was shown.
#[tauri::command]
pub fn code_write(root: String, path: String, text: String, base: String, force: bool) -> Result<String, String> {
    save(&root, &path, &text, &base, force).map_err(str::to_string)
}

fn save(root: &str, path: &str, text: &str, base: &str, force: bool) -> Result<String, &'static str> {
    if text.len() as u64 > MAX_BYTES {
        return Err("big");
    }
    let (real, bytes) = read_checked(root, path)?;
    if !force && version_of(&bytes) != base {
        return Err("conflict");
    }
    let raw = std::str::from_utf8(&bytes).map_err(|_| "binary")?;
    let eol = eol_of(raw);
    if eol == Eol::Mixed {
        return Err("mixed");
    }
    let meta = fs::metadata(&real).map_err(|_| "missing")?;
    if meta.permissions().readonly() {
        return Err("readonly");
    }
    let mut out = String::with_capacity(text.len() + 8);
    if raw.starts_with(BOM) {
        out.push_str(BOM);
    }
    let text = text.replace("\r\n", "\n");
    if eol == Eol::Crlf {
        out.push_str(&text.replace('\n', "\r\n"));
    } else {
        out.push_str(&text);
    }
    let dir = real.parent().ok_or("missing")?;
    let tmp = dir.join(format!(".tobi-save-{}.tmp", std::process::id()));
    let done = (|| -> std::io::Result<()> {
        fs::write(&tmp, out.as_bytes())?;
        fs::set_permissions(&tmp, meta.permissions())?;
        fs::rename(&tmp, &real)
    })();
    if done.is_err() {
        let _ = fs::remove_file(&tmp);
        return Err("write");
    }
    Ok(version_of(out.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tobi-code-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn secrets_are_recognised_by_name_and_folder() {
        for n in [".env", ".env.local", "prod.env", "id_rsa", "server.PEM", "my.key", "credentials", ".npmrc", "vault.kdbx"] {
            assert!(secret_name(n), "{n}");
        }
        for n in ["main.rs", "environment.ts", "keyboard.ts", "README.md", "env.rs"] {
            assert!(!secret_name(n), "{n}");
        }
        assert!(secret_folder(".ssh") && secret_folder(".git") && !secret_folder("src"));
    }

    #[test]
    fn only_files_inside_the_session_folder_open() {
        let dir = scratch("scope");
        let root = dir.join("proj");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/a.ts"), "x").unwrap();
        fs::write(root.join(".env"), "KEY=1").unwrap();
        fs::write(dir.join("outside.ts"), "x").unwrap();
        let r = s(&root);
        assert!(locate(&r, &s(&root.join("src/a.ts"))).is_ok());
        assert_eq!(locate(&r, &s(&dir.join("outside.ts"))), Err("outside"));
        assert_eq!(locate(&r, &s(&root.join("src/../../outside.ts"))), Err("outside"));
        assert_eq!(locate(&r, &s(&root.join(".env"))), Err("secret"));
        assert_eq!(locate(&r, &s(&root.join("src/none.ts"))), Err("missing"));
        assert_eq!(locate(&r, &s(&root.join("src"))), Err("missing"));
        assert_eq!(locate(&r, "src/a.ts"), Err("outside"));
        assert_eq!(locate("", &s(&root.join("src/a.ts"))), Err("outside"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_save_keeps_the_line_ends_and_the_bom() {
        let dir = scratch("eol");
        let f = dir.join("a.txt");
        fs::write(&f, "\u{feff}one\r\ntwo\r\n").unwrap();
        let got = load(&s(&dir), &s(&f)).unwrap();
        assert_eq!(got.text, "one\ntwo\n");
        assert!(got.editable);
        let v = save(&s(&dir), &s(&f), "one\nTWO\nthree\n", &got.version, false).unwrap();
        assert_eq!(fs::read(&f).unwrap(), "\u{feff}one\r\nTWO\r\nthree\r\n".as_bytes());
        assert_eq!(load(&s(&dir), &s(&f)).unwrap().version, v);
        // No temp file is left behind.
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_the_agent_changed_meanwhile_is_not_overwritten() {
        let dir = scratch("conflict");
        let f = dir.join("a.ts");
        fs::write(&f, "let a = 1;\n").unwrap();
        let shown = load(&s(&dir), &s(&f)).unwrap();
        fs::write(&f, "let a = 2;\n").unwrap(); // the agent
        assert_eq!(save(&s(&dir), &s(&f), "let a = 3;\n", &shown.version, false), Err("conflict"));
        assert_eq!(fs::read_to_string(&f).unwrap(), "let a = 2;\n");
        // The user chose to overwrite.
        assert!(save(&s(&dir), &s(&f), "let a = 3;\n", &shown.version, true).is_ok());
        assert_eq!(fs::read_to_string(&f).unwrap(), "let a = 3;\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn binary_big_and_mixed_files_are_refused() {
        let dir = scratch("refuse");
        fs::write(dir.join("b.bin"), [0xff, 0xfe, 0x00, 0x01]).unwrap();
        assert_eq!(load(&s(&dir), &s(&dir.join("b.bin"))), Err("binary"));
        fs::write(dir.join("big.txt"), vec![b'a'; MAX_BYTES as usize + 1]).unwrap();
        assert_eq!(load(&s(&dir), &s(&dir.join("big.txt"))), Err("big"));
        fs::write(dir.join("m.txt"), "a\r\nb\nc\n").unwrap();
        let m = load(&s(&dir), &s(&dir.join("m.txt"))).unwrap();
        assert!(!m.editable);
        assert_eq!(save(&s(&dir), &s(&dir.join("m.txt")), "x", &m.version, true), Err("mixed"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_snapshot_is_bounded() {
        let big = CodeSession { steps: vec!["s".into(); 100], files: vec![CodeFileRef::default(); 100], ..Default::default() }.bounded();
        assert_eq!((big.steps.len(), big.files.len()), (40, 40));
    }
}
