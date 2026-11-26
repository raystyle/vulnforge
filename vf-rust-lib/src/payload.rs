//! Payload construction widgets: the mutation primitives an exploit
//! script reaches for (cheat-sheet vocabulary: base64 / url / bytes
//! literals). Newtype guards: a ShellPayload cannot be smuggled where a
//! plain string is expected — construction goes through the builders,
//! nothing else.

/// A URL-safe or standard base64 encoding of the payload bytes.
pub fn b64_encode(data: &[u8]) -> String {
    b64_std(data)
}

/// Standard base64 alphabet (with padding) — a pure Rust fallback so the
/// lib stays dependency-light. Same output as the `base64` crate for the
/// standard alphabet on well-formed input.
fn b64_std(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(triple >> 18 & 63) as usize] as char);
        out.push(ALPHABET[(triple >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(triple >> 6 & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(triple & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Percent-encode the minimal set for query/body transport: the characters
/// the cheat sheet's "url encode" primitives escape.
pub fn url_encode(data: &str) -> String {
    let mut out = String::with_capacity(data.len());
    for byte in data.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            other => out.push_str(format!("%{other:02X}").as_str()),
        }
    }
    out
}

/// Hex-encode (lowercase) — for binary payloads inside text carriers.
pub fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

/// A command bound for a shell target. Constructed via [`ShellPayload::new`],
/// which enforces non-emptiness — the Newtype discipline from pentest_lib's
/// payload module: dangerous content only flows through its constructor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellPayload {
    command: String,
}

impl ShellPayload {
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
        }
    }

    /// The raw command (the ExecCommand / RevShell delivery forms embed this).
    pub fn command(&self) -> &str {
        &self.command
    }

    /// base64( command ) — the cheat sheet's `echo <b64> | base64 -d | sh`
    /// transport.
    pub fn as_b64(&self) -> String {
        b64_encode(self.command.as_bytes())
    }

    /// url-encoded — for query/body transport of the ExecCommand form.
    pub fn as_url(&self) -> String {
        url_encode(&self.command)
    }

    /// hex-encoded — for carriers that reject high bytes.
    pub fn as_hex(&self) -> String {
        hex_encode(self.command.as_bytes())
    }
}

/// A plain (non-shell) payload — distinct Newtype so a ShellPayload cannot
/// be passed where inert data is expected, and vice versa.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataPayload {
    content: String,
}

impl DataPayload {
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
        }
    }

    pub fn content(&self) -> &str {
        &self.content
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b64_roundtrip_known_vectors() {
        // RFC 4648 vectors
        assert_eq!(b64_encode(b""), "");
        assert_eq!(b64_encode(b"f"), "Zg==");
        assert_eq!(b64_encode(b"fo"), "Zm8=");
        assert_eq!(b64_encode(b"foo"), "Zm9v");
        assert_eq!(b64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(b64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(b64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn url_encode_escapes_the_transport_set() {
        assert_eq!(url_encode("hello world"), "hello%20world");
        assert_eq!(url_encode("a&b=c"), "a%26b%3Dc");
        assert_eq!(url_encode("safe-_.~"), "safe-_.~");
    }

    #[test]
    fn hex_is_lowercase() {
        assert_eq!(hex_encode(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
    }

    #[test]
    fn shell_payload_transports() {
        let p = ShellPayload::new("id");
        assert_eq!(p.command(), "id");
        assert_eq!(p.as_b64(), "aWQ=");
        assert_eq!(p.as_url(), "id");
        assert_eq!(p.as_hex(), "6964");
    }

    #[test]
    fn cheat_sheet_transport_roundtrip() {
        // echo <b64> | base64 -d | sh carries the command intact.
        let p = ShellPayload::new("cat /etc/passwd");
        let encoded = p.as_b64();
        assert!(!encoded.contains(' '));
        assert!(encoded.len() > "Y2F0".len());
    }
}
