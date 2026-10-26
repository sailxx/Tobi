// Telegram's harmless choices (Settings → Integrations → Telegram), in telegram.json next to
// settings.json. Owned by Rust: the webview changes them through `telegram_set_options` only.
// The API id and hash and the login session are in the credential store, never here; no message
// or name is ever written here (an ignored chat's id is the one exception: it is what "Ignore"
// has to remember).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub enabled: bool,
    /// Read receipts when a chat is opened (on), or only when replying (off).
    pub mark_read_on_open: bool,
    /// Groups and channels stay quiet unless you are mentioned.
    pub mute_groups: bool,
    /// Chat ids (Telegram's bot-API form).
    pub ignored: Vec<String>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { enabled: false, mark_read_on_open: true, mute_groups: true, ignored: vec![] }
    }
}

impl Prefs {
    pub fn cleaned(mut self) -> Prefs {
        self.ignored.retain(|id| !id.is_empty() && id.len() <= 32 && id.parse::<i64>().is_ok());
        self.ignored.sort();
        self.ignored.dedup();
        self.ignored.truncate(500);
        self
    }
}

fn path() -> PathBuf {
    crate::platform::config_dir().join("telegram.json")
}

pub fn load() -> Prefs {
    std::fs::read(path()).ok().and_then(|b| serde_json::from_slice::<Prefs>(&b).ok()).unwrap_or_default().cleaned()
}

pub fn save(prefs: &Prefs) {
    let path = path();
    let Some(dir) = path.parent() else { return };
    let temp = path.with_extension(format!("json.tobi-{}", std::process::id()));
    let written = crate::platform::ensure_private_dir(dir)
        .and_then(|()| serde_json::to_vec_pretty(prefs).map_err(std::io::Error::other))
        .and_then(|json| std::fs::write(&temp, json))
        .and_then(|()| std::fs::rename(&temp, &path));
    if let Err(err) = written {
        let _ = std::fs::remove_file(&temp);
        crate::log::line(format!("telegram: could not save telegram.json: {err}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_cleaning() {
        let p: Prefs = serde_json::from_str("{}").unwrap();
        assert_eq!(p, Prefs::default());
        assert!(!p.enabled && p.mute_groups && p.mark_read_on_open);
        let odd: Prefs = serde_json::from_str(r#"{"ignored":["-100123","5","5","x",""]}"#).unwrap();
        assert_eq!(odd.cleaned().ignored, ["-100123", "5"]);
    }
}
