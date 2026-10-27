// Flow dictation on macOS: the part that needs the OS, kept small and honest.
//
// Holding a key anywhere needs a CGEventTap, which macOS only allows after the
// user grants Input Monitoring, and none of that could be tried without a Mac.
// So the key is reported as unsupported and the pill's own buttons drive the
// dictation (the same path Linux on Wayland takes without a key). Pasting and
// the app in front go through System Events (Accessibility permission).

use std::process::Command;
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

use super::logic::FlowKey;
use super::KeyEvent;

pub struct KeyListener;

pub fn keys_supported() -> Result<(), &'static str> {
    Err("macos")
}

pub fn listen(_key: FlowKey, _tx: Sender<(KeyEvent, Instant)>) -> Result<KeyListener, String> {
    Err("watching a key is not implemented on macOS".into())
}

pub fn wait_key_released(_key: FlowKey) {
    std::thread::sleep(Duration::from_millis(30));
}

/// Cmd+V in the app in front. Terminals paste with Cmd+V too, so `shift` is ignored.
pub fn send_paste(_shift: bool) -> Result<(), String> {
    let out = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to keystroke \"v\" using command down"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn script(source: &str) -> Option<String> {
    let out = Command::new("osascript").args(["-e", source]).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The app in front: (bundle id lowercased, name).
pub fn foreground_app() -> Option<(String, String)> {
    let text = script(
        "tell application \"System Events\" to set p to first application process whose frontmost is true\n\
         return (bundle identifier of p) & \"\t\" & (name of p)",
    )?;
    let (id, name) = text.split_once('\t')?;
    (!id.is_empty() && !id.eq_ignore_ascii_case("com.sailxx.tobi")).then(|| (id.to_lowercase(), name.to_string()))
}

/// Apps with a window, for "Add an app" in Styles.
pub fn running_apps() -> Vec<(String, String)> {
    let Some(text) = script(
        "tell application \"System Events\"\n\
         set out to \"\"\n\
         repeat with p in (application processes whose background only is false)\n\
         set out to out & (bundle identifier of p) & \"\t\" & (name of p) & \"\n\"\n\
         end repeat\n\
         return out\nend tell",
    ) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|l| l.split_once('\t'))
        .filter(|(id, _)| !id.is_empty() && *id != "missing value" && !id.eq_ignore_ascii_case("com.sailxx.tobi"))
        .map(|(id, name)| (id.to_lowercase(), name.to_string()))
        .collect()
}
