// The few Gmail REST calls Tobi makes (https://developers.google.com/gmail/api/reference/rest):
// the unread list, one message (metadata or the whole), label changes, trash and send. Every id that
// reaches a URL is checked first: it comes from the page.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use super::model::{display_sender, extract_text, parse_from, payload_header};

const BASE: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApiError {
    /// The access token is no good (expired early, revoked).
    Unauthorized,
    /// The scope or the Gmail API is not allowed for this client.
    Forbidden,
    RateLimited,
    Network,
    Other(String),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailItem {
    pub id: String,
    pub thread_id: String,
    /// The sender's name, or the address.
    pub from: String,
    pub from_address: String,
    pub subject: String,
    pub snippet: String,
    /// Unix ms.
    pub date: i64,
    pub unread: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailBody {
    pub id: String,
    pub thread_id: String,
    pub from: String,
    pub from_address: String,
    pub to: String,
    pub subject: String,
    pub date: i64,
    pub text: String,
    pub unread: bool,
}

/// Gmail's ids are hexadecimal: anything else never goes into an address.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

async fn call(token: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, ApiError> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| ApiError::Other(e.to_string()))?;
    let mut request = client.request(method, format!("{BASE}{path}")).bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|_| ApiError::Network)?;
    let status = response.status();
    let bytes = crate::net::read_capped(response, 4 * 1024 * 1024).await.map_err(ApiError::Other)?;
    match status.as_u16() {
        200..=299 => Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null)),
        401 => Err(ApiError::Unauthorized),
        403 => {
            let text = String::from_utf8_lossy(&bytes);
            if text.contains("rateLimitExceeded") || text.contains("userRateLimitExceeded") { Err(ApiError::RateLimited) } else { Err(ApiError::Forbidden) }
        }
        429 => Err(ApiError::RateLimited),
        code => Err(ApiError::Other(format!("HTTP {code}"))),
    }
}

fn millis(v: &Value) -> i64 {
    v.get("internalDate").and_then(Value::as_str).and_then(|s| s.parse().ok()).unwrap_or(0)
}

fn has_label(v: &Value, label: &str) -> bool {
    v.get("labelIds").and_then(Value::as_array).is_some_and(|l| l.iter().any(|x| x == label))
}

fn item_of(v: &Value) -> Option<MailItem> {
    let payload = v.get("payload")?;
    let from_raw = payload_header(payload, "From");
    let (_, address) = parse_from(&from_raw);
    Some(MailItem {
        id: v.get("id")?.as_str()?.to_string(),
        thread_id: v.get("threadId").and_then(Value::as_str).unwrap_or_default().to_string(),
        from: display_sender(&from_raw),
        from_address: address,
        subject: payload_header(payload, "Subject"),
        snippet: v.get("snippet").and_then(Value::as_str).unwrap_or_default().replace("&#39;", "'").replace("&quot;", "\"").replace("&amp;", "&").to_string(),
        date: millis(v),
        unread: has_label(v, "UNREAD"),
    })
}

pub async fn profile(token: &str) -> Result<String, ApiError> {
    let v = call(token, reqwest::Method::GET, "/profile", None).await?;
    v.get("emailAddress").and_then(Value::as_str).map(str::to_string).ok_or_else(|| ApiError::Other("no address".into()))
}

/// How many unread messages the inbox holds (the number Gmail itself shows).
pub async fn inbox_unread(token: &str) -> Result<u32, ApiError> {
    let v = call(token, reqwest::Method::GET, "/labels/INBOX", None).await?;
    Ok(v.get("messagesUnread").and_then(Value::as_u64).unwrap_or(0) as u32)
}

/// The newest unread messages of the inbox (ids only).
pub async fn list_unread(token: &str, max: usize) -> Result<Vec<String>, ApiError> {
    let v = call(token, reqwest::Method::GET, &format!("/messages?labelIds=INBOX&labelIds=UNREAD&maxResults={max}"), None).await?;
    Ok(v.get("messages").and_then(Value::as_array).map(|a| a.iter().filter_map(|m| m.get("id")?.as_str().map(str::to_string)).collect()).unwrap_or_default())
}

pub async fn get_item(token: &str, id: &str) -> Result<MailItem, ApiError> {
    if !valid_id(id) {
        return Err(ApiError::Other("badId".into()));
    }
    let v = call(token, reqwest::Method::GET, &format!("/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject"), None).await?;
    item_of(&v).ok_or_else(|| ApiError::Other("badMessage".into()))
}

pub async fn get_body(token: &str, id: &str) -> Result<MailBody, ApiError> {
    if !valid_id(id) {
        return Err(ApiError::Other("badId".into()));
    }
    let v = call(token, reqwest::Method::GET, &format!("/messages/{id}?format=full"), None).await?;
    let payload = v.get("payload").ok_or_else(|| ApiError::Other("badMessage".into()))?;
    let from_raw = payload_header(payload, "From");
    Ok(MailBody {
        id: id.to_string(),
        thread_id: v.get("threadId").and_then(Value::as_str).unwrap_or_default().to_string(),
        from: display_sender(&from_raw),
        from_address: parse_from(&from_raw).1,
        to: payload_header(payload, "To"),
        subject: payload_header(payload, "Subject"),
        date: millis(&v),
        text: extract_text(payload),
        unread: has_label(&v, "UNREAD"),
    })
}

/// What a reply needs of the message it answers.
pub struct ReplyHeaders {
    pub thread_id: String,
    /// Reply-To, else From.
    pub to: String,
    pub subject: String,
    pub message_id: String,
    pub references: String,
}

pub async fn reply_headers(token: &str, id: &str) -> Result<ReplyHeaders, ApiError> {
    if !valid_id(id) {
        return Err(ApiError::Other("badId".into()));
    }
    let q = "format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References";
    let v = call(token, reqwest::Method::GET, &format!("/messages/{id}?{q}"), None).await?;
    let payload = v.get("payload").ok_or_else(|| ApiError::Other("badMessage".into()))?;
    let reply_to = payload_header(payload, "Reply-To");
    let to_raw = if reply_to.trim().is_empty() { payload_header(payload, "From") } else { reply_to };
    Ok(ReplyHeaders {
        thread_id: v.get("threadId").and_then(Value::as_str).unwrap_or_default().to_string(),
        to: parse_from(&to_raw).1,
        subject: payload_header(payload, "Subject"),
        message_id: payload_header(payload, "Message-ID"),
        references: payload_header(payload, "References"),
    })
}

pub async fn modify(token: &str, id: &str, add: &[&str], remove: &[&str]) -> Result<(), ApiError> {
    if !valid_id(id) {
        return Err(ApiError::Other("badId".into()));
    }
    call(token, reqwest::Method::POST, &format!("/messages/{id}/modify"), Some(json!({"addLabelIds": add, "removeLabelIds": remove}))).await.map(|_| ())
}

pub async fn trash(token: &str, id: &str) -> Result<(), ApiError> {
    if !valid_id(id) {
        return Err(ApiError::Other("badId".into()));
    }
    call(token, reqwest::Method::POST, &format!("/messages/{id}/trash"), None).await.map(|_| ())
}

/// Sends `raw` (model::build_raw), in `thread_id` when it is a reply.
pub async fn send(token: &str, raw: &str, thread_id: Option<&str>) -> Result<(), ApiError> {
    let mut body = json!({"raw": raw});
    if let Some(t) = thread_id.filter(|t| valid_id(t)) {
        body["threadId"] = json!(t);
    }
    call(token, reqwest::Method::POST, "/messages/send", Some(body)).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_alphanumeric_only() {
        assert!(valid_id("18c2f3a9b0d4e5f6"));
        for bad in ["", "../x", "a/b", "a?b", "a b", "a%2f", &"x".repeat(65)] {
            assert!(!valid_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_metadata_answer_becomes_an_item() {
        let v = json!({
            "id": "abc123", "threadId": "t1", "labelIds": ["INBOX", "UNREAD"], "snippet": "It&#39;s &amp; done", "internalDate": "1700000000000",
            "payload": {"headers": [{"name": "From", "value": "Marie <marie@x.org>"}, {"name": "Subject", "value": "Hello"}]}
        });
        let item = item_of(&v).unwrap();
        assert_eq!((item.id.as_str(), item.from.as_str(), item.from_address.as_str(), item.subject.as_str()), ("abc123", "Marie", "marie@x.org", "Hello"));
        assert_eq!((item.snippet.as_str(), item.date, item.unread), ("It's & done", 1_700_000_000_000, true));
        assert!(!item_of(&json!({"id": "x", "labelIds": [], "payload": {"headers": []}})).unwrap().unread);
        assert!(item_of(&json!({"nope": 1})).is_none());
    }
}
