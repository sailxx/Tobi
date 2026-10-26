// The mail providers Tobi knows the servers of: the user picks one and types an address and an app
// password. Every other provider is "custom": the servers are typed in. Outlook.com and Hotmail are
// left out on purpose: Microsoft no longer lets a personal account sign in to IMAP with a password.

use serde::Serialize;

#[derive(Clone, Copy, Debug)]
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub imap_host: &'static str,
    pub imap_port: u16,
    pub smtp_host: &'static str,
    /// 465 is implicit TLS, 587 starts in plain text and upgrades (STARTTLS).
    pub smtp_port: u16,
    /// Where the user makes the app password.
    pub help_url: &'static str,
}

pub const PRESETS: &[Preset] = &[
    Preset { id: "gmail", name: "Gmail", imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 465, help_url: "https://myaccount.google.com/apppasswords" },
    Preset { id: "yandex", name: "Yandex", imap_host: "imap.yandex.com", imap_port: 993, smtp_host: "smtp.yandex.com", smtp_port: 465, help_url: "https://id.yandex.ru/security/app-passwords" },
    Preset { id: "mailru", name: "Mail.ru", imap_host: "imap.mail.ru", imap_port: 993, smtp_host: "smtp.mail.ru", smtp_port: 465, help_url: "https://account.mail.ru/user/2-step-auth/passwords" },
    Preset { id: "yahoo", name: "Yahoo", imap_host: "imap.mail.yahoo.com", imap_port: 993, smtp_host: "smtp.mail.yahoo.com", smtp_port: 465, help_url: "https://login.yahoo.com/account/security" },
    Preset { id: "icloud", name: "iCloud", imap_host: "imap.mail.me.com", imap_port: 993, smtp_host: "smtp.mail.me.com", smtp_port: 587, help_url: "https://account.apple.com/account/manage" },
];

pub fn find(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| p.id == id)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetView {
    pub id: &'static str,
    pub name: &'static str,
    pub help_url: &'static str,
}

pub fn views() -> Vec<PresetView> {
    PRESETS.iter().map(|p| PresetView { id: p.id, name: p.name, help_url: p.help_url }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_preset_is_a_secure_known_server() {
        for p in PRESETS {
            assert_eq!(p.imap_port, 993, "{}: IMAP over TLS", p.id);
            assert!(p.smtp_port == 465 || p.smtp_port == 587, "{}", p.id);
            assert!(p.help_url.starts_with("https://") && p.imap_host.contains('.') && p.smtp_host.contains('.'), "{}", p.id);
        }
        assert!(find("gmail").is_some() && find("nope").is_none());
        let ids: std::collections::HashSet<_> = PRESETS.iter().map(|p| p.id).collect();
        assert_eq!(ids.len(), PRESETS.len(), "ids are unique");
    }
}
