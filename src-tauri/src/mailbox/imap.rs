// Reading mail over IMAP (async-imap): the unread messages of the inbox, one message in full, and the
// few changes Tobi makes (seen, archive, trash). A connection is opened for each look and closed after
// it: nothing stays logged in between two checks. TLS from the start only (port 993): the app
// password is never sent in the clear. Nothing is fetched with BODY[] but BODY.PEEK[], so looking at
// a message never marks it read by itself.

use std::collections::HashSet;
use std::fmt::Debug;
use std::time::Duration;

use async_imap::types::NameAttribute;
use async_imap::{Client, Session};
use futures_util::TryStreamExt;
use mailparse::{parse_headers, parse_mail, MailHeaderMap, ParsedMail};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::TlsConnector;

use super::smtp::tls_config;
use crate::gmail::api::{MailBody, MailItem};
use crate::gmail::model::{display_sender, extract_plain_or_html, parse_from};

const STEP: Duration = Duration::from_secs(25);
/// A message bigger than this is not fetched: the island shows text, not attachments.
pub const MAX_SIZE: u32 = 3 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImapError {
    Network,
    /// The server refused the address or password.
    Auth,
    /// No archive or trash folder could be found.
    NoFolder,
    TooLarge,
    Other(String),
}

fn classify(err: async_imap::error::Error) -> ImapError {
    use async_imap::error::Error as E;
    match err {
        E::No(_) | E::Bad(_) => ImapError::Auth,
        E::Io(_) | E::ConnectionLost => ImapError::Network,
        other => ImapError::Other(other.to_string().chars().take(60).collect()),
    }
}

async fn timed<F: std::future::Future<Output = Result<R, async_imap::error::Error>>, R>(f: F) -> Result<R, ImapError> {
    tokio::time::timeout(STEP, f).await.map_err(|_| ImapError::Network)?.map_err(classify)
}

/// Logs in on an open stream (TLS in real life, plain TCP in tests).
pub async fn login_over<T>(stream: T, user: &str, password: &str) -> Result<Session<T>, ImapError>
where
    T: AsyncRead + AsyncWrite + Unpin + Debug + Send,
{
    let mut client = Client::new(stream);
    // The server's greeting.
    tokio::time::timeout(STEP, client.read_response()).await.map_err(|_| ImapError::Network)?.map_err(|_| ImapError::Network)?;
    match tokio::time::timeout(STEP, client.login(user, password)).await {
        Err(_) => Err(ImapError::Network),
        Ok(Err((err, _))) => Err(classify(err)),
        Ok(Ok(session)) => Ok(session),
    }
}

/// A TLS connection to `host:port`, logged in.
pub async fn connect(host: &str, port: u16, user: &str, password: &str) -> Result<Session<TlsStream<TcpStream>>, ImapError> {
    let tcp = tokio::time::timeout(STEP, TcpStream::connect((host, port))).await.map_err(|_| ImapError::Network)?.map_err(|_| ImapError::Network)?;
    let name = ServerName::try_from(host.to_string()).map_err(|_| ImapError::Network)?;
    let tls = TlsConnector::from(tls_config()).connect(name, tcp).await.map_err(|_| ImapError::Network)?;
    login_over(tls, user, password).await
}

fn uid_of(id: &str) -> Result<u32, ImapError> {
    id.parse::<u32>().ok().filter(|u| *u > 0).ok_or_else(|| ImapError::Other("badId".into()))
}

fn header_of(parsed: &[mailparse::MailHeader<'_>], name: &str) -> String {
    parsed.get_first_value(name).unwrap_or_default()
}

/// The unread messages of the inbox, newest first: (how many are unread in all, the newest `max`).
pub async fn unread<T>(session: &mut Session<T>, max: usize) -> Result<(u32, Vec<MailItem>), ImapError>
where
    T: AsyncRead + AsyncWrite + Unpin + Debug + Send,
{
    timed(session.select("INBOX")).await?;
    let found: HashSet<u32> = timed(session.uid_search("UNSEEN")).await?;
    let total = found.len() as u32;
    let mut uids: Vec<u32> = found.into_iter().collect();
    uids.sort_unstable_by(|a, b| b.cmp(a));
    uids.truncate(max);
    if uids.is_empty() {
        return Ok((total, vec![]));
    }
    let set = uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let fetched: Vec<_> = timed(async { session.uid_fetch(set, "(UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])").await?.try_collect().await }).await?;
    let mut items: Vec<MailItem> = fetched
        .iter()
        .filter_map(|f| {
            let uid = f.uid?;
            let (headers, _) = parse_headers(f.header()?).ok()?;
            let from_raw = header_of(&headers, "From");
            Some(MailItem {
                id: uid.to_string(),
                thread_id: String::new(),
                from: display_sender(&from_raw),
                from_address: parse_from(&from_raw).1,
                subject: header_of(&headers, "Subject"),
                snippet: String::new(),
                date: f.internal_date().map(|d| d.timestamp_millis()).unwrap_or(0),
                unread: true,
            })
        })
        .collect();
    items.sort_by(|a, b| b.date.cmp(&a.date));
    Ok((total, items))
}

/// What a message is, parsed from its bytes.
pub struct Parsed {
    pub from: String,
    pub from_address: String,
    pub reply_to: String,
    pub to: String,
    pub subject: String,
    pub message_id: String,
    pub references: String,
    pub text: String,
}

fn part_text(part: &ParsedMail<'_>, want: &str) -> Option<String> {
    if part.ctype.mimetype.eq_ignore_ascii_case(want) {
        return part.get_body().ok();
    }
    part.subparts.iter().find_map(|p| part_text(p, want))
}

/// A message's headers and its readable text (text/plain, else text/html without its tags).
pub fn parse_message(bytes: &[u8]) -> Result<Parsed, ImapError> {
    let mail = parse_mail(bytes).map_err(|_| ImapError::Other("badMessage".into()))?;
    let get = |n: &str| mail.headers.get_first_value(n).unwrap_or_default();
    let from_raw = get("From");
    let text = extract_plain_or_html(part_text(&mail, "text/plain"), part_text(&mail, "text/html"));
    Ok(Parsed {
        from: display_sender(&from_raw),
        from_address: parse_from(&from_raw).1,
        reply_to: parse_from(&get("Reply-To")).1,
        to: get("To"),
        subject: get("Subject"),
        message_id: get("Message-ID"),
        references: get("References"),
        text,
    })
}

async fn size_and_flags<T>(session: &mut Session<T>, uid: u32) -> Result<Option<u32>, ImapError>
where
    T: AsyncRead + AsyncWrite + Unpin + Debug + Send,
{
    let fetched: Vec<_> = timed(async { session.uid_fetch(uid.to_string(), "(UID RFC822.SIZE)").await?.try_collect().await }).await?;
    Ok(fetched.iter().find_map(|f| f.size))
}

/// One message of the inbox, whole (`BODY.PEEK[]`: it stays unread until Tobi says otherwise).
pub async fn body<T>(session: &mut Session<T>, id: &str) -> Result<(MailBody, Parsed), ImapError>
where
    T: AsyncRead + AsyncWrite + Unpin + Debug + Send,
{
    let uid = uid_of(id)?;
    timed(session.select("INBOX")).await?;
    if size_and_flags(session, uid).await?.is_some_and(|s| s > MAX_SIZE) {
        return Err(ImapError::TooLarge);
    }
    let fetched: Vec<_> = timed(async { session.uid_fetch(uid.to_string(), "(UID FLAGS INTERNALDATE BODY.PEEK[])").await?.try_collect().await }).await?;
    let f = fetched.iter().find(|f| f.uid == Some(uid)).ok_or_else(|| ImapError::Other("gone".into()))?;
    let parsed = parse_message(f.body().ok_or_else(|| ImapError::Other("noBody".into()))?)?;
    let unread = !f.flags().any(|fl| matches!(fl, async_imap::types::Flag::Seen));
    let view = MailBody {
        id: id.to_string(),
        thread_id: String::new(),
        from: parsed.from.clone(),
        from_address: parsed.from_address.clone(),
        to: parsed.to.clone(),
        subject: parsed.subject.clone(),
        date: f.internal_date().map(|d| d.timestamp_millis()).unwrap_or(0),
        text: parsed.text.clone(),
        unread,
    };
    Ok((view, parsed))
}

/// Marks a message read.
pub async fn set_seen<T>(session: &mut Session<T>, id: &str) -> Result<(), ImapError>
where
    T: AsyncRead + AsyncWrite + Unpin + Debug + Send,
{
    let uid = uid_of(id)?;
    timed(session.select("INBOX")).await?;
    timed(async { session.uid_store(uid.to_string(), "+FLAGS (\\Seen)").await?.try_collect::<Vec<_>>().await }).await?;
    Ok(())
}

/// The mailbox the server marks with a special use (RFC 6154), for archive or trash.
async fn special_folder<T>(session: &mut Session<T>, trash: bool) -> Result<String, ImapError>
where
    T: AsyncRead + AsyncWrite + Unpin + Debug + Send,
{
    let names: Vec<_> = timed(async { session.list(Some(""), Some("*")).await?.try_collect().await }).await?;
    let wanted = |a: &NameAttribute<'_>| if trash { matches!(a, NameAttribute::Trash) } else { matches!(a, NameAttribute::Archive | NameAttribute::All) };
    // An archive folder before Gmail's "All Mail".
    let pick = names
        .iter()
        .find(|n| !trash && n.attributes().iter().any(|a| matches!(a, NameAttribute::Archive)))
        .or_else(|| names.iter().find(|n| n.attributes().iter().any(wanted)));
    pick.map(|n| n.name().to_string()).ok_or(ImapError::NoFolder)
}

/// Moves a message out of the inbox into the archive or the trash.
pub async fn move_out<T>(session: &mut Session<T>, id: &str, trash: bool) -> Result<(), ImapError>
where
    T: AsyncRead + AsyncWrite + Unpin + Debug + Send,
{
    let uid = uid_of(id)?;
    let folder = special_folder(session, trash).await?;
    timed(session.select("INBOX")).await?;
    if timed(session.uid_mv(uid.to_string(), &folder)).await.is_ok() {
        return Ok(());
    }
    // A server without MOVE: copy, flag the original, remove it.
    timed(session.uid_copy(uid.to_string(), &folder)).await?;
    timed(async { session.uid_store(uid.to_string(), "+FLAGS (\\Deleted)").await?.try_collect::<Vec<_>>().await }).await?;
    timed(async { session.uid_expunge(uid.to_string()).await?.try_collect::<Vec<_>>().await }).await?;
    Ok(())
}

pub async fn logout<T>(session: &mut Session<T>)
where
    T: AsyncRead + AsyncWrite + Unpin + Debug + Send,
{
    let _ = tokio::time::timeout(Duration::from_secs(5), session.logout()).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    const HEADER_10: &str = "From: =?UTF-8?B?0JjQstCw0L0=?= <ivan@x.org>\r\nSubject: Old one\r\n\r\n";
    const HEADER_12: &str = "From: Marie Curie <marie@x.org>\r\nSubject: Newer\r\n\r\n";
    const FULL_12: &str = "From: Marie Curie <marie@x.org>\r\nTo: me@y.org\r\nSubject: Newer\r\nMessage-ID: <m12@x.org>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"B\"\r\n\r\n--B\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n0J/RgNC40LLQtdGCLCDQvNC40YA=\r\n--B\r\nContent-Type: text/html\r\n\r\n<b>html</b>\r\n--B--\r\n";

    fn literal(tag: &str, uid: u32, date: &str, section: &str, data: &str) -> String {
        format!("* {uid} FETCH (UID {uid} INTERNALDATE \"{date}\" BODY[{section}] {{{}}}\r\n{data})\r\n{tag} OK FETCH done\r\n", data.len())
    }

    /// An IMAP server that knows one mailbox and keeps a log of what it was asked.
    async fn fake_server() -> (u16, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut reader = BufReader::new(stream);
            reader.get_mut().write_all(b"* OK ready\r\n").await.unwrap();
            let mut log = vec![];
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).await.unwrap() == 0 {
                    break;
                }
                let line = line.trim_end().to_string();
                let (tag, cmd) = line.split_once(' ').unwrap_or((&line, ""));
                log.push(cmd.to_string());
                let out = if cmd.starts_with("LOGIN") {
                    if cmd.contains("goodpw") { format!("{tag} OK LOGIN completed\r\n") } else { format!("{tag} NO [AUTHENTICATIONFAILED] bad\r\n") }
                } else if cmd.starts_with("SELECT") {
                    format!("* 3 EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n{tag} OK [READ-WRITE] done\r\n")
                } else if cmd.starts_with("UID SEARCH") {
                    format!("* SEARCH 10 12\r\n{tag} OK done\r\n")
                } else if cmd.starts_with("UID FETCH 12,10") {
                    format!("{}{}", literal("*", 12, "17-Jul-2026 02:44:25 -0700", "HEADER.FIELDS (FROM SUBJECT)", HEADER_12).replace("* OK FETCH done\r\n", ""),
                        literal(tag, 10, "16-Jul-2026 02:44:25 -0700", "HEADER.FIELDS (FROM SUBJECT)", HEADER_10))
                } else if cmd.contains("RFC822.SIZE") {
                    format!("* 2 FETCH (UID 12 RFC822.SIZE 900)\r\n{tag} OK done\r\n")
                } else if cmd.starts_with("UID FETCH 12 (UID FLAGS") {
                    format!("* 2 FETCH (UID 12 FLAGS () INTERNALDATE \"17-Jul-2026 02:44:25 -0700\" BODY[] {{{}}}\r\n{FULL_12})\r\n{tag} OK done\r\n", FULL_12.len())
                } else if cmd.starts_with("UID STORE") {
                    format!("* 2 FETCH (UID 12 FLAGS (\\Seen))\r\n{tag} OK done\r\n")
                } else if cmd.starts_with("LIST") {
                    format!("* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n* LIST (\\Trash) \"/\" \"Bin\"\r\n* LIST (\\Archive) \"/\" \"Old mail\"\r\n{tag} OK done\r\n")
                } else if cmd.starts_with("UID MOVE") {
                    format!("{tag} OK moved\r\n")
                } else if cmd.starts_with("LOGOUT") {
                    format!("* BYE\r\n{tag} OK bye\r\n")
                } else {
                    format!("{tag} BAD unknown\r\n")
                };
                reader.get_mut().write_all(out.as_bytes()).await.unwrap();
            }
            log
        });
        (port, handle)
    }

    async fn session(port: u16, pw: &str) -> Result<Session<TcpStream>, ImapError> {
        login_over(TcpStream::connect(("127.0.0.1", port)).await.unwrap(), "me@y.org", pw).await
    }

    #[tokio::test]
    async fn a_wrong_password_is_an_auth_error() {
        let (port, _s) = fake_server().await;
        assert_eq!(session(port, "badpw").await.err(), Some(ImapError::Auth));
    }

    #[tokio::test]
    async fn the_unread_list_is_newest_first_with_decoded_senders() {
        let (port, server) = fake_server().await;
        let mut s = session(port, "goodpw").await.unwrap();
        let (total, items) = unread(&mut s, 15).await.unwrap();
        assert_eq!(total, 2);
        let names: Vec<_> = items.iter().map(|i| (i.id.as_str(), i.from.as_str(), i.subject.as_str())).collect();
        assert_eq!(names, [("12", "Marie Curie", "Newer"), ("10", "Иван", "Old one")]);
        assert!(items[0].date > items[1].date && items.iter().all(|i| i.unread));
        logout(&mut s).await;
        drop(s);
        let log = server.await.unwrap();
        assert!(log.iter().any(|c| c == "UID FETCH 12,10 (UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])"), "peek only: {log:?}");
        assert!(!log.iter().any(|c| c.contains("BODY[") && !c.contains("PEEK")));
    }

    #[tokio::test]
    async fn a_message_is_read_whole_without_marking_it() {
        let (port, server) = fake_server().await;
        let mut s = session(port, "goodpw").await.unwrap();
        let (view, parsed) = body(&mut s, "12").await.unwrap();
        assert_eq!((view.from.as_str(), view.subject.as_str(), view.text.as_str()), ("Marie Curie", "Newer", "Привет, мир"));
        assert!(view.unread);
        assert_eq!((parsed.message_id.as_str(), parsed.from_address.as_str()), ("<m12@x.org>", "marie@x.org"));
        logout(&mut s).await;
        drop(s);
        let log = server.await.unwrap();
        assert!(!log.iter().any(|c| c.contains("STORE")), "reading does not flag");
        assert_eq!(uid_of("x"), Err(ImapError::Other("badId".into())));
        assert_eq!(uid_of("0"), Err(ImapError::Other("badId".into())));
        assert_eq!(uid_of("12"), Ok(12));
    }

    #[tokio::test]
    async fn seen_archive_and_trash_use_the_servers_own_folders() {
        let (port, server) = fake_server().await;
        let mut s = session(port, "goodpw").await.unwrap();
        set_seen(&mut s, "12").await.unwrap();
        move_out(&mut s, "12", true).await.unwrap();
        move_out(&mut s, "12", false).await.unwrap();
        logout(&mut s).await;
        drop(s);
        let log = server.await.unwrap();
        assert!(log.iter().any(|c| c == "UID STORE 12 +FLAGS (\\Seen)"));
        assert!(log.iter().any(|c| c == "UID MOVE 12 \"Bin\""), "{log:?}");
        assert!(log.iter().any(|c| c == "UID MOVE 12 \"Old mail\""), "{log:?}");
    }

    #[test]
    fn a_plain_message_and_a_html_only_one_are_both_readable() {
        let plain = parse_message(b"From: a@b.co\r\nSubject: s\r\n\r\nhello\r\n").unwrap();
        assert_eq!((plain.text.as_str(), plain.from.as_str()), ("hello", "a@b.co"));
        let html = parse_message(b"From: A <a@b.co>\r\nContent-Type: text/html\r\n\r\n<p>Hi &amp; bye</p>").unwrap();
        assert_eq!(html.text, "Hi & bye");
        assert!(parse_message(b"").is_ok());
    }
}
