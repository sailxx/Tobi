// The mail account's harmless choices (Settings → Integrations → Mail), in mailbox.json next to
// settings.json: which provider, the address and the servers. Owned by Rust: the webview changes
// them through `mailbox_save_account` only. The app password is in the credential store, never here;
// no subject, sender or text of a message is ever written anywhere.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::presets;
use crate::gmail::model::valid_address;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub enabled: bool,
    pub mark_read_on_open: bool,
    /// A preset's id (presets.rs) or "custom".
    pub provider: String,
    pub email: String,
    /// Only for "custom": a preset brings its own servers.
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            enabled: false,
            mark_read_on_open: true,
            provider: "gmail".into(),
            email: String::new(),
            imap_host: String::new(),
            imap_port: 993,
            smtp_host: String::new(),
            smtp_port: 465,
        }
    }
}

/// Where to connect, whichever way it was chosen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Servers {
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
}

/// A server name: letters, digits, dots and hyphens only, so nothing odd can be connected to or sent.
pub fn valid_host(host: &str) -> bool {
    let h = host;
    !h.is_empty() && h.len() <= 253 && h.contains('.') && !h.starts_with(['.', '-']) && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

impl Prefs {
    pub fn cleaned(mut self) -> Prefs {
        self.email = self.email.trim().to_string();
        if self.provider != "custom" && presets::find(&self.provider).is_none() {
            self.provider = "gmail".into();
        }
        self.imap_host = self.imap_host.trim().to_ascii_lowercase();
        self.smtp_host = self.smtp_host.trim().to_ascii_lowercase();
        if self.imap_port == 0 {
            self.imap_port = 993;
        }
        if self.smtp_port == 0 {
            self.smtp_port = 465;
        }
        self
    }

    /// The servers to use: the preset's, or the typed ones when they are acceptable.
    pub fn servers(&self) -> Option<Servers> {
        if let Some(p) = presets::find(&self.provider) {
            return Some(Servers { imap_host: p.imap_host.into(), imap_port: p.imap_port, smtp_host: p.smtp_host.into(), smtp_port: p.smtp_port });
        }
        (valid_host(&self.imap_host) && valid_host(&self.smtp_host) && self.imap_port > 0 && self.smtp_port > 0).then(|| Servers {
            imap_host: self.imap_host.clone(),
            imap_port: self.imap_port,
            smtp_host: self.smtp_host.clone(),
            smtp_port: self.smtp_port,
        })
    }

    /// An address and servers: what a connection needs besides the password.
    pub fn complete(&self) -> bool {
        valid_address(&self.email) && self.servers().is_some()
    }
}

fn path() -> PathBuf {
    crate::platform::config_dir().join("mailbox.json")
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
        crate::log::line(format!("mailbox: could not save mailbox.json: {err}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_cleaning() {
        let p: Prefs = serde_json::from_str("{}").unwrap();
        assert_eq!(p, Prefs::default());
        assert!(!p.enabled && p.mark_read_on_open && !p.complete());
        let odd = Prefs { provider: "evil".into(), imap_port: 0, smtp_port: 0, imap_host: " IMAP.X.ORG ".into(), ..Prefs::default() }.cleaned();
        assert_eq!((odd.provider.as_str(), odd.imap_port, odd.smtp_port, odd.imap_host.as_str()), ("gmail", 993, 465, "imap.x.org"));
    }

    #[test]
    fn a_preset_brings_its_servers_and_a_custom_one_needs_valid_hosts() {
        let g = Prefs { email: "me@gmail.com".into(), ..Prefs::default() };
        assert_eq!(g.servers().unwrap().imap_host, "imap.gmail.com");
        assert!(g.complete());
        let c = Prefs { provider: "custom".into(), email: "me@x.org".into(), imap_host: "imap.x.org".into(), smtp_host: "smtp.x.org".into(), ..Prefs::default() };
        assert!(c.complete());
        let bad = Prefs { imap_host: "imap.x.org/evil".into(), ..c.clone() };
        assert!(bad.servers().is_none() && !bad.complete());
        assert!(!Prefs { email: "nope".into(), ..c }.complete());
    }

    #[test]
    fn host_names_are_plain() {
        for ok in ["imap.gmail.com", "mail-1.x.org"] {
            assert!(valid_host(ok), "{ok}");
        }
        for bad in ["", "localhost", "a b.com", "x.org:993", "x.org/y", "-x.org", ".x.org", "x.org\r\n"] {
            assert!(!valid_host(bad), "{bad:?}");
        }
    }
}
