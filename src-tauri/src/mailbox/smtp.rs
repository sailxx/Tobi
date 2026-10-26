// Sending mail over SMTP: just what Tobi needs and no more. TLS from the start (port 465) or an upgrade
// of a plain connection (STARTTLS, port 587), AUTH PLAIN with the account's address and app password,
// one message to one recipient. Refuses to talk without TLS: the password is never sent in the clear.

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{crypto::ring as ring_provider, ClientConfig, RootCertStore};
use tokio_rustls::TlsConnector;

use crate::gmail::model::{b64_std, valid_address};

const STEP: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SmtpError {
    Network,
    /// The server refused the address or password (535, 534…).
    Auth,
    /// Any other refusal, with the server's code.
    Refused(String),
}

pub fn tls_config() -> Arc<ClientConfig> {
    let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = ClientConfig::builder_with_provider(Arc::new(ring_provider::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("the ring provider supports the default protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    Arc::new(config)
}

/// One server reply, its continuation lines included: (the code, the text of the last line).
async fn reply<S: AsyncRead + Unpin>(reader: &mut BufReader<S>) -> Result<(u16, String), SmtpError> {
    loop {
        let mut line = String::new();
        let n = tokio::time::timeout(STEP, reader.read_line(&mut line)).await.map_err(|_| SmtpError::Network)?.map_err(|_| SmtpError::Network)?;
        if n == 0 || line.len() > 2048 {
            return Err(SmtpError::Network);
        }
        let code: u16 = line.get(..3).and_then(|c| c.parse().ok()).ok_or(SmtpError::Network)?;
        // "250-more" continues, "250 last" ends.
        if line.as_bytes().get(3) != Some(&b'-') {
            return Ok((code, line[3..].trim().to_string()));
        }
    }
}

async fn command<S: AsyncRead + AsyncWrite + Unpin>(reader: &mut BufReader<S>, line: &str, ok: &[u16]) -> Result<(), SmtpError> {
    tokio::time::timeout(STEP, reader.get_mut().write_all(format!("{line}\r\n").as_bytes())).await.map_err(|_| SmtpError::Network)?.map_err(|_| SmtpError::Network)?;
    let (code, text) = reply(reader).await?;
    if ok.contains(&code) {
        Ok(())
    } else if code == 535 || code == 534 || code == 530 {
        Err(SmtpError::Auth)
    } else {
        Err(SmtpError::Refused(format!("{code} {}", text.chars().take(60).collect::<String>())))
    }
}

/// The message with its lines that start with "." doubled, ended by ".": RFC 5321's DATA.
pub fn dot_stuffed(message: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(message.len() + 16);
    let mut at_line_start = true;
    for &b in message {
        if at_line_start && b == b'.' {
            out.push(b'.');
        }
        out.push(b);
        at_line_start = b == b'\n';
    }
    if !out.ends_with(b"\r\n") {
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b".\r\n");
    out
}

/// EHLO → AUTH PLAIN → MAIL FROM → RCPT TO → DATA → QUIT, on a stream that is already encrypted.
pub async fn converse<S: AsyncRead + AsyncWrite + Unpin>(
    reader: &mut BufReader<S>, user: &str, password: &str, from: &str, to: &str, message: &[u8],
) -> Result<(), SmtpError> {
    if !valid_address(from) || !valid_address(to) || user.contains(['\r', '\n', '\0']) || password.contains(['\r', '\n', '\0']) {
        return Err(SmtpError::Refused("badAddress".into()));
    }
    command(reader, "EHLO tobi.local", &[250]).await?;
    let plain = b64_std(format!("\0{user}\0{password}").as_bytes());
    command(reader, &format!("AUTH PLAIN {plain}"), &[235]).await?;
    command(reader, &format!("MAIL FROM:<{from}>"), &[250]).await?;
    command(reader, &format!("RCPT TO:<{to}>"), &[250, 251]).await?;
    command(reader, "DATA", &[354]).await?;
    tokio::time::timeout(STEP, reader.get_mut().write_all(&dot_stuffed(message))).await.map_err(|_| SmtpError::Network)?.map_err(|_| SmtpError::Network)?;
    let (code, text) = reply(reader).await?;
    if code != 250 {
        return Err(SmtpError::Refused(format!("{code} {}", text.chars().take(60).collect::<String>())));
    }
    let _ = command(reader, "QUIT", &[221]).await;
    Ok(())
}

/// Sends `message` from `from` to `to`: port 465 is TLS from the start, anything else is upgraded with STARTTLS.
pub async fn send(host: &str, port: u16, user: &str, password: &str, from: &str, to: &str, message: &[u8]) -> Result<(), SmtpError> {
    let tcp = tokio::time::timeout(STEP, TcpStream::connect((host, port))).await.map_err(|_| SmtpError::Network)?.map_err(|_| SmtpError::Network)?;
    let name = ServerName::try_from(host.to_string()).map_err(|_| SmtpError::Network)?;
    let connector = TlsConnector::from(tls_config());
    if port == 465 {
        let tls = connector.connect(name, tcp).await.map_err(|_| SmtpError::Network)?;
        let mut reader = BufReader::new(tls);
        let (code, _) = reply(&mut reader).await?;
        if code != 220 {
            return Err(SmtpError::Network);
        }
        return converse(&mut reader, user, password, from, to, message).await;
    }
    let mut plain = BufReader::new(tcp);
    let (code, _) = reply(&mut plain).await?;
    if code != 220 {
        return Err(SmtpError::Network);
    }
    command(&mut plain, "EHLO tobi.local", &[250]).await?;
    command(&mut plain, "STARTTLS", &[220]).await?;
    // Nothing may be buffered past the 220: the server waits for our handshake.
    let tls = connector.connect(name, plain.into_inner()).await.map_err(|_| SmtpError::Network)?;
    converse(&mut BufReader::new(tls), user, password, from, to, message).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;

    #[test]
    fn data_is_dot_stuffed_and_terminated() {
        assert_eq!(dot_stuffed(b"a\r\n.b\r\n..c\r\n"), b"a\r\n..b\r\n...c\r\n.\r\n");
        assert_eq!(dot_stuffed(b"no newline"), b"no newline\r\n.\r\n");
        assert_eq!(dot_stuffed(b".first"), b"..first\r\n.\r\n");
    }

    /// A server that says what a real one says and keeps what it is told.
    async fn fake_server(auth_ok: bool) -> (u16, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut reader = BufReader::new(stream);
            let mut seen = vec![];
            let mut data = false;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).await.unwrap() == 0 {
                    break;
                }
                let line = line.trim_end().to_string();
                if data {
                    seen.push(format!("DATA:{line}"));
                    if line == "." {
                        data = false;
                        reader.get_mut().write_all(b"250 queued\r\n").await.unwrap();
                    }
                    continue;
                }
                let answer: &[u8] = match line.split_whitespace().next().unwrap_or("") {
                    "EHLO" => b"250-tobi\r\n250 AUTH PLAIN\r\n",
                    "AUTH" if auth_ok => b"235 ok\r\n",
                    "AUTH" => b"535 bad credentials\r\n",
                    "MAIL" | "RCPT" => b"250 ok\r\n",
                    "DATA" => {
                        data = true;
                        b"354 go\r\n"
                    }
                    "QUIT" => b"221 bye\r\n",
                    _ => b"500 what\r\n",
                };
                seen.push(line);
                reader.get_mut().write_all(answer).await.unwrap();
            }
            seen
        });
        (port, handle)
    }

    async fn client(port: u16) -> BufReader<TcpStream> {
        let mut r = BufReader::new(TcpStream::connect(("127.0.0.1", port)).await.unwrap());
        // The server speaks only after a command here; no greeting is read.
        let _ = &mut r;
        r
    }

    #[tokio::test]
    async fn a_message_goes_through_the_whole_conversation() {
        let (port, server) = fake_server(true).await;
        let mut r = client(port).await;
        converse(&mut r, "me@x.org", "app pw", "me@x.org", "ann@y.org", b"Subject: hi\r\n\r\n.dot\r\n").await.unwrap();
        drop(r);
        let seen = server.await.unwrap();
        assert!(seen.iter().any(|l| l == "AUTH PLAIN AG1lQHgub3JnAGFwcCBwdw=="), "{seen:?}");
        assert!(seen.contains(&"MAIL FROM:<me@x.org>".to_string()) && seen.contains(&"RCPT TO:<ann@y.org>".to_string()));
        assert!(seen.contains(&"DATA:..dot".to_string()) && seen.contains(&"DATA:.".to_string()));
    }

    #[tokio::test]
    async fn a_wrong_password_is_an_auth_error() {
        let (port, _server) = fake_server(false).await;
        let mut r = client(port).await;
        assert_eq!(converse(&mut r, "me@x.org", "nope", "me@x.org", "ann@y.org", b"x").await, Err(SmtpError::Auth));
    }

    #[tokio::test]
    async fn nothing_odd_reaches_the_wire() {
        let (port, _server) = fake_server(true).await;
        let mut r = client(port).await;
        assert!(matches!(converse(&mut r, "me@x.org", "pw", "me@x.org", "ann@y.org\r\nRCPT TO:<z@z.zz>", b"x").await, Err(SmtpError::Refused(_))));
        assert!(matches!(converse(&mut r, "me@x.org", "pw\r\nMAIL", "me@x.org", "ann@y.org", b"x").await, Err(SmtpError::Refused(_))));
        let mut rest = vec![];
        let _ = tokio::time::timeout(Duration::from_millis(50), r.read_to_end(&mut rest)).await;
        assert!(rest.is_empty(), "nothing was sent");
    }
}
