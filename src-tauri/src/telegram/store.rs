// The Telegram login session (authorization keys), kept in the credential store and never on disk.
//
// A session is a home datacenter and, per datacenter, its address and permanent authorization key;
// that is all that has to survive a restart (peers and update state are fetched again). The JSON is
// cut into pieces because a credential entry holds only a little: telegram-session-0, -1, …

use grammers_session::storages::MemorySession;
use grammers_session::types::DcOption;
use grammers_session::{Session, SessionData};
use serde::{Deserialize, Serialize};

const PIECE: usize = 700;
const PIECES: usize = 8;

#[derive(Serialize, Deserialize)]
struct Saved {
    home: i32,
    dcs: Vec<DcOption>,
}

fn key(i: usize) -> String {
    format!("telegram-session-{i}")
}

pub fn clear() {
    for i in 0..PIECES {
        let _ = crate::secrets::set_internal(&key(i), "");
    }
}

/// A session from the saved authorization keys (or a fresh one).
pub fn load() -> MemorySession {
    let mut json = String::new();
    for i in 0..PIECES {
        match crate::secrets::get_internal(&key(i)) {
            Some(piece) => json.push_str(&piece),
            None => break,
        }
    }
    let mut data = SessionData::default();
    if let Ok(saved) = serde_json::from_str::<Saved>(&json) {
        data.home_dc = saved.home;
        for dc in saved.dcs {
            data.dc_options.insert(dc.id, dc);
        }
    }
    MemorySession::from(data)
}

/// Writes the authorization keys the session holds; returns whether they were kept.
pub fn save(session: &MemorySession) -> bool {
    let Ok(home) = session.home_dc_id() else { return false };
    let dcs: Vec<DcOption> = (1..=5)
        .filter_map(|id| session.dc_option(id).ok().flatten())
        .filter(|dc| dc.auth_key.is_some())
        .collect();
    if dcs.is_empty() {
        return false;
    }
    let Ok(json) = serde_json::to_string(&Saved { home, dcs }) else { return false };
    let pieces: Vec<String> = json.as_bytes().chunks(PIECE).map(|c| String::from_utf8_lossy(c).into_owned()).collect();
    if pieces.len() > PIECES {
        return false;
    }
    for (i, piece) in pieces.iter().enumerate() {
        if crate::secrets::set_internal(&key(i), piece).is_err() {
            return false;
        }
    }
    for i in pieces.len()..PIECES {
        let _ = crate::secrets::set_internal(&key(i), "");
    }
    true
}
