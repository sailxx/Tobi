// The chat answered by Claude Code (`claude -p`), on the user's Claude
// subscription: no API key. Tobi runs the installed CLI once per question, in
// an empty folder, with no tools (a dropped file is the one exception: the CLI
// may read that single file). The history rides along as plain text, so
// switching to and from the other providers loses nothing.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde_json::{json, Value};

use crate::chat::{self, Chat, ChatContext, ChatReply, ModelInfo};
use crate::i18n::{t, tf};

pub const ID: &str = "claude-code";
pub const DEFAULT_MODEL: &str = "sonnet";
const TIMEOUT: Duration = Duration::from_secs(240);

/// The CLI takes these aliases and always resolves them to its latest model.
pub fn models() -> Vec<ModelInfo> {
    [("opus", "Opus"), ("sonnet", "Sonnet"), ("haiku", "Haiku")]
        .into_iter()
        .map(|(id, label)| ModelInfo { id: id.into(), label: label.into() })
        .collect()
}

/// `claude` on the PATH, or where its installer puts it.
fn executable() -> Option<PathBuf> {
    let name = if cfg!(windows) { "claude.exe" } else { "claude" };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    let candidate = PathBuf::from(home).join(".local").join("bin").join(name);
    candidate.is_file().then_some(candidate)
}

/// The conversation so far and the new question, as the one prompt the CLI reads.
fn prompt(history: &[Value], first_line: &str) -> String {
    let mut out = String::new();
    for turn in history {
        let who = if turn["role"] == "assistant" { "Assistant" } else { "User" };
        if let Some(text) = turn["content"].as_str() {
            out.push_str(&format!("{who}: {text}\n\n"));
        }
    }
    out.push_str(&format!("User: {first_line}\n\nAssistant:"));
    out
}

fn question(first: bool, context: Option<&ChatContext>, query: &str) -> String {
    match context.filter(|_| first) {
        Some(ChatContext::File { name, path }) => format!("File: {name} (at {path}; read it to answer)\n\n{query}"),
        Some(ChatContext::Window { app_name, title, url }) => {
            format!("{}\n\n{query}", chat::window_line(app_name, title, url.as_deref()))
        }
        None => query.to_string(),
    }
}

fn kill(pid: u32) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        let _ = crate::platform::no_console(&mut cmd).status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

/// What the CLI says on failure, in a line the chat can show.
fn failure(stderr: &str, stdout: &str) -> String {
    let said = format!("{stderr}\n{stdout}");
    let lower = said.to_lowercase();
    if lower.contains("not logged in") || lower.contains("/login") || lower.contains("authentication") {
        return t("Claude Code is not signed in. Open a terminal, run claude, and sign in with /login.");
    }
    let line = said.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    tf("Claude Code failed: {error}", &[("error", line)])
}

/// One chat turn through the installed Claude Code.
pub async fn send(chat: &Chat, model: &str, query: String, context: Option<ChatContext>) -> Result<ChatReply, String> {
    let exe = executable().ok_or_else(|| t("Claude Code is not installed. Install it from claude.com/claude-code and sign in."))?;
    let turn = chat.begin(ID);
    let text = question(turn.first, context.as_ref(), &query);
    let input = prompt(&turn.history, &text);
    let has_file = turn.first && matches!(context, Some(ChatContext::File { .. }));
    let model = if model.is_empty() { DEFAULT_MODEL.to_string() } else { model.to_string() };
    let system = chat::system_prompt(false);

    let work = std::env::temp_dir().join("tobi-claude-chat");
    let _ = std::fs::create_dir_all(&work);

    let mut cmd = Command::new(exe);
    cmd.current_dir(&work)
        .args(["-p", "--output-format", "text", "--no-session-persistence", "--disable-slash-commands"])
        .args(["--model", &model, "--system-prompt", &system]);
    if has_file {
        cmd.arg("--add-dir").arg(crate::files::inbox_dir());
        cmd.args(["--tools", "Read"]);
    } else {
        cmd.args(["--tools", ""]);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    crate::platform::no_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| tf("Claude Code failed: {error}", &[("error", &e.to_string())]))?;
    let pid = child.id();
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
    }
    let wait = tokio::task::spawn_blocking(move || child.wait_with_output());
    let output = match tokio::time::timeout(TIMEOUT, wait).await {
        Ok(Ok(Ok(output))) => output,
        Ok(Ok(Err(e))) => return Err(tf("Claude Code failed: {error}", &[("error", &e.to_string())])),
        Ok(Err(e)) => return Err(tf("Claude Code failed: {error}", &[("error", &e.to_string())])),
        Err(_) => {
            kill(pid);
            return Err(t("Claude Code took too long to answer."));
        }
    };
    let answer = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() || answer.is_empty() {
        return Err(failure(&String::from_utf8_lossy(&output.stderr), &answer));
    }
    let plain = chat::plain_question(turn.first, context.as_ref(), &query);
    chat.commit(&turn, json!({ "role": "user", "content": plain }), json!({ "role": "assistant", "content": answer }), &plain, &answer);
    Ok(ChatReply { text: answer })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prompt_carries_the_history_then_the_new_question() {
        let history = vec![json!({"role":"user","content":"hi"}), json!({"role":"assistant","content":"hello"})];
        assert_eq!(prompt(&history, "and now?"), "User: hi\n\nAssistant: hello\n\nUser: and now?\n\nAssistant:");
        assert_eq!(prompt(&[], "first"), "User: first\n\nAssistant:");
    }

    #[test]
    fn a_missing_login_is_said_plainly() {
        assert!(failure("", "Not logged in · Please run /login").contains("signed in"));
        assert!(failure("boom\nmore", "").contains("boom"));
    }

    #[test]
    fn the_aliases_are_the_cli_ones() {
        let ids: Vec<_> = models().into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["opus", "sonnet", "haiku"]);
    }
}
