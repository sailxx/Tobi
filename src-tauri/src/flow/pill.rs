// What dictation, the Notetaker and « OK Tobi » are doing right now. There is
// no pill on the screen any more: this is only the state the rest of the app
// asks about (is the microphone Flow's, is a call being recorded).

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default)]
pub struct PillState {
    /// "idle", "listening", "thinking", "locked", "copied", "failed", "pastedAgain".
    pub phase: String,
    /// When the call being recorded started (ms since 1970), or none.
    pub note_started_at: Option<u64>,
    pub enabled: bool,
    /// « OK Tobi » is talking with you.
    pub voice: Option<crate::voice::VoiceView>,
}

pub struct Pill {
    state: Mutex<PillState>,
}

fn state_of(app: &AppHandle) -> Option<Arc<Pill>> {
    app.try_state::<Arc<Pill>>().map(|s| s.inner().clone())
}

pub fn setup(app: &AppHandle) {
    let pill = Arc::new(Pill { state: Mutex::new(PillState { phase: "idle".into(), ..Default::default() }) });
    app.manage(pill);
}

/// A dictation is under way: the microphone is Flow's.
pub fn dictating(app: &AppHandle) -> bool {
    state_of(app).is_some_and(|p| matches!(p.state.lock().unwrap().phase.as_str(), "listening" | "locked" | "thinking"))
}

pub fn update(app: &AppHandle, change: impl FnOnce(&mut PillState)) {
    if let Some(pill) = state_of(app) {
        change(&mut pill.state.lock().unwrap());
    }
}

/// A short message nobody sees on screen any more: it goes to the log.
pub fn announce(_app: &AppHandle, _icon: &str, _tint: &str, text: String, _action: Option<(String, &str)>, _seconds: u64) {
    crate::log::line(format!("flow: {text}"));
}

/// Back to rest after a short message.
pub fn rest_after(app: &AppHandle, phase: &str, ms: u64) {
    let app = app.clone();
    let phase = phase.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(ms));
        update(&app, |s| {
            if s.phase == phase {
                s.phase = "idle".into();
            }
        });
    });
}
