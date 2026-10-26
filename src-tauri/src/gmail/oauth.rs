// Signing in with Google, for a desktop app: the system browser opens Google's page, Google sends the
// browser back to a one-shot listener on 127.0.0.1, and the code it brings is exchanged for tokens
// (OAuth 2.0 with PKCE, RFC 7636 and RFC 8252). The user's own OAuth client id and secret are used,
// so nothing passes through anybody else's server; the tokens go to the credential store through
// mod.rs, never to disk and never to the page.

use std::time::Duration;

use reqwest::Url;
use ring::digest;
use ring::rand::{SecureRandom, SystemRandom};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::model::b64_std;

pub const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
/// Read, write labels (read/unread, archive, trash) and send: not the permanent deletion of mail.
pub const SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";

/// How long the browser has to come back.
pub const WAIT: Duration = Duration::from_secs(180);

fn url_safe(bytes: &[u8]) -> String {
    b64_std(bytes).replace('+', "-").replace('/', "_").trim_end_matches('=').to_string()
}

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

/// A fresh verifier (43 URL-safe characters from 32 random bytes) and its S256 challenge.
pub fn pkce() -> Result<Pkce, String> {
    let mut bytes = [0u8; 32];
    SystemRandom::new().fill(&mut bytes).map_err(|_| "no secure random source".to_string())?;
    let verifier = url_safe(&bytes);
    Ok(Pkce { challenge: challenge_of(&verifier), verifier })
}

pub fn challenge_of(verifier: &str) -> String {
    url_safe(digest::digest(&digest::SHA256, verifier.as_bytes()).as_ref())
}

/// An unguessable value that ties the browser's answer to this sign-in.
pub fn random_state() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    SystemRandom::new().fill(&mut bytes).map_err(|_| "no secure random source".to_string())?;
    Ok(url_safe(&bytes))
}

pub fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let mut url = Url::parse(AUTH_URL).expect("a constant address");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        // A refresh token every time, so a second sign-in does not leave us without one.
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    url.into()
}

#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    Code(String),
    /// Google or the user refused (`access_denied`…).
    Denied(String),
    /// Not our answer: another path, a wrong state.
    Ignore,
}

/// What the browser asked of the listener: `GET /?code=…&state=… HTTP/1.1`.
pub fn parse_callback(request: &str, state: &str) -> Callback {
    let line = request.lines().next().unwrap_or("");
    let mut parts = line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else { return Callback::Ignore };
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else { return Callback::Ignore };
    if url.path() != "/" {
        return Callback::Ignore;
    }
    let get = |k: &str| url.query_pairs().find(|(name, _)| name == k).map(|(_, v)| v.into_owned());
    if get("state").as_deref() != Some(state) {
        return Callback::Ignore;
    }
    if let Some(err) = get("error") {
        return Callback::Denied(err.chars().take(40).collect());
    }
    match get("code") {
        Some(code) if !code.is_empty() && code.len() < 2048 => Callback::Code(code),
        _ => Callback::Ignore,
    }
}

const PAGE: &str = "<!doctype html><meta charset=utf-8><title>Tobi</title><body style=\"margin:0;height:100vh;display:grid;place-items:center;background:#0b0b0f;color:#ececf1;font:16px system-ui,sans-serif\"><div style=\"text-align:center\"><div style=\"font-size:22px;font-weight:600\">Tobi</div><p>MESSAGE</p></div>";

async fn reply(stream: &mut tokio::net::TcpStream, message: &str) {
    let body = PAGE.replace("MESSAGE", message);
    let head = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n", body.len());
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Waits for Google's redirect on `listener` (one-shot): the code, or why there is none.
pub async fn wait_for_code(listener: TcpListener, state: &str, wait: Duration) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + wait;
    loop {
        let accepted = tokio::time::timeout_at(deadline, listener.accept()).await.map_err(|_| "timeout".to_string())?;
        let (mut stream, _) = accepted.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 4096];
        let read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf)).await;
        let Ok(Ok(n)) = read else { continue };
        match parse_callback(&String::from_utf8_lossy(&buf[..n]), state) {
            Callback::Code(code) => {
                reply(&mut stream, "You are signed in. You can close this tab and go back to Tobi.").await;
                return Ok(code);
            }
            Callback::Denied(why) => {
                reply(&mut stream, "Sign-in was cancelled. You can close this tab.").await;
                return Err(why);
            }
            Callback::Ignore => {
                let _ = stream.shutdown().await;
            }
        }
    }
}

#[derive(Deserialize, Debug)]
pub struct Tokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: u64,
}

fn form(pairs: &[(&str, &str)]) -> String {
    let mut url = Url::parse("http://x/").expect("a constant address");
    url.query_pairs_mut().extend_pairs(pairs.iter().copied());
    url.query().unwrap_or("").to_string()
}

async fn post_form(url: &str, pairs: &[(&str, &str)]) -> Result<Tokens, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let response = client
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form(pairs))
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    let status = response.status();
    let body = crate::net::read_capped(response, 64 * 1024).await?;
    if !status.is_success() {
        let reason = serde_json::from_slice::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or_else(|| status.as_u16().to_string());
        return Err(reason.chars().take(40).collect());
    }
    serde_json::from_slice(&body).map_err(|_| "badAnswer".to_string())
}

/// The code from the browser → tokens (the refresh token only comes now).
pub async fn exchange(client_id: &str, secret: &str, code: &str, verifier: &str, redirect: &str) -> Result<Tokens, String> {
    post_form(TOKEN_URL, &[
        ("client_id", client_id),
        ("client_secret", secret),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect),
    ])
    .await
}

/// A fresh access token from the stored refresh token. `invalid_grant` means it was revoked or expired.
pub async fn refresh(client_id: &str, secret: &str, refresh_token: &str) -> Result<Tokens, String> {
    post_form(TOKEN_URL, &[
        ("client_id", client_id),
        ("client_secret", secret),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ])
    .await
}

/// Tells Google to forget the token (sign out). Best effort.
pub async fn revoke(token: &str) {
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(10)).build() else { return };
    let _ = client.post(REVOKE_URL).header("Content-Type", "application/x-www-form-urlencoded").body(form(&[("token", token)])).send().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_challenge_is_rfc_7636s_example() {
        // RFC 7636 appendix B.
        assert_eq!(challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn a_verifier_is_long_enough_and_url_safe() {
        let p = pkce().unwrap();
        assert_eq!(p.verifier.len(), 43);
        assert!(p.verifier.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(p.challenge, challenge_of(&p.verifier));
        assert_ne!(pkce().unwrap().verifier, p.verifier);
        assert!(random_state().unwrap().len() >= 32);
    }

    #[test]
    fn the_sign_in_address_carries_everything() {
        let url = auth_url("id.apps.googleusercontent.com", "http://127.0.0.1:5000", "CH", "ST");
        let parsed = Url::parse(&url).unwrap();
        let q: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(parsed.host_str(), Some("accounts.google.com"));
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5000");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["scope"], SCOPE);
        assert_eq!((q["state"].as_str(), q["access_type"].as_str()), ("ST", "offline"));
    }

    #[test]
    fn only_our_answer_with_our_state_counts() {
        let ok = "GET /?state=ST&code=4%2Fabc HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(parse_callback(ok, "ST"), Callback::Code("4/abc".into()));
        assert_eq!(parse_callback(ok, "OTHER"), Callback::Ignore, "a wrong state is somebody else's");
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1\r\n\r\n", "ST"), Callback::Ignore);
        assert_eq!(parse_callback("POST /?state=ST&code=x HTTP/1.1\r\n\r\n", "ST"), Callback::Ignore);
        assert_eq!(parse_callback("GET /?state=ST&error=access_denied HTTP/1.1\r\n\r\n", "ST"), Callback::Denied("access_denied".into()));
        assert_eq!(parse_callback("GET /?state=ST HTTP/1.1\r\n\r\n", "ST"), Callback::Ignore);
        assert_eq!(parse_callback("", "ST"), Callback::Ignore);
    }

    #[test]
    fn a_form_is_percent_encoded() {
        assert_eq!(form(&[("a", "b c"), ("d", "e&f=g")]), "a=b+c&d=e%26f%3Dg");
    }

    #[tokio::test]
    async fn the_listener_takes_the_code_and_ignores_noise() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiter = tokio::spawn(wait_for_code(listener, "ST", Duration::from_secs(5)));
        let get = |path: String| async move {
            let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            s.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).await.unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out).await;
            out
        };
        let _ = get("/favicon.ico".into()).await;
        let _ = get("/?state=nope&code=evil".into()).await;
        let page = get("/?state=ST&code=GOOD".into()).await;
        assert!(page.contains("200 OK") && page.contains("signed in"));
        assert_eq!(waiter.await.unwrap().unwrap(), "GOOD");
    }

    #[tokio::test]
    async fn no_answer_in_time_is_a_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        assert_eq!(wait_for_code(listener, "ST", Duration::from_millis(50)).await.unwrap_err(), "timeout");
    }
}
