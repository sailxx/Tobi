// Gmail's harmless choices (Settings → Integrations → Gmail), in gmail.json next to settings.json.
// Owned by Rust: the webview changes them through `gmail_set_options` only. The OAuth client id and
// secret and the refresh token are in the credential store, never here; no address, subject or text
// of a message is ever written anywhere.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub enabled: bool,
    /// A message is marked read when it is opened in the island (on), or only by the button (off).
    pub mark_read_on_open: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { enabled: false, mark_read_on_open: true }
    }
}

fn path() -> PathBuf {
    crate::platform::config_dir().join("gmail.json")
}

pub fn load() -> Prefs {
    std::fs::read(path()).ok().and_then(|b| serde_json::from_slice::<Prefs>(&b).ok()).unwrap_or_default()
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
        crate::log::line(format!("gmail: could not save gmail.json: {err}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults() {
        let p: Prefs = serde_json::from_str("{}").unwrap();
        assert_eq!(p, Prefs::default());
        assert!(!p.enabled && p.mark_read_on_open);
    }
}
