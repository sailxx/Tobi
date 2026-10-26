// What a Gmail message is for the island, and how a reply is written: headers, the plain text of a
// message (never its HTML: no remote content is ever loaded), and the RFC 822 text Gmail sends.
// Pure functions, tested without a network.

use serde_json::Value;

/// A body is cut here: the island shows a message, it is not a reader for long newsletters.
pub const MAX_TEXT: usize = 20_000;
pub const MAX_REPLY: usize = 20_000;

// ── base64 ────────────────────────────────────────────────────────────────────

/// Gmail's base64url, leniently: padding, whitespace and the standard alphabet are accepted.
pub fn b64_decode(text: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            _ => return None,
        } as u32)
    };
    let clean: Vec<u8> = text.bytes().filter(|c| !matches!(c, b'=' | b'\r' | b'\n' | b' ' | b'\t')).collect();
    if clean.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut n = 0u32;
        for (i, c) in chunk.iter().enumerate() {
            n |= val(*c)? << (18 - 6 * i as u32);
        }
        let bytes = n.to_be_bytes();
        out.extend_from_slice(&bytes[1..1 + chunk.len() * 6 / 8]);
    }
    Some(out)
}

const STD: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding.
pub fn b64_std(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(STD[(n >> 18) as usize & 63] as char);
        out.push(STD[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { STD[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { STD[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Standard base64 cut into lines of 76 characters, for a mail body.
fn b64_lines(bytes: &[u8]) -> String {
    b64_std(bytes).as_bytes().chunks(76).map(|l| String::from_utf8_lossy(l).into_owned()).collect::<Vec<_>>().join("\r\n")
}

// ── Headers ───────────────────────────────────────────────────────────────────

/// "Marie Curie <marie@x.org>" → ("Marie Curie", "marie@x.org"); a bare address → ("", address).
pub fn parse_from(raw: &str) -> (String, String) {
    let raw = raw.trim();
    if let (Some(open), Some(close)) = (raw.rfind('<'), raw.rfind('>')) {
        if open < close {
            let name = raw[..open].trim().trim_matches('"').trim().to_string();
            return (name, raw[open + 1..close].trim().to_string());
        }
    }
    (String::new(), raw.trim_matches(|c| c == '<' || c == '>').to_string())
}

/// What the list shows for a sender: the name, or the address when there is no name.
pub fn display_sender(raw: &str) -> String {
    let (name, addr) = parse_from(raw);
    if name.is_empty() { addr } else { name }
}

/// A plausible single address: no spaces, quotes, brackets, commas or line breaks, one @ with
/// something on both sides and a dot after it. Nothing that could add a header or a recipient.
pub fn valid_address(addr: &str) -> bool {
    let a = addr.trim();
    if a.is_empty() || a.len() > 254 || a.chars().any(|c| c.is_whitespace() || c.is_control() || "<>,;\"()[]\\".contains(c)) {
        return false;
    }
    let mut parts = a.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else { return false };
    !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

/// A header value on one line: line breaks cannot start another header.
fn one_line(s: &str) -> String {
    s.chars().map(|c| if c == '\r' || c == '\n' { ' ' } else { c }).collect::<String>().trim().to_string()
}

/// An RFC 2047 encoded word when the text is not plain ASCII.
fn header_text(s: &str) -> String {
    let s = one_line(s);
    if s.is_ascii() { s } else { format!("=?UTF-8?B?{}?=", b64_std(s.as_bytes())) }
}

/// "Re: x" for "x", "Re: x" for "Re: x" (not "Re: Re: x").
pub fn reply_subject(subject: &str) -> String {
    let s = one_line(subject);
    if s.to_ascii_lowercase().starts_with("re:") { s } else { format!("Re: {s}") }
}

// ── The plain text of a message ───────────────────────────────────────────────

fn header<'a>(payload: &'a Value, name: &str) -> Option<&'a str> {
    payload.get("headers")?.as_array()?.iter().find_map(|h| {
        (h.get("name")?.as_str()?.eq_ignore_ascii_case(name)).then(|| h.get("value")?.as_str()).flatten()
    })
}

/// A header of a Gmail `payload`.
pub fn payload_header(payload: &Value, name: &str) -> String {
    header(payload, name).unwrap_or_default().to_string()
}

fn part_text(part: &Value, want: &str) -> Option<String> {
    let mime = part.get("mimeType").and_then(Value::as_str).unwrap_or("");
    if mime == want {
        let data = part.get("body")?.get("data")?.as_str()?;
        return String::from_utf8(b64_decode(data)?).ok().or_else(|| Some(String::new()));
    }
    part.get("parts")?.as_array()?.iter().find_map(|p| part_text(p, want))
}

/// The readable text of a message: its text/plain part, or its text/html part stripped of tags.
pub fn extract_text(payload: &Value) -> String {
    extract_plain_or_html(part_text(payload, "text/plain"), part_text(payload, "text/html"))
}

/// The text to show from a message's plain part and its html part, whichever there is (plain first).
pub fn extract_plain_or_html(plain: Option<String>, html: Option<String>) -> String {
    let text = plain.filter(|t| !t.trim().is_empty()).or_else(|| html.map(|h| strip_html(&h))).unwrap_or_default();
    clip(text.replace("\r\n", "\n").trim().to_string(), MAX_TEXT)
}

fn clip(mut s: String, max: usize) -> String {
    if s.chars().count() > max {
        s = s.chars().take(max).collect();
        s.push('…');
    }
    s
}

/// HTML as text: tags, scripts and styles dropped, the common entities decoded, blocks as lines.
pub fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let lower = html.to_ascii_lowercase();
    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let rest = &lower[i..];
            let skip_to = ["script", "style", "head"].iter().find_map(|tag| {
                rest.starts_with(&format!("<{tag}")).then(|| lower[i..].find(&format!("</{tag}")).map(|p| i + p))
            });
            if let Some(Some(end)) = skip_to {
                i = lower[end..].find('>').map(|p| end + p + 1).unwrap_or(bytes.len());
                continue;
            }
            let end = lower[i..].find('>').map(|p| i + p + 1).unwrap_or(bytes.len());
            let tag = &lower[i + 1..end.saturating_sub(1).max(i + 1)];
            let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
            if matches!(name, "br" | "p" | "div" | "tr" | "li" | "h1" | "h2" | "h3" | "h4" | "table") && !out.ends_with('\n') {
                out.push('\n');
            }
            i = end;
        } else {
            let next = html[i..].find('<').map(|p| i + p).unwrap_or(html.len());
            out.push_str(&html[i..next]);
            i = next;
        }
    }
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    // Runs of blank lines and of spaces collapse.
    let mut result = String::new();
    let mut blank = 0;
    for line in decoded.lines() {
        let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        result.push_str(&line);
        result.push('\n');
    }
    result.trim().to_string()
}

// ── Writing a message ─────────────────────────────────────────────────────────

/// The RFC 822 text of a new message or a reply. `in_reply_to` / `references` make it a reply in the same
/// conversation. With `from` (SMTP, where nobody adds them for us) it also gets From, Date and Message-ID;
/// Gmail's own API leaves those to Gmail.
pub fn build_message(
    from: Option<&str>, to: &str, subject: &str, body: &str, in_reply_to: Option<&str>, references: Option<&str>,
) -> Result<Vec<u8>, &'static str> {
    if !valid_address(to) || from.is_some_and(|f| !valid_address(f)) {
        return Err("badAddress");
    }
    let body = body.replace("\r\n", "\n").replace('\n', "\r\n");
    let mut msg = String::new();
    if let Some(from) = from {
        let domain = from.rsplit('@').next().unwrap_or("localhost");
        msg.push_str(&format!("From: {}\r\n", one_line(from)));
        msg.push_str(&format!("Date: {}\r\n", rfc2822_date(std::time::SystemTime::now())));
        msg.push_str(&format!("Message-ID: <{}.{}@{domain}>\r\n", unix_millis(), std::process::id()));
    }
    msg.push_str(&format!("To: {}\r\n", one_line(to)));
    msg.push_str(&format!("Subject: {}\r\n", header_text(subject)));
    if let Some(id) = in_reply_to.map(one_line).filter(|s| !s.is_empty()) {
        msg.push_str(&format!("In-Reply-To: {id}\r\n"));
        let refs = references.map(one_line).filter(|s| !s.is_empty()).map(|r| format!("{r} {id}")).unwrap_or(id);
        msg.push_str(&format!("References: {refs}\r\n"));
    }
    msg.push_str("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n");
    msg.push_str(&b64_lines(body.as_bytes()));
    msg.push_str("\r\n");
    Ok(msg.into_bytes())
}

/// The message as Gmail's `raw` wants it: base64, URL-safe, no padding.
pub fn build_raw(to: &str, subject: &str, body: &str, in_reply_to: Option<&str>, references: Option<&str>) -> Result<String, &'static str> {
    let msg = build_message(None, to, subject, body, in_reply_to, references)?;
    Ok(b64_std(&msg).replace('+', "-").replace('/', "_").trim_end_matches('=').to_string())
}

fn unix_millis() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// "Tue, 15 Nov 1994 08:12:31 +0000" (UTC), as RFC 5322 writes a date.
pub fn rfc2822_date(t: std::time::SystemTime) -> String {
    let secs = t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    const DAYS: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    format!(
        "{}, {day:02} {} {year} {:02}:{:02}:{:02} +0000",
        DAYS[days.rem_euclid(7) as usize], MONTHS[(month - 1) as usize], rem / 3600, rem % 3600 / 60, rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn base64_goes_both_ways_and_is_lenient() {
        assert_eq!(b64_std(b"Man"), "TWFu");
        assert_eq!(b64_std(b"Ma"), "TWE=");
        assert_eq!(b64_std(b"M"), "TQ==");
        assert_eq!(b64_decode("TWFu").unwrap(), b"Man");
        assert_eq!(b64_decode("TWE=").unwrap(), b"Ma");
        assert_eq!(b64_decode("TWE").unwrap(), b"Ma");
        assert_eq!(b64_decode("-_-_").unwrap(), b64_decode("+/+/").unwrap());
        assert!(b64_decode("a").is_none() && b64_decode("T$Fu").is_none());
        let text = "Привет, мир ✓";
        assert_eq!(String::from_utf8(b64_decode(&b64_std(text.as_bytes())).unwrap()).unwrap(), text);
    }

    #[test]
    fn senders_are_split_and_shown() {
        assert_eq!(parse_from("Marie Curie <marie@x.org>"), ("Marie Curie".into(), "marie@x.org".into()));
        assert_eq!(parse_from("\"Curie, M.\" <m@x.org>"), ("Curie, M.".into(), "m@x.org".into()));
        assert_eq!(parse_from("a@b.co"), (String::new(), "a@b.co".into()));
        assert_eq!(parse_from("<a@b.co>"), (String::new(), "a@b.co".into()));
        assert_eq!(display_sender("Ann <a@b.co>"), "Ann");
        assert_eq!(display_sender("a@b.co"), "a@b.co");
    }

    #[test]
    fn only_a_plain_single_address_is_accepted() {
        assert!(valid_address("ann@example.com"));
        assert!(valid_address("a.b+c@mail.example.org"));
        for bad in ["", "ann", "ann@", "@x.org", "ann@x", "a b@x.org", "a@x.org, b@x.org", "a@x.org\r\nBcc: z@z.zz", "<a@x.org>", "a@@x.org", "a@x..", "\"a\"@x.org"] {
            assert!(!valid_address(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_reply_keeps_its_subject_and_cannot_inject_headers() {
        assert_eq!(reply_subject("Hello"), "Re: Hello");
        assert_eq!(reply_subject("Re: Hello"), "Re: Hello");
        assert_eq!(reply_subject("RE: Hello"), "RE: Hello");
        assert_eq!(reply_subject("Hi\r\nBcc: x@y.zz"), "Re: Hi  Bcc: x@y.zz");
        assert_eq!(build_raw("a@x.org\r\nBcc: z@z.zz", "s", "b", None, None), Err("badAddress"));
    }

    #[test]
    fn the_raw_message_decodes_to_a_well_formed_reply() {
        let raw = build_raw("ann@example.com", "Re: Привет", "Строка 1\nline 2", Some("<id1@x>"), Some("<id0@x>")).unwrap();
        assert!(!raw.contains('+') && !raw.contains('/') && !raw.contains('='), "URL-safe, no padding");
        let text = String::from_utf8(b64_decode(&raw).unwrap()).unwrap();
        assert!(text.starts_with("To: ann@example.com\r\nSubject: =?UTF-8?B?"));
        assert!(text.contains("In-Reply-To: <id1@x>\r\nReferences: <id0@x> <id1@x>\r\n"));
        assert!(text.contains("Content-Transfer-Encoding: base64\r\n\r\n"));
        let body = text.split("\r\n\r\n").nth(1).unwrap().replace("\r\n", "");
        assert_eq!(String::from_utf8(b64_decode(&body).unwrap()).unwrap(), "Строка 1\r\nline 2");
        let fresh = String::from_utf8(b64_decode(&build_raw("a@x.org", "Hi", "b", None, None).unwrap()).unwrap()).unwrap();
        assert!(!fresh.contains("In-Reply-To"));
    }

    #[test]
    fn a_date_is_written_the_rfc_way() {
        let at = |secs: u64| rfc2822_date(std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs));
        assert_eq!(at(0), "Thu, 01 Jan 1970 00:00:00 +0000");
        assert_eq!(at(784_887_151), "Tue, 15 Nov 1994 08:12:31 +0000");
        assert_eq!(at(1_709_164_800), "Thu, 29 Feb 2024 00:00:00 +0000");
    }

    #[test]
    fn smtp_gets_from_date_and_message_id_but_gmail_does_not() {
        let smtp = String::from_utf8(build_message(Some("me@mail.ru"), "ann@x.org", "Hi", "b", None, None).unwrap()).unwrap();
        assert!(smtp.starts_with("From: me@mail.ru\r\nDate: ") && smtp.contains("\r\nMessage-ID: <") && smtp.contains("@mail.ru>\r\nTo: ann@x.org\r\n"));
        let gmail = String::from_utf8(build_message(None, "ann@x.org", "Hi", "b", None, None).unwrap()).unwrap();
        assert!(gmail.starts_with("To: ann@x.org\r\n") && !gmail.contains("Message-ID"));
        assert!(build_message(Some("bad"), "ann@x.org", "Hi", "b", None, None).is_err());
    }

    #[test]
    fn the_text_of_a_message_comes_from_the_plain_part_or_the_html() {
        let plain = json!({"mimeType":"multipart/alternative","parts":[
            {"mimeType":"text/plain","body":{"data": b64_std("Hello\r\nworld".as_bytes()).replace('+',"-").replace('/',"_")}},
            {"mimeType":"text/html","body":{"data": b64_std(b"<b>HTML</b>")}}]});
        assert_eq!(extract_text(&plain), "Hello\nworld");
        let html_only = json!({"mimeType":"text/html","body":{"data": b64_std(b"<html><head><style>p{}</style></head><body><p>Hi &amp; bye</p><script>x()</script><div>Next<br>line</div></body></html>")}});
        assert_eq!(extract_text(&html_only), "Hi & bye\nNext\nline");
        assert_eq!(extract_text(&json!({"mimeType":"image/png"})), "");
    }

    #[test]
    fn a_long_text_is_cut() {
        let big = "x".repeat(MAX_TEXT + 50);
        let payload = json!({"mimeType":"text/plain","body":{"data": b64_std(big.as_bytes())}});
        let text = extract_text(&payload);
        assert_eq!(text.chars().count(), MAX_TEXT + 1);
        assert!(text.ends_with('…'));
    }

    #[test]
    fn headers_are_found_whatever_their_case() {
        let p = json!({"headers":[{"name":"SUBJECT","value":"S"},{"name":"From","value":"F"}]});
        assert_eq!(payload_header(&p, "Subject"), "S");
        assert_eq!(payload_header(&p, "from"), "F");
        assert_eq!(payload_header(&p, "To"), "");
    }
}
