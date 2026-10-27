// The message window: one chat message whole (text, and the photo) in a window the user can
// resize, with everything selectable. The island sends the message when it is clicked; it is kept
// here in memory only (so a window that opens late can ask for it) and never written anywhere.
//
// Created hidden at launch, like the Tobi window, and only shown and hidden afterwards: a WebView2
// window created later comes up blank in this app (see create_settings_window in lib.rs).

use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "message";

/// More than any chat message (Telegram's own limit is 4,096 characters); a longer one is cut.
const MAX_TEXT: usize = 100_000;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageData {
    pub messenger: String,
    pub chat: String,
    pub id: String,
    pub who: String,
    pub when: String,
    pub text: String,
    pub media: String,
    pub photo: bool,
}

impl MessageData {
    /// What the window keeps: the text cut to a sane size, on a character boundary.
    fn bounded(mut self) -> Self {
        if self.text.chars().count() > MAX_TEXT {
            self.text = self.text.chars().take(MAX_TEXT).collect();
        }
        self
    }
}

static CURRENT: Mutex<Option<MessageData>> = Mutex::new(None);

fn current() -> MutexGuard<'static, Option<MessageData>> {
    CURRENT.lock().unwrap_or_else(PoisonError::into_inner)
}

fn page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/message.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("message.html".into())
}

/// Builds the hidden window. Closing it only hides it, and forgets the message.
pub fn setup(app: &AppHandle) {
    match WebviewWindowBuilder::new(app, LABEL, page_url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Tobi")
        .inner_size(560.0, 440.0)
        .min_inner_size(320.0, 220.0)
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
                }
            });
        }
        Err(err) => crate::log::line(format!("message window failed: {err}")),
    }
}

/// Shows `data` in the window, in front.
#[tauri::command]
pub fn open_message_window(app: AppHandle, data: MessageData) {
    let data = data.bounded();
    *current() = Some(data.clone());
    let Some(win) = app.get_webview_window(LABEL) else {
        crate::log::line("message window missing");
        return;
    };
    let _ = win.emit("message-data", data);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
pub fn message_window_data() -> Option<MessageData> {
    current().clone()
}

#[tauri::command]
pub fn close_message_window(app: AppHandle) {
    *current() = None;
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_huge_text_is_cut_on_a_character_boundary() {
        let d = MessageData { text: "é".repeat(MAX_TEXT + 5), ..Default::default() }.bounded();
        assert_eq!(d.text.chars().count(), MAX_TEXT);
        let small = MessageData { text: "hi".into(), ..Default::default() }.bounded();
        assert_eq!(small.text, "hi");
    }

    #[test]
    fn the_island_sends_camel_case() {
        let d: MessageData = serde_json::from_str(
            r#"{"messenger":"integration_telegram","chat":"1","id":"2","who":"Ann","when":"now","text":"t","media":"","photo":true}"#,
        )
        .unwrap();
        assert!(d.photo && d.who == "Ann");
    }
}
