//! What Claude has written so far in the current turn, read from the session's
//! transcript, so the island can show it whole: hook payloads only carry the
//! tool calls, and the final answer (`last_assistant_message`) only at Stop.
//!
//! The transcript is JSON Lines. Only its tail is read: a turn's prose is short
//! next to the tool results around it, and the relay must stay fast. The path
//! itself is never forwarded — only the text Claude wrote.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use serde_json::Value;

/// How much of the transcript's end is read. Claude Code also logs whole API
/// requests there, so a turn can span megabytes.
const TAIL: u64 = 4 * 1024 * 1024;
/// Longest text forwarded; a longer turn keeps its end, the newest words.
pub const MAX_TEXT_LEN: usize = 64 * 1024;

/// The current turn's text, from the transcript at `path`, or None when there is none yet.
pub fn from_transcript(path: &str) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    // Reading from the middle of the file, the first line is a fragment.
    let lines = if start > 0 { text.split_once('\n').map(|(_, rest)| rest).unwrap_or("") } else { &text };
    from_lines(lines).map(|t| keep_end(t, MAX_TEXT_LEN))
}

/// The text blocks of the assistant messages since the user's last prompt,
/// oldest first, one paragraph apart. Subagents' lines are left out.
pub fn from_lines(lines: &str) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for line in lines.lines().rev() {
        // Claude Code's bookkeeping lines start with their type; messages start
        // with parentUuid. Skipping the former unparsed keeps this fast.
        if line.starts_with("{\"type\":") && !line.starts_with("{\"type\":\"user\"") && !line.starts_with("{\"type\":\"assistant\"") {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(line) else { continue };
        if entry.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let content = entry.pointer("/message/content");
        match entry.get("type").and_then(Value::as_str) {
            Some("assistant") => {
                let Some(Value::Array(blocks)) = content else { continue };
                let texts: Vec<&str> = blocks
                    .iter()
                    .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|t| !t.is_empty())
                    .collect();
                if !texts.is_empty() {
                    parts.push(texts.join("\n\n"));
                }
            }
            Some("user") if is_prompt(&entry, content) => break,
            _ => {}
        }
    }
    if parts.is_empty() {
        return None;
    }
    parts.reverse();
    Some(parts.join("\n\n"))
}

/// A line the user typed: plain text, not a tool result or Claude Code's own note.
fn is_prompt(entry: &Value, content: Option<&Value>) -> bool {
    if entry.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return false;
    }
    match content {
        Some(Value::String(_)) => true,
        Some(Value::Array(blocks)) => blocks
            .iter()
            .any(|b| b.get("type").and_then(Value::as_str) == Some("text")),
        _ => false,
    }
}

/// `s` cut to at most `max` bytes from its end, on a character boundary.
pub fn keep_end(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut at = s.len() - max;
    while !s.is_char_boundary(at) {
        at += 1;
    }
    format!("…{}", &s[at..])
}

/// `s` cut to at most `max` bytes from its start, on a character boundary.
pub fn keep_start(mut s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut at = max;
    while !s.is_char_boundary(at) {
        at -= 1;
    }
    s.truncate(at);
    s.push('…');
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(v: Value) -> String {
        v.to_string()
    }

    fn assistant(texts: &[&str], tool: bool) -> String {
        let mut content: Vec<Value> = texts.iter().map(|t| json!({ "type": "text", "text": t })).collect();
        if tool {
            content.push(json!({ "type": "tool_use", "name": "Read", "input": {} }));
        }
        line(json!({ "type": "assistant", "message": { "role": "assistant", "content": content } }))
    }

    #[test]
    fn the_turn_starts_at_the_last_prompt_and_skips_tool_results() {
        let lines = [
            line(json!({ "type": "user", "message": { "content": "first question" } })),
            assistant(&["old answer"], false),
            line(json!({ "type": "user", "message": { "content": "второй вопрос" } })),
            assistant(&["Смотрю файл."], true),
            line(json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "…" }] } })),
            assistant(&["Нашёл причину.", "Исправляю."], true),
        ]
        .join("\n");
        assert_eq!(from_lines(&lines).as_deref(), Some("Смотрю файл.\n\nНашёл причину.\n\nИсправляю."));
    }

    #[test]
    fn subagents_meta_lines_and_garbage_are_ignored() {
        let lines = [
            line(json!({ "type": "user", "message": { "content": "go" } })),
            assistant(&["mine"], false),
            line(json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "subagent" }] } })),
            line(json!({ "type": "user", "isMeta": true, "message": { "content": "caveat" } })),
            "not json".to_string(),
            assistant(&["after"], false),
        ]
        .join("\n");
        assert_eq!(from_lines(&lines).as_deref(), Some("mine\n\nafter"));
    }

    #[test]
    fn bookkeeping_lines_are_skipped() {
        let lines = [
            line(json!({ "type": "user", "message": { "content": "go" } })),
            assistant(&["kept"], false),
            line(json!({ "type": "api-request-blob", "message": { "content": [{ "type": "text", "text": "no" }] } })),
        ]
        .join("
");
        assert_eq!(from_lines(&lines).as_deref(), Some("kept"));
    }

    #[test]
    fn nothing_written_yet_is_none() {
        let lines = [
            line(json!({ "type": "user", "message": { "content": "go" } })),
            assistant(&[], true),
        ]
        .join("\n");
        assert_eq!(from_lines(&lines), None);
    }

    #[test]
    fn long_texts_keep_their_end_or_their_start_on_a_char_boundary() {
        assert_eq!(keep_end("абвгд".into(), 4), "…гд");
        assert_eq!(keep_start("абвгд".into(), 5), "аб…");
        assert_eq!(keep_end("short".into(), 10), "short");
    }

    #[test]
    fn a_transcript_file_is_read_from_its_tail() {
        let dir = std::env::temp_dir().join(format!("tobi-turn-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        let body = [
            line(json!({ "type": "user", "message": { "content": "hi" } })),
            assistant(&["hello"], false),
        ]
        .join("\n");
        std::fs::write(&path, body).unwrap();
        assert_eq!(from_transcript(path.to_str().unwrap()).as_deref(), Some("hello"));
        assert_eq!(from_transcript(dir.join("missing").to_str().unwrap()), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod live {
    /// `TOBI_TURN_TEST=<transcript.jsonl> cargo test -p tobi-hook live -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn print_the_turn_of_a_real_transcript() {
        let path = std::env::var("TOBI_TURN_TEST").expect("TOBI_TURN_TEST");
        println!("{:?}", super::from_transcript(&path));
    }
}
