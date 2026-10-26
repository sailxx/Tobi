// Gmail in the island (experimental): your unread mail, one message opened to read its text, a reply
// or a new message sent from the island, and the buttons that matter (mark read, archive, trash).
//
// The user's own Google OAuth client signs in through the system browser (oauth.rs); the Gmail API
// is asked every minute while the integration is on and its pill is active: otherwise there is no
// request and no timer at all. The OAuth client and the refresh token are in the credential store;
// messages stay in memory, are never logged or saved, and are forgotten when Tobi quits. Only the
// plain text of a message is shown, never its HTML: no remote content is loaded. Nothing is sent
// without the user's own click on Send.
//
// The island draws what `IslandView` says (src/views/gmail.ts), Settings what `SettingsView` says
// (src/settings/gmail.ts); both only ever see status codes, which they translate.

pub mod api;
pub mod model;
pub mod oauth;
pub mod prefs;

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use api::{ApiError, MailBody, MailItem};
use prefs::Prefs;

pub const PILL_ID: &str = "integration_gmail";
/// Credential store entries, Rust-only (secrets.rs INTERNAL_KEYS): the webview never reads them.
pub const CLIENT_ID_KEY: &str = "gmail-client-id";
pub const CLIENT_SECRET_KEY: &str = "gmail-client-secret";
pub const REFRESH_KEY: &str = "gmail-refresh-token";

const ISLAND_EVENT: &str = "gmail";
const PILL_EVENT: &str = "gmail-pill";
const SETTINGS_EVENT: &str = "gmail-settings";

const POLL: Duration = Duration::from_secs(60);
const MAX_UNREAD: usize = 15;

// ── What the pages see ────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Link {
    Off,
    /// No OAuth client id or secret yet.
    NeedsSetup,
    /// The client is there, nobody is signed in.
    NeedsLogin,
    /// The browser is open on Google's page.
    SigningIn,
    Connecting,
    Connected,
    Unreachable,
    Failed { detail: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum SendError {
    TooLong,
    TooFast,
    Empty,
    BadAddress,
    Unreachable,
    NeedsLogin,
    Refused { detail: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandView {
    pub on: bool,
    pub link: Link,
    /// Newest first.
    pub items: Vec<MailItem>,
    /// Unread messages in the whole inbox.
    pub unread: u32,
    pub opened: Option<MailBody>,
    pub sending: bool,
    pub send_error: Option<SendError>,
    pub down: bool,
    pub account: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub prefs: Prefs,
    pub client_id: Option<String>,
    pub has_secret: bool,
    pub link: Link,
    pub account: Option<String>,
    /// The last sign-in problem, as a code: denied, timeout, network, badClient, badAnswer, noCode, other.
    pub error: Option<String>,
    pub pill_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PillEvent {
    Message { name: String },
    Read,
    Reset,
}

// ── The controller ────────────────────────────────────────────────────────────

struct Ctl {
    prefs: Prefs,
    pill_active: bool,
    link: Link,
    /// Bumped at every start and stop: a task of an older generation ends quietly.
    generation: u64,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    access: Option<(String, Instant)>,
    account: Option<String>,
    items: Vec<MailItem>,
    unread: u32,
    seen: HashSet<String>,
    loaded_once: bool,
    opened: Option<MailBody>,
    sending: bool,
    send_error: Option<SendError>,
    last_send: Option<Instant>,
    down: bool,
    login_error: Option<String>,
}

static CTL: LazyLock<Mutex<Ctl>> = LazyLock::new(|| {
    Mutex::new(Ctl {
        prefs: prefs::load(),
        pill_active: false,
        link: Link::Off,
        generation: 0,
        task: None,
        access: None,
        account: None,
        items: vec![],
        unread: 0,
        seen: HashSet::new(),
        loaded_once: false,
        opened: None,
        sending: false,
        send_error: None,
        last_send: None,
        down: false,
        login_error: None,
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
            account: self.account.clone(),
        }
    }

    fn settings_view(&self) -> SettingsView {
        SettingsView {
            prefs: self.prefs.clone(),
            client_id: crate::secrets::get_internal(CLIENT_ID_KEY),
            has_secret: crate::secrets::get_internal(CLIENT_SECRET_KEY).is_some(),
            link: self.link.clone(),
            account: self.account.clone(),
            error: self.login_error.clone(),
            pill_active: self.pill_active,
        }
    }
}

/// Both pages redraw from what changed. Never called with the lock held.
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

fn client_credentials() -> Option<(String, String)> {
    let id = crate::secrets::get_internal(CLIENT_ID_KEY)?;
    let secret = crate::secrets::get_internal(CLIENT_SECRET_KEY)?;
    (!id.trim().is_empty() && !secret.trim().is_empty()).then(|| (id.trim().to_string(), secret.trim().to_string()))
}

// ── Starting and stopping ─────────────────────────────────────────────────────

/// Called when the app starts.
pub fn start(app: &AppHandle, active_integrations: &[String]) {
    let _ = APP.set(app.clone());
    ctl().pill_active = active_integrations.iter().any(|p| p == PILL_ID);
    reconcile();
}

/// Called when the active pills change.
pub fn sync(active_integrations: &[String]) {
    ctl().pill_active = active_integrations.iter().any(|p| p == PILL_ID);
    reconcile();
}

/// Called when Tobi quits: the polling stops, the mail is forgotten.
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
            let mut c = ctl();
            if !matches!(c.link, Link::SigningIn) {
                c.link = Link::Off;
            }
            drop(c);
            changed();
        }
        (true, true) => changed(),
    }
}

fn stop(link: Link) {
    let task = {
        let mut c = ctl();
        c.generation += 1;
        c.access = None;
        c.account = None;
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
    if client_credentials().is_none() {
        ctl().link = Link::NeedsSetup;
        changed();
        return;
    }
    if crate::secrets::get_internal(REFRESH_KEY).is_none() {
        ctl().link = Link::NeedsLogin;
        changed();
        return;
    }
    let generation = {
        let mut c = ctl();
        c.generation += 1;
        c.link = Link::Connecting;
        c.login_error = None;
        c.generation
    };
    changed();
    let task = tauri::async_runtime::spawn(run(generation));
    ctl().task = Some(task);
}

fn current(generation: u64) -> bool {
    ctl().generation == generation
}

/// A valid access token: the cached one, or a fresh one from the refresh token.
async fn token() -> Result<String, ApiError> {
    {
        let c = ctl();
        if let Some((t, expiry)) = &c.access {
            if *expiry > Instant::now() + Duration::from_secs(60) {
                return Ok(t.clone());
            }
        }
    }
    let Some((id, secret)) = client_credentials() else { return Err(ApiError::Unauthorized) };
    let Some(refresh) = crate::secrets::get_internal(REFRESH_KEY) else { return Err(ApiError::Unauthorized) };
    match oauth::refresh(&id, &secret, &refresh).await {
        Ok(t) => {
            ctl().access = Some((t.access_token.clone(), Instant::now() + Duration::from_secs(t.expires_in.max(120))));
            Ok(t.access_token)
        }
        Err(reason) if reason == "invalid_grant" || reason == "invalid_client" => {
            // Revoked, expired (a test-mode app's tokens last a week) or the client was deleted.
            let _ = crate::secrets::set_internal(REFRESH_KEY, "");
            Err(ApiError::Unauthorized)
        }
        Err(reason) if reason == "network" => Err(ApiError::Network),
        Err(reason) => Err(ApiError::Other(reason)),
    }
}

/// What a failed call does to the link.
fn failed(generation: u64, err: &ApiError) {
    if !current(generation) {
        return;
    }
    {
        let mut c = ctl();
        c.down = true;
        c.link = match err {
            ApiError::Unauthorized => Link::NeedsLogin,
            ApiError::Forbidden => Link::Failed { detail: "forbidden".into() },
            ApiError::RateLimited => Link::Failed { detail: "rate".into() },
            ApiError::Network => Link::Unreachable,
            ApiError::Other(d) => Link::Failed { detail: d.chars().take(40).collect() },
        };
        if matches!(err, ApiError::Unauthorized) {
            c.access = None;
        }
    }
    changed();
}

async fn run(generation: u64) {
    loop {
        if !current(generation) {
            return;
        }
        match poll(generation).await {
            Ok(()) => {}
            Err(ApiError::Unauthorized) => {
                failed(generation, &ApiError::Unauthorized);
                return; // signing in again starts a new run
            }
            Err(err) => failed(generation, &err),
        }
        tokio::time::sleep(POLL).await;
    }
}

/// One look at the inbox: the unread count, the newest unread messages, what is new.
async fn poll(generation: u64) -> Result<(), ApiError> {
    let token = token().await?;
    if ctl().account.is_none() {
        let email = api::profile(&token).await?;
        if current(generation) {
            ctl().account = Some(email);
        }
    }
    let unread = api::inbox_unread(&token).await?;
    let ids = api::list_unread(&token, MAX_UNREAD).await?;
    let known: HashSet<String> = ctl().items.iter().map(|i| i.id.clone()).collect();
    let mut fresh = vec![];
    for id in &ids {
        if !known.contains(id) {
            fresh.push(api::get_item(&token, id).await?);
        }
    }
    if !current(generation) {
        return Ok(());
    }
    let announce = {
        let mut c = ctl();
        let first = !c.loaded_once;
        let mut items: Vec<MailItem> = c.items.iter().filter(|i| ids.contains(&i.id)).cloned().collect();
        let newcomers: Vec<MailItem> = fresh.into_iter().filter(|i| !c.seen.contains(&i.id)).collect();
        for item in &newcomers {
            c.seen.insert(item.id.clone());
        }
        items.extend(newcomers.iter().cloned());
        items.sort_by(|a, b| b.date.cmp(&a.date));
        c.items = items;
        c.unread = unread;
        c.loaded_once = true;
        c.link = Link::Connected;
        c.down = false;
        // The first look only fills the list: the inbox's backlog is not news.
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
pub fn gmail_island() -> IslandView {
    ctl().island_view()
}

/// Looks at the inbox now (the island was opened on the pill, or the user asked).
#[tauri::command]
pub async fn gmail_refresh() {
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

/// A message is opened: its text is fetched and, if allowed, it is marked read.
#[tauri::command]
pub async fn gmail_open(id: String) -> bool {
    let Ok(token) = token().await else { return false };
    let Ok(mut body) = api::get_body(&token, &id).await else { return false };
    let mark = ctl().prefs.mark_read_on_open && body.unread;
    if mark && api::modify(&token, &id, &[], &["UNREAD"]).await.is_ok() {
        body.unread = false;
        let mut c = ctl();
        c.items.retain(|i| i.id != id);
        c.unread = c.unread.saturating_sub(1);
        drop(c);
        pill(PillEvent::Read);
    }
    {
        let mut c = ctl();
        c.opened = Some(body);
        c.send_error = None;
    }
    changed();
    true
}

#[tauri::command]
pub fn gmail_close() {
    ctl().opened = None;
    changed();
}

/// Marks a message read, archives it (out of the inbox) or trashes it: it leaves the list.
async fn label_change(id: String, add: &'static [&'static str], remove: &'static [&'static str], trash: bool) -> bool {
    let Ok(token) = token().await else { return false };
    let done = if trash { api::trash(&token, &id).await } else { api::modify(&token, &id, add, remove).await };
    if done.is_err() {
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
pub async fn gmail_mark_read(id: String) -> bool {
    label_change(id, &[], &["UNREAD"], false).await
}

#[tauri::command]
pub async fn gmail_archive(id: String) -> bool {
    label_change(id, &[], &["INBOX", "UNREAD"], false).await
}

#[tauri::command]
pub async fn gmail_trash(id: String) -> bool {
    label_change(id, &[], &[], true).await
}

/// Checks what is about to be sent: something to say, not too long, not too fast.
pub fn check_send(text: &str, last: Option<Instant>, now: Instant) -> Option<SendError> {
    if text.trim().is_empty() {
        return Some(SendError::Empty);
    }
    if text.chars().count() > model::MAX_REPLY {
        return Some(SendError::TooLong);
    }
    if last.is_some_and(|t| now.duration_since(t) < Duration::from_secs(3)) {
        return Some(SendError::TooFast);
    }
    None
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

/// Begins a send: the checks, the flag. None when it may go on.
fn begin_send(text: &str) -> Result<(), SendError> {
    let mut c = ctl();
    if let Some(err) = check_send(text, c.last_send, Instant::now()) {
        return Err(err);
    }
    if c.link != Link::Connected {
        return Err(if matches!(c.link, Link::NeedsLogin) { SendError::NeedsLogin } else { SendError::Unreachable });
    }
    c.sending = true;
    c.send_error = None;
    c.last_send = Some(Instant::now());
    Ok(())
}

fn send_error_of(err: &ApiError) -> SendError {
    match err {
        ApiError::Unauthorized => SendError::NeedsLogin,
        ApiError::Network => SendError::Unreachable,
        ApiError::RateLimited => SendError::TooFast,
        ApiError::Forbidden => SendError::Refused { detail: "forbidden".into() },
        ApiError::Other(d) => SendError::Refused { detail: d.chars().take(60).collect() },
    }
}

/// Enter or the Send button only: a reply to the message `id`, in its conversation.
#[tauri::command]
pub async fn gmail_reply(id: String, text: String) -> bool {
    if let Err(err) = begin_send(&text) {
        return send_failed(err);
    }
    let sent = async {
        let token = token().await?;
        let h = api::reply_headers(&token, &id).await?;
        let raw = model::build_raw(&h.to, &model::reply_subject(&h.subject), text.trim(), Some(&h.message_id), Some(&h.references))
            .map_err(|code| ApiError::Other(code.to_string()))?;
        api::send(&token, &raw, Some(&h.thread_id)).await
    }
    .await;
    finish_send(sent)
}

/// A new message to `to`.
#[tauri::command]
pub async fn gmail_send(to: String, subject: String, text: String) -> bool {
    if !model::valid_address(&to) {
        return send_failed(SendError::BadAddress);
    }
    if let Err(err) = begin_send(&text) {
        return send_failed(err);
    }
    let sent = async {
        let token = token().await?;
        let raw = model::build_raw(to.trim(), &subject, text.trim(), None, None).map_err(|code| ApiError::Other(code.to_string()))?;
        api::send(&token, &raw, None).await
    }
    .await;
    finish_send(sent)
}

fn finish_send(sent: Result<(), ApiError>) -> bool {
    match sent {
        Ok(()) => {
            ctl().sending = false;
            changed();
            true
        }
        Err(err) => send_failed(send_error_of(&err)),
    }
}

// ── Commands for Settings ─────────────────────────────────────────────────────

#[tauri::command]
pub fn gmail_settings() -> SettingsView {
    ctl().settings_view()
}

#[tauri::command]
pub fn gmail_set_options(enabled: bool, mark_read_on_open: bool) {
    {
        let mut c = ctl();
        c.prefs.enabled = enabled;
        c.prefs.mark_read_on_open = mark_read_on_open;
        prefs::save(&c.prefs);
    }
    reconcile();
}

/// The OAuth client's id and secret from Google Cloud Console (a "Desktop app" client).
#[tauri::command]
pub fn gmail_save_client(client_id: String, client_secret: String) -> Result<(), String> {
    let id = client_id.trim();
    let secret = client_secret.trim();
    if !id.ends_with(".apps.googleusercontent.com") || id.len() > 200 || id.chars().any(|c| c.is_whitespace()) {
        return Err("badClient".into());
    }
    if secret.len() < 10 || secret.len() > 200 || secret.chars().any(|c| c.is_whitespace()) {
        return Err("badClient".into());
    }
    crate::secrets::set_internal(CLIENT_ID_KEY, id)?;
    crate::secrets::set_internal(CLIENT_SECRET_KEY, secret)?;
    // A new client cannot use the old tokens.
    let _ = crate::secrets::set_internal(REFRESH_KEY, "");
    stop(Link::Off);
    reconcile();
    Ok(())
}

fn sign_in_failed(reason: &str) {
    {
        let mut c = ctl();
        c.login_error = Some(match reason {
            "access_denied" | "denied" => "denied",
            "timeout" => "timeout",
            "network" => "network",
            "invalid_client" | "unauthorized_client" => "badClient",
            "badAnswer" => "badAnswer",
            "noCode" => "noCode",
            _ => "other",
        }
        .to_string());
        c.link = Link::NeedsLogin;
    }
    changed();
}

/// Opens Google's page in the browser and waits (three minutes) for it to come back.
#[tauri::command]
pub async fn gmail_sign_in() -> Result<(), String> {
    let Some((id, secret)) = client_credentials() else { return Err("badClient".into()) };
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let pkce = oauth::pkce()?;
    let state = oauth::random_state()?;
    {
        let mut c = ctl();
        c.login_error = None;
        c.link = Link::SigningIn;
    }
    changed();
    crate::platform::open_url(&oauth::auth_url(&id, &redirect, &pkce.challenge, &state));
    tauri::async_runtime::spawn(async move {
        let code = match oauth::wait_for_code(listener, &state, oauth::WAIT).await {
            Ok(code) => code,
            Err(reason) => return sign_in_failed(&reason),
        };
        match oauth::exchange(&id, &secret, &code, &pkce.verifier, &redirect).await {
            Ok(tokens) => {
                let Some(refresh) = tokens.refresh_token else { return sign_in_failed("noCode") };
                if crate::secrets::set_internal(REFRESH_KEY, &refresh).is_err() {
                    return sign_in_failed("other");
                }
                ctl().access = Some((tokens.access_token, Instant::now() + Duration::from_secs(tokens.expires_in.max(120))));
                stop(Link::Connecting);
                reconcile();
            }
            Err(reason) => sign_in_failed(&reason),
        }
    });
    Ok(())
}

/// Signs out: Google is told to forget the token, and everything kept here goes.
#[tauri::command]
pub async fn gmail_sign_out() {
    if let Some(refresh) = crate::secrets::get_internal(REFRESH_KEY) {
        oauth::revoke(&refresh).await;
    }
    let _ = crate::secrets::set_internal(REFRESH_KEY, "");
    stop(Link::NeedsLogin);
    reconcile();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_sent_is_checked_first() {
        let now = Instant::now();
        assert_eq!(check_send("  ", None, now), Some(SendError::Empty));
        assert_eq!(check_send(&"x".repeat(model::MAX_REPLY + 1), None, now), Some(SendError::TooLong));
        assert_eq!(check_send("ok", Some(now), now), Some(SendError::TooFast));
        assert_eq!(check_send("ok", Some(now), now + Duration::from_secs(4)), None);
        assert_eq!(check_send("ok", None, now), None);
    }

    #[test]
    fn api_errors_become_send_errors() {
        assert_eq!(send_error_of(&ApiError::Unauthorized), SendError::NeedsLogin);
        assert_eq!(send_error_of(&ApiError::Network), SendError::Unreachable);
        assert_eq!(send_error_of(&ApiError::RateLimited), SendError::TooFast);
    }

    #[test]
    fn the_client_form_refuses_what_is_not_a_google_client() {
        assert_eq!(gmail_save_client("nope".into(), "0123456789abcdef".into()), Err("badClient".into()));
        assert_eq!(gmail_save_client("1-x.apps.googleusercontent.com".into(), "short".into()), Err("badClient".into()));
        assert_eq!(gmail_save_client("1 x.apps.googleusercontent.com".into(), "0123456789abcdef".into()), Err("badClient".into()));
    }
}
