// Mail over IMAP and SMTP in the island (experimental): any mailbox with an app password (Gmail,
// Yandex, Mail.ru, Yahoo, iCloud or your own server). The same card as Gmail's: your unread mail, one
// message opened as plain text, a reply or a new message, mark read, archive, trash.
//
// The address, the servers and the choices are in mailbox.json, the app password in the credential
// store; a connection is made for each look (every minute while on) and closed after it. Messages
// stay in memory, are never logged or saved, and are forgotten when Tobi quits. Only the plain text
// of a message is shown, never its HTML: no remote content is loaded. Nothing is sent without the
// user's own click on Send. Runs only while the integration is on and its pill is active.
//
// It speaks the island's language of gmail/mod.rs (IslandView, Link, SendError, PillEvent): the same
// page code draws both.

pub mod imap;
pub mod prefs;
pub mod presets;
pub mod smtp;

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::gmail::api::{MailBody, MailItem};
use crate::gmail::model;
use crate::gmail::{check_send, IslandView, Link, PillEvent, SendError};
use imap::ImapError;
use prefs::Prefs;
use smtp::SmtpError;

pub const PILL_ID: &str = "integration_mail";
/// Credential store entry, Rust-only (secrets.rs INTERNAL_KEYS): the webview never reads it.
pub const PASSWORD_KEY: &str = "mail-password";

const ISLAND_EVENT: &str = "mailbox";
const PILL_EVENT: &str = "mailbox-pill";
const SETTINGS_EVENT: &str = "mailbox-settings";

const POLL: Duration = Duration::from_secs(60);
const MAX_UNREAD: usize = 15;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub prefs: Prefs,
    pub has_password: bool,
    pub link: Link,
    pub account: Option<String>,
    pub pill_active: bool,
    pub presets: Vec<presets::PresetView>,
}

struct Ctl {
    prefs: Prefs,
    pill_active: bool,
    link: Link,
    generation: u64,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    items: Vec<MailItem>,
    unread: u32,
    seen: HashSet<String>,
    loaded_once: bool,
    opened: Option<MailBody>,
    sending: bool,
    send_error: Option<SendError>,
    last_send: Option<Instant>,
    down: bool,
}

static CTL: LazyLock<Mutex<Ctl>> = LazyLock::new(|| {
    Mutex::new(Ctl {
        prefs: prefs::load(),
        pill_active: false,
        link: Link::Off,
        generation: 0,
        task: None,
        items: vec![],
        unread: 0,
        seen: HashSet::new(),
        loaded_once: false,
        opened: None,
        sending: false,
        send_error: None,
        last_send: None,
        down: false,
    })
});
static APP: OnceLock<AppHandle> = OnceLock::new();

fn ctl() -> MutexGuard<'static, Ctl> {
    CTL.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Ctl {
    fn should_run(&self) -> bool {
        self.prefs.enabled && self.pill_active
    }

    fn island_view(&self) -> IslandView {
        IslandView {
            on: self.link == Link::Connected,
            link: self.link.clone(),
            items: self.items.clone(),
            unread: self.unread,
            opened: self.opened.clone(),
            sending: self.sending,
            send_error: self.send_error.clone(),
            down: self.down,
            account: (!self.prefs.email.is_empty()).then(|| self.prefs.email.clone()),
        }
    }

    fn settings_view(&self) -> SettingsView {
        SettingsView {
            prefs: self.prefs.clone(),
            has_password: crate::secrets::get_internal(PASSWORD_KEY).is_some(),
            link: self.link.clone(),
            account: (!self.prefs.email.is_empty()).then(|| self.prefs.email.clone()),
            pill_active: self.pill_active,
            presets: presets::views(),
        }
    }
}

fn changed() {
    let Some(app) = APP.get() else { return };
    let (island, settings) = {
        let c = ctl();
        (c.island_view(), c.settings_view())
    };
    let _ = app.emit_to(crate::island::WINDOW_LABEL, ISLAND_EVENT, island);
    let _ = app.emit_to(crate::HUB_LABEL, SETTINGS_EVENT, settings);
}

fn pill(event: PillEvent) {
    if let Some(app) = APP.get() {
        let _ = app.emit_to(crate::island::WINDOW_LABEL, PILL_EVENT, event);
    }
}

/// Everything a connection needs: servers, address, password.
struct Account {
    servers: prefs::Servers,
    email: String,
    password: String,
}

fn account() -> Option<Account> {
    let p = ctl().prefs.clone();
    let servers = p.servers().filter(|_| p.complete())?;
    let password = crate::secrets::get_internal(PASSWORD_KEY)?;
    Some(Account { servers, email: p.email, password })
}

// ── Starting and stopping ─────────────────────────────────────────────────────

pub fn start(app: &AppHandle, active_integrations: &[String]) {
    let _ = APP.set(app.clone());
    ctl().pill_active = active_integrations.iter().any(|p| p == PILL_ID);
    reconcile();
}

pub fn sync(active_integrations: &[String]) {
    ctl().pill_active = active_integrations.iter().any(|p| p == PILL_ID);
    reconcile();
}

pub fn shutdown() {
    stop(Link::Off);
}

fn reconcile() {
    let (run, running) = {
        let c = ctl();
        (c.should_run(), c.task.is_some())
    };
    match (run, running) {
        (true, false) => connect(),
        (false, true) => stop(Link::Off),
        (false, false) => {
            ctl().link = Link::Off;
            changed();
        }
        (true, true) => changed(),
    }
}

fn stop(link: Link) {
    let task = {
        let mut c = ctl();
        c.generation += 1;
        c.items.clear();
        c.unread = 0;
        c.seen.clear();
        c.loaded_once = false;
        c.opened = None;
        c.sending = false;
        c.send_error = None;
        c.down = false;
        c.link = link;
        c.task.take()
    };
    if let Some(task) = task {
        task.abort();
    }
    pill(PillEvent::Reset);
    changed();
}

fn connect() {
    if account().is_none() {
        ctl().link = Link::NeedsSetup;
        changed();
        return;
    }
    let generation = {
        let mut c = ctl();
        c.generation += 1;
        c.link = Link::Connecting;
        c.generation
    };
    changed();
    let task = tauri::async_runtime::spawn(run(generation));
    ctl().task = Some(task);
}

fn current(generation: u64) -> bool {
    ctl().generation == generation
}

fn failed(generation: u64, err: &ImapError) {
    if !current(generation) {
        return;
    }
    {
        let mut c = ctl();
        c.down = true;
        c.link = match err {
            ImapError::Auth => Link::NeedsLogin,
            ImapError::Network => Link::Unreachable,
            ImapError::NoFolder => Link::Failed { detail: "noFolder".into() },
            ImapError::TooLarge => Link::Failed { detail: "tooLarge".into() },
            ImapError::Other(d) => Link::Failed { detail: d.chars().take(40).collect() },
        };
    }
    crate::log::line(format!("mailbox: {err:?}").chars().take(80).collect::<String>());
    changed();
}

async fn run(generation: u64) {
    loop {
        if !current(generation) {
            return;
        }
        match poll(generation).await {
            Ok(()) => {}
            Err(ImapError::Auth) => {
                failed(generation, &ImapError::Auth);
                return; // saving the account again starts a new run
            }
            Err(err) => failed(generation, &err),
        }
        tokio::time::sleep(POLL).await;
    }
}

async fn session() -> Result<(Account, async_imap::Session<tokio_rustls::client::TlsStream<tokio::net::TcpStream>>), ImapError> {
    let a = account().ok_or(ImapError::Auth)?;
    let s = imap::connect(&a.servers.imap_host, a.servers.imap_port, &a.email, &a.password).await?;
    Ok((a, s))
}

async fn poll(generation: u64) -> Result<(), ImapError> {
    let (_, mut s) = session().await?;
    let result = imap::unread(&mut s, MAX_UNREAD).await;
    imap::logout(&mut s).await;
    let (total, fresh) = result?;
    if !current(generation) {
        return Ok(());
    }
    let announce = {
        let mut c = ctl();
        let first = !c.loaded_once;
        let ids: HashSet<&str> = fresh.iter().map(|i| i.id.as_str()).collect();
        let kept: Vec<MailItem> = c.items.iter().filter(|i| ids.contains(i.id.as_str())).cloned().collect();
        let newcomers: Vec<MailItem> = fresh.iter().filter(|i| !c.seen.contains(&i.id)).cloned().collect();
        for item in &newcomers {
            c.seen.insert(item.id.clone());
        }
        let mut items = kept;
        items.extend(newcomers.iter().cloned());
        // What the server lists is the truth: items it still lists but we had dropped (marked read here) stay out.
        items.sort_by(|a, b| b.date.cmp(&a.date));
        c.items = items;
        c.unread = total;
        c.loaded_once = true;
        c.link = Link::Connected;
        c.down = false;
        (!first).then(|| newcomers.into_iter().max_by_key(|i| i.date)).flatten().map(|i| i.from)
    };
    if let Some(name) = announce {
        pill(PillEvent::Message { name });
    }
    changed();
    Ok(())
}

// ── Commands for the island ───────────────────────────────────────────────────

#[tauri::command]
pub fn mailbox_island() -> IslandView {
    ctl().island_view()
}

#[tauri::command]
pub async fn mailbox_refresh() {
    let generation = {
        let c = ctl();
        if c.link != Link::Connected {
            return;
        }
        c.generation
    };
    if let Err(err) = poll(generation).await {
        failed(generation, &err);
    }
}

#[tauri::command]
pub async fn mailbox_open(id: String) -> bool {
    let Ok((_, mut s)) = session().await else { return false };
    let opened = imap::body(&mut s, &id).await;
    let mark = ctl().prefs.mark_read_on_open;
    let mut view = match opened {
        Ok((view, _)) => view,
        Err(_) => {
            imap::logout(&mut s).await;
            return false;
        }
    };
    if mark && view.unread && imap::set_seen(&mut s, &id).await.is_ok() {
        view.unread = false;
        let mut c = ctl();
        c.items.retain(|i| i.id != id);
        c.unread = c.unread.saturating_sub(1);
        drop(c);
        pill(PillEvent::Read);
    }
    imap::logout(&mut s).await;
    {
        let mut c = ctl();
        c.opened = Some(view);
        c.send_error = None;
    }
    changed();
    true
}

#[tauri::command]
pub fn mailbox_close() {
    ctl().opened = None;
    changed();
}

#[derive(Clone, Copy)]
enum Change {
    Seen,
    Archive,
    Trash,
}

async fn change(id: String, what: Change) -> bool {
    let Ok((_, mut s)) = session().await else { return false };
    let done = match what {
        Change::Seen => imap::set_seen(&mut s, &id).await,
        Change::Archive => imap::move_out(&mut s, &id, false).await,
        Change::Trash => imap::move_out(&mut s, &id, true).await,
    };
    imap::logout(&mut s).await;
    if let Err(err) = done {
        let mut c = ctl();
        c.send_error = Some(match err {
            ImapError::NoFolder => SendError::Refused { detail: "noFolder".into() },
            ImapError::Network => SendError::Unreachable,
            other => SendError::Refused { detail: format!("{other:?}").chars().take(40).collect() },
        });
        drop(c);
        changed();
        return false;
    }
    {
        let mut c = ctl();
        c.items.retain(|i| i.id != id);
        if c.opened.as_ref().is_some_and(|o| o.id == id) {
            c.opened = None;
        }
        c.unread = c.unread.saturating_sub(1);
    }
    pill(PillEvent::Read);
    changed();
    true
}

#[tauri::command]
pub async fn mailbox_mark_read(id: String) -> bool {
    change(id, Change::Seen).await
}

#[tauri::command]
pub async fn mailbox_archive(id: String) -> bool {
    change(id, Change::Archive).await
}

#[tauri::command]
pub async fn mailbox_trash(id: String) -> bool {
    change(id, Change::Trash).await
}

fn send_failed(err: SendError) -> bool {
    {
        let mut c = ctl();
        c.sending = false;
        c.send_error = Some(err);
    }
    changed();
    false
}

fn begin_send(text: &str) -> Result<(), SendError> {
    let mut c = ctl();
    if let Some(err) = check_send(text, c.last_send, Instant::now()) {
        return Err(err);
    }
    if c.link != Link::Connected {
        return Err(if matches!(c.link, Link::NeedsLogin | Link::NeedsSetup) { SendError::NeedsLogin } else { SendError::Unreachable });
    }
    c.sending = true;
    c.send_error = None;
    c.last_send = Some(Instant::now());
    Ok(())
}

fn smtp_error(err: &SmtpError) -> SendError {
    match err {
        SmtpError::Auth => SendError::NeedsLogin,
        SmtpError::Network => SendError::Unreachable,
        SmtpError::Refused(d) if d == "badAddress" => SendError::BadAddress,
        SmtpError::Refused(d) => SendError::Refused { detail: d.chars().take(60).collect() },
    }
}

async fn deliver(a: &Account, to: &str, message: &[u8]) -> Result<(), SmtpError> {
    smtp::send(&a.servers.smtp_host, a.servers.smtp_port, &a.email, &a.password, &a.email, to, message).await
}

fn finish_send(sent: Result<(), SmtpError>) -> bool {
    match sent {
        Ok(()) => {
            ctl().sending = false;
            changed();
            true
        }
        Err(err) => send_failed(smtp_error(&err)),
    }
}

/// Enter or the Send button only: a reply to the message `id`.
#[tauri::command]
pub async fn mailbox_reply(id: String, text: String) -> bool {
    if let Err(err) = begin_send(&text) {
        return send_failed(err);
    }
    let sent = async {
        let (a, mut s) = session().await.map_err(|_| SmtpError::Network)?;
        let original = imap::body(&mut s, &id).await;
        imap::logout(&mut s).await;
        let (_, p) = original.map_err(|_| SmtpError::Network)?;
        let to = if p.reply_to.is_empty() { p.from_address.clone() } else { p.reply_to.clone() };
        let refs = (!p.references.is_empty()).then_some(p.references.as_str());
        let reply_to_id = (!p.message_id.is_empty()).then_some(p.message_id.as_str());
        let message = model::build_message(Some(&a.email), &to, &model::reply_subject(&p.subject), text.trim(), reply_to_id, refs)
            .map_err(|code| SmtpError::Refused(code.to_string()))?;
        deliver(&a, &to, &message).await
    }
    .await;
    finish_send(sent)
}

/// A new message to `to`.
#[tauri::command]
pub async fn mailbox_send(to: String, subject: String, text: String) -> bool {
    if !model::valid_address(&to) {
        return send_failed(SendError::BadAddress);
    }
    if let Err(err) = begin_send(&text) {
        return send_failed(err);
    }
    let sent = async {
        let a = account().ok_or(SmtpError::Auth)?;
        let message = model::build_message(Some(&a.email), to.trim(), &subject, text.trim(), None, None).map_err(|code| SmtpError::Refused(code.to_string()))?;
        deliver(&a, to.trim(), &message).await
    }
    .await;
    finish_send(sent)
}

// ── Commands for Settings ─────────────────────────────────────────────────────

#[tauri::command]
pub fn mailbox_settings() -> SettingsView {
    ctl().settings_view()
}

#[tauri::command]
pub fn mailbox_set_options(enabled: bool, mark_read_on_open: bool) {
    {
        let mut c = ctl();
        c.prefs.enabled = enabled;
        c.prefs.mark_read_on_open = mark_read_on_open;
        prefs::save(&c.prefs);
    }
    reconcile();
}

/// The account: provider (or "custom" with servers), address and, when it is typed, the app password.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn mailbox_save_account(
    provider: String, email: String, password: Option<String>, imap_host: String, imap_port: u16, smtp_host: String, smtp_port: u16,
) -> Result<(), String> {
    let mut next = {
        let c = ctl();
        Prefs { provider, email, imap_host, imap_port, smtp_host, smtp_port, ..c.prefs.clone() }.cleaned()
    };
    if !next.complete() {
        return Err("badAccount".into());
    }
    if next.provider != "custom" {
        next.imap_host.clear();
        next.smtp_host.clear();
    }
    if let Some(pw) = password.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()) {
        // A provider shows its app passwords in groups ("abcd efgh ijkl mnop"): the spaces are not part of it.
        let pw = if next.provider == "custom" { pw } else { pw.split_whitespace().collect::<String>() };
        if pw.chars().any(|c| c.is_control()) || pw.len() > 200 {
            return Err("badAccount".into());
        }
        crate::secrets::set_internal(PASSWORD_KEY, &pw)?;
    } else if crate::secrets::get_internal(PASSWORD_KEY).is_none() {
        return Err("badAccount".into());
    }
    {
        let mut c = ctl();
        c.prefs = next;
        prefs::save(&c.prefs);
    }
    stop(Link::Off);
    reconcile();
    Ok(())
}

/// Forgets the password and the address.
#[tauri::command]
pub fn mailbox_sign_out() {
    let _ = crate::secrets::set_internal(PASSWORD_KEY, "");
    {
        let mut c = ctl();
        c.prefs.email.clear();
        prefs::save(&c.prefs);
    }
    stop(Link::Off);
    reconcile();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smtp_errors_become_send_errors() {
        assert_eq!(smtp_error(&SmtpError::Auth), SendError::NeedsLogin);
        assert_eq!(smtp_error(&SmtpError::Network), SendError::Unreachable);
        assert_eq!(smtp_error(&SmtpError::Refused("badAddress".into())), SendError::BadAddress);
        assert_eq!(smtp_error(&SmtpError::Refused("550 no".into())), SendError::Refused { detail: "550 no".into() });
    }

    #[test]
    fn an_account_needs_an_address_and_servers() {
        assert_eq!(mailbox_save_account("gmail".into(), "nope".into(), Some("x".into()), String::new(), 993, String::new(), 465), Err("badAccount".into()));
        assert_eq!(
            mailbox_save_account("custom".into(), "me@x.org".into(), Some("pw".into()), "bad host".into(), 993, "smtp.x.org".into(), 465),
            Err("badAccount".into())
        );
    }
}
