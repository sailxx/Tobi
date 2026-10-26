// Tobi's own Google OAuth client, so that nobody has to make one. A desktop app's client secret is
// not a secret (RFC 8252: it cannot be kept in code that is shipped), so both values live here in
// the open. Empty until the maintainer's client is added: then Settings asks for the user's own.
//
// The client is unverified by Google, so its sign-in shows the "isn't verified" page and takes at
// most 100 users; the user's own client (Settings → Gmail → "Use my own client") has no such limit.

pub const CLIENT_ID: &str = "";
pub const CLIENT_SECRET: &str = "";

/// Whether Tobi ships a client.
pub fn available() -> bool {
    !CLIENT_ID.is_empty() && !CLIENT_SECRET.is_empty()
}
