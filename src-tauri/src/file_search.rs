// The island's search: files by name in the user's own folders (Desktop,
// Documents, Downloads, Pictures, Music, Videos). A plain walk with limits on
// depth, entries and time, so a search never takes more than a moment and
// never leaves the home folder. Only a path the last search returned can be
// opened from the page, and a program is shown in its folder instead of run.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;

use crate::platform;

const ROOTS: &[&str] = &["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"];
const MAX_DEPTH: usize = 6;
const MAX_ENTRIES: usize = 60_000;
const MAX_TIME: Duration = Duration::from_millis(1500);
const MAX_RESULTS: usize = 8;

/// Folders nobody looks for a file in, and that hold a great many.
const SKIP: &[&str] = &["node_modules", "target", "__pycache__", "venv", ".venv", "dist", "build", "AppData"];

/// Opening these would run something: they are shown in their folder instead.
const RUNNABLE: &[&str] = &[
    "exe", "bat", "cmd", "com", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msc", "scr", "lnk", "url",
    "reg", "hta", "cpl", "jar", "sh", "app", "command", "desktop", "appimage",
];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundFile {
    pub name: String,
    pub path: String,
    /// The folder it is in, from the home folder ("Documents/Work").
    pub folder: String,
    pub is_dir: bool,
    /// Seconds since the epoch.
    pub modified: u64,
}

static LAST: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// How well `name` answers `words` (all lower case): None when a word is missing.
pub fn score(name: &str, words: &[String]) -> Option<u32> {
    let lower = name.to_lowercase();
    let mut s = 0;
    for w in words {
        let at = lower.find(w.as_str())?;
        s += if at == 0 { 30 } else if !lower.as_bytes()[at - 1].is_ascii_alphanumeric() { 20 } else { 10 };
    }
    let stem = lower.rsplit_once('.').map_or(lower.as_str(), |(a, _)| a);
    if words.len() == 1 && stem == words[0] {
        s += 40;
    }
    Some(s)
}

fn words_of(query: &str) -> Vec<String> {
    query.split_whitespace().map(|w| w.to_lowercase()).filter(|w| !w.is_empty()).take(6).collect()
}

fn modified(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs())
}

pub fn search(home: &Path, query: &str) -> Vec<FoundFile> {
    let words = words_of(query);
    if words.is_empty() {
        return Vec::new();
    }
    let started = Instant::now();
    let mut seen = 0usize;
    let mut hits: Vec<(u32, FoundFile)> = Vec::new();
    let mut queue: std::collections::VecDeque<(PathBuf, usize)> =
        ROOTS.iter().map(|r| (home.join(r), 0)).filter(|(p, _)| p.is_dir()).collect();
    while let Some((dir, depth)) = queue.pop_front() {
        if seen >= MAX_ENTRIES || started.elapsed() >= MAX_TIME {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.starts_with('~') {
                continue;
            }
            let Ok(kind) = entry.file_type() else { continue };
            // Links are not followed: a search stays in the folders it was given.
            if kind.is_symlink() {
                continue;
            }
            let is_dir = kind.is_dir();
            if let Some(s) = score(&name, &words) {
                let path = entry.path();
                let folder = path
                    .parent()
                    .and_then(|p| p.strip_prefix(home).ok())
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                let modified = entry.metadata().map(|m| modified(&m)).unwrap_or(0);
                hits.push((s, FoundFile { name: name.clone(), path: path.to_string_lossy().into_owned(), folder, is_dir, modified }));
            }
            if is_dir && depth + 1 < MAX_DEPTH && !SKIP.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
                queue.push_back((entry.path(), depth + 1));
            }
        }
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.modified.cmp(&a.1.modified)));
    hits.into_iter().take(MAX_RESULTS).map(|(_, f)| f).collect()
}

pub fn is_runnable(path: &str) -> bool {
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .is_some_and(|e| RUNNABLE.contains(&e.as_str()))
}

#[tauri::command]
pub async fn search_files(query: String) -> Vec<FoundFile> {
    let home = platform::home_dir();
    let found = tokio::task::spawn_blocking(move || search(&home, &query)).await.unwrap_or_default();
    *LAST.lock().unwrap() = found.iter().map(|f| f.path.clone()).collect();
    found
}

/// Opens a file the last search found; `reveal`, or a program, shows it in its folder.
#[tauri::command]
pub fn open_found_file(path: String, reveal: bool) {
    if !LAST.lock().unwrap().contains(&path) {
        return;
    }
    if reveal || is_runnable(&path) {
        reveal_file(&path);
    } else {
        open_file(&path);
    }
}

#[cfg(windows)]
fn open_file(path: &str) {
    platform::open_url(path);
}

#[cfg(not(windows))]
fn open_file(path: &str) {
    platform::reveal_folder(path);
}

#[cfg(windows)]
fn reveal_file(path: &str) {
    let _ = std::process::Command::new("explorer").arg(format!("/select,{path}")).spawn();
}

#[cfg(target_os = "macos")]
fn reveal_file(path: &str) {
    let _ = std::process::Command::new("open").args(["-R", path]).spawn();
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_file(path: &str) {
    if let Some(dir) = Path::new(path).parent() {
        platform::reveal_folder(&dir.to_string_lossy());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(q: &str) -> Vec<String> {
        words_of(q)
    }

    #[test]
    fn every_word_must_be_in_the_name_and_a_start_counts_more() {
        assert_eq!(score("Report 2026.pdf", &w("dog")), None);
        assert!(score("report.pdf", &w("report")) > score("my-report-final.pdf", &w("report")));
        assert!(score("my-report-final.pdf", &w("report")) > score("bigreport.pdf", &w("report")));
        assert!(score("Tax report 2026.xlsx", &w("2026 tax")).is_some());
        assert_eq!(score("Tax.xlsx", &w("tax 2026")), None);
    }

    #[test]
    fn programs_are_shown_not_run() {
        assert!(is_runnable("C:/x/setup.EXE"));
        assert!(is_runnable("/home/a/run.sh"));
        assert!(!is_runnable("C:/x/notes.txt"));
        assert!(!is_runnable("C:/x/folder"));
    }

    #[test]
    fn it_finds_files_in_the_home_folders_only() {
        let home = std::env::temp_dir().join(format!("tobi-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join("Documents/Work")).unwrap();
        std::fs::create_dir_all(home.join("Secret")).unwrap();
        std::fs::create_dir_all(home.join("Documents/node_modules")).unwrap();
        std::fs::write(home.join("Documents/Work/budget plan.xlsx"), b"x").unwrap();
        std::fs::write(home.join("Secret/budget.txt"), b"x").unwrap();
        std::fs::write(home.join("Documents/node_modules/budget.js"), b"x").unwrap();
        let found = search(&home, "budget");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "budget plan.xlsx");
        assert_eq!(found[0].folder, "Documents/Work");
        let _ = std::fs::remove_dir_all(&home);
    }
}
