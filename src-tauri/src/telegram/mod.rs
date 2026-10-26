// Telegram in the island (experimental): your own account, through Telegram's MTProto (the
// grammers client), like the official apps. Shows your unread chats, opens one to read its last
// messages and lets you reply, with the same card as WhatsApp's.
//
// The user brings their own API id and hash (my.telegram.org, free) and signs in with their phone
// number, the code Telegram sends and, if set, their cloud password. The API id and hash and the
// authorization keys live in the credential store (store.rs); messages stay in memory only, are
// never logged or saved, and are forgotten when Tobi quits or the integration is turned off. Runs
// only while the integration is on and its pill is active: otherwise there is no connection and
// no timer at all.
//
// The island draws what `IslandView` says (src/views/telegram.ts), Settings what `SettingsView`
// says (src/settings/telegram.ts); both only ever see status codes, which they translate.

pub mod prefs;
pub mod store;

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use grammers_client::message::{InputMessage, Message};
use grammers_client::peer::Peer;
use grammers_client::update::Update;
use grammers_client::client::{LoginToken, PasswordToken};
use grammers_client::{tl, Client, SenderPool, SignInError};
use grammers_session::storages::MemorySession;
use grammers_session::types::PeerRef;
use grammers_session::updates::UpdatesLike;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use prefs::Prefs;

pub const PILL_ID: &str = "integration_telegram";
/// Credential store entries, Rust-only (secrets.rs INTERNAL_KEYS): the webview never reads them.
pub const API_ID_KEY: &str = "telegram-api-id";
pub const API_HASH_KEY: &str = "telegram-api-hash";

const ISLAND_EVENT: &str = "telegram";
const PILL_EVENT: &str = "telegram-pill";
const SETTINGS_EVENT: &str = "telegram-settings";

/// How many chats the card lists, and how many messages an opened chat shows.
const MAX_CHATS: usize = 25;
const MAX_MESSAGES: usize = 10;
const MAX_KEPT: usize = 30;
pub const MAX_REPLY: usize = 4096;

// ── What the pages see ────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Link {
    Off,
    /// No API id or hash yet.
    NeedsSetup,
    /// The credentials are there, no account is signed in.
    NeedsLogin,
    Connecting,
    Connected,
    Unreachable,
    Failed { detail: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Media {
    None,
    Image,
    Video,
    Sticker,
    Location,
    Contact,
    Other,
    Audio { seconds: Option<u32> },
    Voice { seconds: Option<u32> },
    Document { name: Option<String> },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Msg {
    pub id: String,
    pub chat: String,
    pub sender: String,
    pub sender_name: String,
    pub text: String,
    pub media: Media,
    /// Unix ms.
    pub date: i64,
    pub from_me: bool,
    pub mentions_me: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub name: String,
    pub is_group: bool,
    /// Oldest first.
    pub messages: Vec<Msg>,
    pub unread: u32,
    pub last_activity: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum SendError {
    TooLong,
    TooFast,
    Unreachable,
    NeedsLogin,
    Refused { detail: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandView {
    pub on: bool,
    pub link: Link,
    /// Newest first, filters applied.
    pub conversations: Vec<Chat>,
    pub unread: u32,
    pub sending: bool,
    pub send_error: Option<SendError>,
    pub down: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginView {
    /// "none", "code" (a code was sent) or "password" (the cloud password is needed).
    pub stage: &'static str,
    /// The password's hint, if the account set one.
    pub hint: Option<String>,
    /// The last login problem, as a code: badPhone, badApi, invalidCode, invalidPassword, flood, signUp, other.
    pub error: Option<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoredChat {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub prefs: Prefs,
    pub api_id: Option<String>,
    pub has_api_hash: bool,
    pub link: Link,
    pub login: LoginView,
    pub me: Option<String>,
    pub pill_active: bool,
    pub ignored: Vec<IgnoredChat>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PillEvent {
    Message { name: String },
    Read,
    Reset,
}

// ── The chats kept in memory ──────────────────────────────────────────────────

/// Chats and their last messages, with the rules that do not need the network.
#[derive(Default)]
pub struct Chats {
    pub map: HashMap<String, Chat>,
}

impl Chats {
    /// Adds a message to its chat (created if unknown); returns whether it was new.
    pub fn add(&mut self, chat: &str, name: &str, is_group: bool, msg: Msg, unread: bool) -> bool {
        let entry = self.map.entry(chat.to_string()).or_insert_with(|| Chat {
            id: chat.to_string(),
            name: name.to_string(),
            is_group,
            messages: vec![],
            unread: 0,
            last_activity: 0,
        });
        if !name.is_empty() {
            entry.name = name.to_string();
        }
        if entry.messages.iter().any(|m| m.id == msg.id) {
            return false;
        }
        entry.last_activity = entry.last_activity.max(msg.date);
        if unread {
            entry.unread = entry.unread.saturating_add(1);
        }
        entry.messages.push(msg);
        entry.messages.sort_by_key(|m| m.date);
        let excess = entry.messages.len().saturating_sub(MAX_KEPT);
        entry.messages.drain(..excess);
        true
    }

    /// The chats to show, newest first: not ignored; a group or channel only with something unread.
    pub fn visible(&self, prefs: &Prefs) -> Vec<Chat> {
        let mut chats: Vec<Chat> = self
            .map
            .values()
            .filter(|c| !prefs.ignored.contains(&c.id))
            .filter(|c| !(prefs.mute_groups && c.is_group && c.unread == 0))
            .cloned()
            .collect();
        chats.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));
        chats.truncate(MAX_CHATS);
        chats
    }

    pub fn unread(&self, prefs: &Prefs) -> u32 {
        self.visible(prefs).iter().map(|c| c.unread).sum()
    }

    pub fn mark_read(&mut self, chat: &str) {
        if let Some(c) = self.map.get_mut(chat) {
            c.unread = 0;
        }
    }
}

// ── The controller ────────────────────────────────────────────────────────────

enum Stage {
    None,
    Code(LoginToken),
    Password(PasswordToken),
}

struct Online {
    client: Client,
    session: Arc<MemorySession>,
}

struct Ctl {
    prefs: Prefs,
    pill_active: bool,
    link: Link,
    /// Bumped at every start and stop: a task of an older generation ends quietly.
    generation: u64,
    online: Option<Online>,
    updates: Option<mpsc::Receiver<UpdatesLike>>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Drives the connection; it outlives `task`, which ends while the account waits for its login.
    runner: Option<tauri::async_runtime::JoinHandle<()>>,
    stage: Stage,
    login_error: Option<&'static str>,
    phone: String,
    me: Option<String>,
    chats: Chats,
    peers: HashMap<String, PeerRef>,
    open: Option<String>,
    sending: bool,
    send_error: Option<SendError>,
    down: bool,
    last_send: Option<Instant>,
    has_api: bool,
}

static CTL: LazyLock<Mutex<Ctl>> = LazyLock::new(|| {
    Mutex::new(Ctl {
        prefs: prefs::load(),
        pill_active: false,
        link: Link::Off,
        generation: 0,
        online: None,
        updates: None,
        task: None,
        runner: None,
        stage: Stage::None,
        login_error: None,
        phone: String::new(),
        me: None,
        chats: Chats::default(),
        peers: HashMap::new(),
        open: None,
        sending: false,
        send_error: None,
        down: false,
        last_send: None,
        has_api: false,
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
            on: self.online.is_some() && self.link == Link::Connected,
            link: self.link.clone(),
            conversations: self.chats.visible(&self.prefs),
            unread: self.chats.unread(&self.prefs),
            sending: self.sending,
            send_error: self.send_error.clone(),
            down: self.down,
        }
    }

    fn login_view(&self) -> LoginView {
        let (stage, hint) = match &self.stage {
            Stage::None => ("none", None),
            Stage::Code(_) => ("code", None),
            Stage::Password(p) => ("password", p.hint().map(str::to_string)),
        };
        LoginView { stage, hint, error: self.login_error }
    }

    fn settings_view(&self) -> SettingsView {
        SettingsView {
            prefs: self.prefs.clone(),
            api_id: crate::secrets::get_internal(API_ID_KEY),
            has_api_hash: crate::secrets::get_internal(API_HASH_KEY).is_some(),
            link: self.link.clone(),
            login: self.login_view(),
            me: self.me.clone(),
            pill_active: self.pill_active,
            ignored: self
                .prefs
                .ignored
                .iter()
                .map(|id| IgnoredChat { id: id.clone(), name: self.chats.map.get(id).map(|c| c.name.clone()).unwrap_or_else(|| id.clone()) })
                .collect(),
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

fn credentials() -> Option<(i32, String)> {
    let id = crate::secrets::get_internal(API_ID_KEY)?.trim().parse::<i32>().ok()?;
    let hash = crate::secrets::get_internal(API_HASH_KEY)?;
    (id > 0 && !hash.trim().is_empty()).then(|| (id, hash.trim().to_string()))
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

/// Called when Tobi quits: the connection closes, the chats are forgotten.
pub fn shutdown() {
    stop(Link::Off);
}

/// Runs, or stops, to match the switch and the pill.
fn reconcile() {
    let (run, running) = {
        let c = ctl();
        (c.should_run(), c.online.is_some() || c.task.is_some())
    };
    match (run, running) {
        (true, false) => connect(),
        (false, true) => stop(Link::Off),
        (false, false) => {
            let mut c = ctl();
            c.link = Link::Off;
            drop(c);
            changed();
        }
        (true, true) => changed(),
    }
}

fn stop(link: Link) {
    let (task, runner, online) = {
        let mut c = ctl();
        c.generation += 1;
        c.updates = None;
        c.stage = Stage::None;
        c.chats = Chats::default();
        c.peers.clear();
        c.open = None;
        c.me = None;
        c.sending = false;
        c.send_error = None;
        c.down = false;
        c.link = link;
        (c.task.take(), c.runner.take(), c.online.take())
    };
    if let Some(online) = online {
        store::save(&online.session);
        online.client.disconnect();
    }
    if let Some(task) = task {
        task.abort();
    }
    if let Some(runner) = runner {
        runner.abort();
    }
    pill(PillEvent::Reset);
    changed();
}

fn connect() {
    let Some((api_id, _)) = credentials() else {
        let mut c = ctl();
        c.link = Link::NeedsSetup;
        c.has_api = false;
        drop(c);
        changed();
        return;
    };
    let generation = {
        let mut c = ctl();
        c.generation += 1;
        c.link = Link::Connecting;
        c.login_error = None;
        c.has_api = true;
        c.generation
    };
    changed();
    let session = Arc::new(store::load());
    let SenderPool { runner, handle, updates } = SenderPool::new(Arc::clone(&session), api_id);
    let client = Client::new(handle);
    let runner_task = tauri::async_runtime::spawn(runner.run());
    {
        let mut c = ctl();
        c.online = Some(Online { client: client.clone(), session: Arc::clone(&session) });
        c.updates = Some(updates);
        c.runner = Some(runner_task);
    }
    let task = tauri::async_runtime::spawn(run(generation, client, session));
    ctl().task = Some(task);
}

fn current(generation: u64) -> bool {
    ctl().generation == generation
}

/// Checks the account, then loads the chats and follows the updates until stopped.
async fn run(generation: u64, client: Client, session: Arc<MemorySession>) {
    match client.is_authorized().await {
        Ok(true) => {}
        Ok(false) => {
            if current(generation) {
                ctl().link = Link::NeedsLogin;
                changed();
            }
            return; // the login commands continue with `after_login`
        }
        Err(err) => {
            fail(generation, err.to_string());
            return;
        }
    }
    online(generation, client, session).await;
}

fn fail(generation: u64, detail: String) {
    if !current(generation) {
        return;
    }
    let mut c = ctl();
    let flood = detail.contains("FLOOD");
    c.link = if flood { Link::Failed { detail: "flood".into() } } else { Link::Unreachable };
    c.down = true;
    drop(c);
    crate::log::line(format!("telegram: {}", detail.chars().take(80).collect::<String>()));
    changed();
}

/// Signed in: the account's name, the chats, then the live updates.
async fn online(generation: u64, client: Client, session: Arc<MemorySession>) {
    store::save(&session);
    if let Ok(me) = client.get_me().await {
        if current(generation) {
            ctl().me = Some(me.full_name());
        }
    }
    if let Err(err) = load_chats(generation, &client).await {
        fail(generation, err.to_string());
        return;
    }
    if !current(generation) {
        return;
    }
    let updates = ctl().updates.take();
    {
        let mut c = ctl();
        c.link = Link::Connected;
        c.down = false;
    }
    changed();
    let Some(updates) = updates else { return };
    let mut stream = match client.stream_updates(updates, Default::default()).await {
        Ok(s) => s,
        Err(err) => {
            fail(generation, err.to_string());
            return;
        }
    };
    loop {
        match stream.next().await {
            Ok(update) => {
                if !current(generation) {
                    return;
                }
                handle_update(update).await;
            }
            Err(err) => {
                fail(generation, err.to_string());
                return;
            }
        }
    }
}

async fn load_chats(generation: u64, client: &Client) -> Result<(), grammers_client::InvocationError> {
    let mut dialogs = client.iter_dialogs();
    let mut seen = 0;
    while let Some(dialog) = dialogs.next().await? {
        if !current(generation) {
            return Ok(());
        }
        seen += 1;
        if seen > MAX_CHATS * 2 {
            break;
        }
        let (unread, archived, muted) = dialog_flags(&dialog.raw);
        if archived {
            continue;
        }
        let peer = dialog.peer();
        let id = chat_id(peer);
        let Some(last) = dialog.last_message.as_ref() else { continue };
        let msg = map_message(last, &id);
        let mut c = ctl();
        c.peers.insert(id.clone(), dialog.peer_ref());
        c.chats.add(&id, &peer_name(peer), is_group(peer), msg, false);
        if let Some(chat) = c.chats.map.get_mut(&id) {
            chat.unread = if muted { 0 } else { unread };
        }
        if c.chats.map.len() >= MAX_CHATS {
            break;
        }
    }
    Ok(())
}

fn dialog_flags(raw: &tl::enums::Dialog) -> (u32, bool, bool) {
    match raw {
        tl::enums::Dialog::Dialog(d) => {
            let muted = match &d.notify_settings {
                tl::enums::PeerNotifySettings::Settings(s) => s.mute_until.is_some_and(|until| i64::from(until) > now_secs()),
            };
            (d.unread_count.max(0) as u32, d.folder_id == Some(1), muted)
        }
        _ => (0, true, false),
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

async fn handle_update(update: Update) {
    let Update::NewMessage(message) = update else { return };
    let peer_id = message.peer_id().bot_api_dialog_id_unchecked().to_string();
    let Ok(Some(peer_ref)) = message.peer_ref().await else { return };
    let (name, group) = match message.peer() {
        Some(peer) => (peer_name(peer), is_group(peer)),
        None => (String::new(), false),
    };
    let msg = map_message(&message, &peer_id);
    let (announce, mark_read, client) = {
        let mut c = ctl();
        c.peers.insert(peer_id.clone(), peer_ref);
        let open = c.open.as_deref() == Some(peer_id.as_str());
        let incoming = !message.outgoing();
        let ignored = c.prefs.ignored.contains(&peer_id);
        let quiet = group && c.prefs.mute_groups && !message.mentioned();
        let added = c.chats.add(&peer_id, &name, group, msg.clone(), incoming && !open);
        let announce = added && incoming && !open && !ignored && !quiet;
        let mark_read = added && incoming && open && c.prefs.mark_read_on_open;
        (announce.then(|| c.chats.map.get(&peer_id).map(|x| x.name.clone()).unwrap_or_default()), mark_read, c.online.as_ref().map(|o| o.client.clone()))
    };
    if mark_read {
        if let Some(client) = client {
            let _ = client.mark_as_read(peer_ref).await;
        }
    }
    if let Some(name) = announce {
        pill(PillEvent::Message { name });
    }
    changed();
}

// ── Telegram's types as the pages see them ────────────────────────────────────

fn chat_id(peer: &Peer) -> String {
    peer.id().bot_api_dialog_id_unchecked().to_string()
}

fn is_group(peer: &Peer) -> bool {
    !matches!(peer, Peer::User(_))
}

fn peer_name(peer: &Peer) -> String {
    match peer {
        Peer::User(u) => {
            let n = u.full_name();
            if n.trim().is_empty() { u.username().map(|x| format!("@{x}")).unwrap_or_default() } else { n }
        }
        other => other.name().unwrap_or_default().to_string(),
    }
}

fn media_of(m: &Message) -> Media {
    use grammers_client::media::Media as M;
    match m.media() {
        None => Media::None,
        Some(M::Photo(_)) => Media::Image,
        Some(M::Sticker(_)) => Media::Sticker,
        Some(M::Contact(_)) => Media::Contact,
        Some(M::Geo(_) | M::Venue(_) | M::GeoLive(_)) => Media::Location,
        Some(M::Document(d)) => {
            let mime = d.mime_type().unwrap_or("");
            let seconds = d.duration().map(|s| s.round() as u32);
            if mime.starts_with("video/") {
                Media::Video
            } else if mime.starts_with("image/") {
                Media::Image
            } else if mime == "audio/ogg" {
                Media::Voice { seconds }
            } else if mime.starts_with("audio/") {
                Media::Audio { seconds }
            } else {
                Media::Document { name: d.name().map(str::to_string) }
            }
        }
        Some(_) => Media::Other,
    }
}

fn map_message(m: &Message, chat: &str) -> Msg {
    Msg {
        id: m.id().to_string(),
        chat: chat.to_string(),
        sender: m.sender_id().map(|p| p.bot_api_dialog_id_unchecked().to_string()).unwrap_or_default(),
        sender_name: m.sender().map(peer_name).unwrap_or_default(),
        text: m.text().to_string(),
        media: media_of(m),
        date: m.date().as_millisecond(),
        from_me: m.outgoing(),
        mentions_me: m.mentioned(),
    }
}

// ── Commands for the island ───────────────────────────────────────────────────

#[tauri::command]
pub fn telegram_island() -> IslandView {
    ctl().island_view()
}

/// A chat opens: its last messages are fetched and, if allowed, it is marked as read.
#[tauri::command]
pub async fn telegram_open(chat: String) {
    let (client, peer, mark) = {
        let mut c = ctl();
        c.open = Some(chat.clone());
        c.send_error = None;
        (c.online.as_ref().map(|o| o.client.clone()), c.peers.get(&chat).copied(), c.prefs.mark_read_on_open)
    };
    let (Some(client), Some(peer)) = (client, peer) else { return };
    let mut iter = client.iter_messages(peer).limit(MAX_MESSAGES);
    let mut fetched = vec![];
    while let Ok(Some(m)) = iter.next().await {
        fetched.push(map_message(&m, &chat));
    }
    {
        let mut c = ctl();
        let (name, group) = c.chats.map.get(&chat).map(|x| (x.name.clone(), x.is_group)).unwrap_or_default();
        for m in fetched {
            c.chats.add(&chat, &name, group, m, false);
        }
        if mark {
            c.chats.mark_read(&chat);
        }
    }
    if mark {
        let _ = client.mark_as_read(peer).await;
        pill(PillEvent::Read);
    }
    changed();
}

#[tauri::command]
pub fn telegram_close(chat: String) {
    let mut c = ctl();
    if c.open.as_deref() == Some(chat.as_str()) {
        c.open = None;
    }
}

/// Checks a reply before it leaves: not empty, not too long, not too fast.
pub fn check_reply(text: &str, last: Option<Instant>, now: Instant) -> Option<SendError> {
    if text.trim().is_empty() {
        return Some(SendError::Refused { detail: "empty".into() });
    }
    if text.chars().count() > MAX_REPLY {
        return Some(SendError::TooLong);
    }
    if last.is_some_and(|t| now.duration_since(t) < Duration::from_secs(1)) {
        return Some(SendError::TooFast);
    }
    None
}

#[tauri::command]
pub async fn telegram_send(chat: String, text: String) -> bool {
    let (client, peer) = {
        let mut c = ctl();
        if let Some(err) = check_reply(&text, c.last_send, Instant::now()) {
            c.send_error = Some(err);
            drop(c);
            changed();
            return false;
        }
        let Some(client) = c.online.as_ref().map(|o| o.client.clone()).filter(|_| c.link == Link::Connected) else {
            c.send_error = Some(if matches!(c.link, Link::NeedsLogin) { SendError::NeedsLogin } else { SendError::Unreachable });
            drop(c);
            changed();
            return false;
        };
        let Some(peer) = c.peers.get(&chat).copied() else {
            c.send_error = Some(SendError::Refused { detail: "unknown chat".into() });
            drop(c);
            changed();
            return false;
        };
        c.sending = true;
        c.send_error = None;
        c.last_send = Some(Instant::now());
        (client, peer)
    };
    changed();
    let sent = client.send_message(peer, InputMessage::new().text(text.trim())).await;
    let ok = {
        let mut c = ctl();
        c.sending = false;
        match sent {
            Ok(m) => {
                let msg = map_message(&m, &chat);
                let (name, group) = c.chats.map.get(&chat).map(|x| (x.name.clone(), x.is_group)).unwrap_or_default();
                c.chats.add(&chat, &name, group, msg, false);
                c.chats.mark_read(&chat);
                true
            }
            Err(err) => {
                let detail = err.to_string();
                c.send_error = Some(if detail.contains("FLOOD") { SendError::TooFast } else { SendError::Refused { detail: detail.chars().take(60).collect() } });
                false
            }
        }
    };
    changed();
    ok
}

#[tauri::command]
pub fn telegram_ignore(chat: String) {
    {
        let mut c = ctl();
        if !c.prefs.ignored.contains(&chat) {
            c.prefs.ignored.push(chat);
        }
        c.prefs = c.prefs.clone().cleaned();
        prefs::save(&c.prefs);
    }
    changed();
}

#[tauri::command]
pub fn telegram_unignore(chat: String) {
    {
        let mut c = ctl();
        c.prefs.ignored.retain(|x| *x != chat);
        prefs::save(&c.prefs);
    }
    changed();
}

// ── Commands for Settings ─────────────────────────────────────────────────────

#[tauri::command]
pub fn telegram_settings() -> SettingsView {
    ctl().settings_view()
}

#[tauri::command]
pub fn telegram_set_options(enabled: bool, mute_groups: bool, mark_read_on_open: bool) {
    {
        let mut c = ctl();
        c.prefs.enabled = enabled;
        c.prefs.mute_groups = mute_groups;
        c.prefs.mark_read_on_open = mark_read_on_open;
        prefs::save(&c.prefs);
    }
    reconcile();
}

/// The API id and hash from my.telegram.org. Rust keeps them; the page only ever learns the id.
#[tauri::command]
pub fn telegram_save_api(api_id: String, api_hash: String) -> Result<(), String> {
    let id = api_id.trim();
    let hash = api_hash.trim();
    if id.parse::<i32>().map(|n| n <= 0).unwrap_or(true) {
        return Err("badApi".into());
    }
    if hash.len() < 16 || hash.len() > 64 || !hash.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("badApi".into());
    }
    crate::secrets::set_internal(API_ID_KEY, id)?;
    crate::secrets::set_internal(API_HASH_KEY, hash)?;
    // New credentials: start over.
    stop(Link::Off);
    reconcile();
    Ok(())
}

fn login_failed(code: &'static str) {
    ctl().login_error = Some(code);
    changed();
}

fn error_code(detail: &str) -> &'static str {
    if detail.contains("PHONE_NUMBER_INVALID") || detail.contains("PHONE_NUMBER_BANNED") {
        "badPhone"
    } else if detail.contains("API_ID_INVALID") {
        "badApi"
    } else if detail.contains("FLOOD") {
        "flood"
    } else {
        "other"
    }
}

/// Asks Telegram to send a login code to the phone number (international form, +…).
#[tauri::command]
pub async fn telegram_request_code(phone: String) -> Result<(), String> {
    let phone: String = phone.chars().filter(|c| c.is_ascii_digit() || *c == '+').collect();
    if phone.len() < 7 {
        login_failed("badPhone");
        return Err("badPhone".into());
    }
    let Some((_, hash)) = credentials() else { return Err("badApi".into()) };
    let client = ctl().online.as_ref().map(|o| o.client.clone());
    let Some(client) = client else {
        login_failed("other");
        return Err("other".into());
    };
    match client.request_login_code(&phone, &hash).await {
        Ok(token) => {
            let mut c = ctl();
            c.stage = Stage::Code(token);
            c.phone = phone;
            c.login_error = None;
            drop(c);
            changed();
            Ok(())
        }
        Err(err) => {
            let code = error_code(&err.to_string());
            login_failed(code);
            Err(code.into())
        }
    }
}

#[tauri::command]
pub async fn telegram_submit_code(code: String) -> Result<(), String> {
    let (client, token) = {
        let mut c = ctl();
        let client = c.online.as_ref().map(|o| o.client.clone());
        match (client, std::mem::replace(&mut c.stage, Stage::None)) {
            (Some(client), Stage::Code(token)) => (client, token),
            (_, stage) => {
                c.stage = stage;
                return Err("other".into());
            }
        }
    };
    match client.sign_in(&token, code.trim()).await {
        Ok(_) => after_login().await,
        Err(SignInError::PasswordRequired(p)) => {
            let mut c = ctl();
            c.stage = Stage::Password(p);
            c.login_error = None;
            drop(c);
            changed();
            Ok(())
        }
        Err(SignInError::InvalidCode) => {
            ctl().stage = Stage::Code(token);
            login_failed("invalidCode");
            Err("invalidCode".into())
        }
        Err(SignInError::SignUpRequired) => {
            login_failed("signUp");
            Err("signUp".into())
        }
        Err(other) => {
            let code = error_code(&other.to_string());
            login_failed(code);
            Err(code.into())
        }
    }
}

#[tauri::command]
pub async fn telegram_submit_password(password: String) -> Result<(), String> {
    let (client, token) = {
        let mut c = ctl();
        let client = c.online.as_ref().map(|o| o.client.clone());
        match (client, std::mem::replace(&mut c.stage, Stage::None)) {
            (Some(client), Stage::Password(token)) => (client, token),
            (_, stage) => {
                c.stage = stage;
                return Err("other".into());
            }
        }
    };
    match client.check_password(token, password.as_bytes()).await {
        Ok(_) => after_login().await,
        Err(SignInError::InvalidPassword(t)) => {
            ctl().stage = Stage::Password(t);
            login_failed("invalidPassword");
            Err("invalidPassword".into())
        }
        Err(other) => {
            let code = error_code(&other.to_string());
            login_failed(code);
            Err(code.into())
        }
    }
}

/// Signed in: keep the session and carry on as if the account had been there from the start.
async fn after_login() -> Result<(), String> {
    let (generation, client, session) = {
        let mut c = ctl();
        let Some(o) = c.online.as_ref() else { return Err("other".into()) };
        let (client, session) = (o.client.clone(), Arc::clone(&o.session));
        c.stage = Stage::None;
        c.login_error = None;
        c.link = Link::Connecting;
        (c.generation, client, session)
    };
    changed();
    let task = tauri::async_runtime::spawn(online(generation, client, session));
    ctl().task = Some(task);
    Ok(())
}

/// Signs out of Telegram (this session only) and forgets everything kept here.
#[tauri::command]
pub async fn telegram_sign_out() {
    let client = ctl().online.as_ref().map(|o| o.client.clone());
    if let Some(client) = client {
        let _ = client.sign_out().await;
    }
    store::clear();
    stop(Link::Off);
    reconcile();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: &str, chat: &str, date: i64) -> Msg {
        Msg {
            id: id.into(),
            chat: chat.into(),
            sender: "1".into(),
            sender_name: "Ann".into(),
            text: "hi".into(),
            media: Media::None,
            date,
            from_me: false,
            mentions_me: false,
        }
    }

    #[test]
    fn a_message_is_added_once_and_counts_as_unread() {
        let mut chats = Chats::default();
        assert!(chats.add("5", "Ann", false, msg("1", "5", 10), true));
        assert!(!chats.add("5", "Ann", false, msg("1", "5", 10), true), "the same id is not added twice");
        assert!(chats.add("5", "Ann", false, msg("2", "5", 20), true));
        let c = &chats.map["5"];
        assert_eq!((c.unread, c.messages.len(), c.last_activity), (2, 2, 20));
        chats.mark_read("5");
        assert_eq!(chats.map["5"].unread, 0);
    }

    #[test]
    fn groups_without_news_and_ignored_chats_are_hidden() {
        let mut chats = Chats::default();
        chats.add("1", "Ann", false, msg("1", "1", 10), false);
        chats.add("-2", "Team", true, msg("1", "-2", 30), false);
        chats.add("-3", "Club", true, msg("1", "-3", 20), true);
        let mut p = Prefs::default();
        let ids = |p: &Prefs| chats.visible(p).into_iter().map(|c| c.id).collect::<Vec<_>>();
        assert_eq!(ids(&p), ["-3", "1"], "newest first; the quiet group is hidden");
        p.mute_groups = false;
        assert_eq!(ids(&p), ["-2", "-3", "1"]);
        p.ignored = vec!["-3".into()];
        assert_eq!(ids(&p), ["-2", "1"]);
        assert_eq!(chats.unread(&Prefs::default()), 1);
    }

    #[test]
    fn only_the_newest_messages_are_kept() {
        let mut chats = Chats::default();
        for i in 0..(MAX_KEPT as i64 + 10) {
            chats.add("1", "Ann", false, msg(&i.to_string(), "1", i), false);
        }
        let c = &chats.map["1"];
        assert_eq!(c.messages.len(), MAX_KEPT);
        assert_eq!(c.messages.last().unwrap().id, (MAX_KEPT as i64 + 9).to_string());
    }

    #[test]
    fn a_reply_is_checked_before_it_leaves() {
        let now = Instant::now();
        assert_eq!(check_reply("  ", None, now), Some(SendError::Refused { detail: "empty".into() }));
        assert_eq!(check_reply(&"x".repeat(MAX_REPLY + 1), None, now), Some(SendError::TooLong));
        assert_eq!(check_reply("ok", Some(now), now), Some(SendError::TooFast));
        assert_eq!(check_reply("ok", None, now), None);
    }

    #[test]
    fn login_errors_become_codes() {
        assert_eq!(error_code("rpc error PHONE_NUMBER_INVALID"), "badPhone");
        assert_eq!(error_code("FLOOD_WAIT_30"), "flood");
        assert_eq!(error_code("API_ID_INVALID"), "badApi");
        assert_eq!(error_code("boom"), "other");
    }

    #[test]
    fn the_api_form_refuses_what_is_not_an_id_and_a_hash() {
        assert!(telegram_save_api("abc".into(), "0123456789abcdef0123456789abcdef".into()).is_err());
        assert!(telegram_save_api("123".into(), "short".into()).is_err());
        assert!(telegram_save_api("-5".into(), "0123456789abcdef0123456789abcdef".into()).is_err());
    }
}
