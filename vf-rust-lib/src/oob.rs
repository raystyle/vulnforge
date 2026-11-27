//! The OOB (out-of-band) callback channel for blind-exploitation Verify
//! steps (user ruling; precedents dissected in .research/rs-tools/oob.md):
//! interactsh (full protocol client), Burp Collaborator public polling
//! (pi-rs2 burp_collab protocol absorbed natively), and self-hosted DNSLog
//! (generic poll-URL face).
//!
//! Machine integration: the Verify step of a blind exploit (SSRF,
//! deserialization, no-echo RCE) polls until the callback arrives — hit =>
//! Outcome::Data(evidence), lease expiry => Outcome::Failure(
//! Atom::timeout). The lease report (attempts / elapsed / deadline_hit)
//! travels in the envelope so the AgentResult carries the wait, not just
//! the verdict.
//!
//! Secrets never travel through .vulnforge.json: the interactsh token and
//! the collaborator biid come from the environment (VF_OOB_TOKEN /
//! VF_OOB_BIID), which the run tool passes through. Public-server
//! discipline: markers carry no sensitive data — third parties can read
//! public server interaction records.

use std::time::{Duration, Instant};

use rand::rngs::OsRng;
use rand::seq::SliceRandom;
use rand::RngCore;
use rsa::pkcs8::EncodePublicKey;
use rsa::{Oaep, RsaPrivateKey};
use serde_json::{json, Value};
use sha2::Sha256;

use crate::error::Atom;

/// Default public interactsh servers (projectdiscovery client default).
pub const DEFAULT_INTERACTSH_SERVERS: &str =
    "oast.pro,oast.live,oast.site,oast.online,oast.fun,oast.me";

const XID_ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuv";
const ZBASE32_ALPHABET: &[u8] = b"ybndrfg8ejkmcpqxot1uwisza345h769";
const COLLAB_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
const CORRELATION_ID_LEN: usize = 20;
const NONCE_LEN: usize = 13;

/// The poll lease: how often to poll and when to stop waiting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lease {
    /// Milliseconds between polls.
    pub every_ms: u64,
    /// Total wall-clock budget in milliseconds.
    pub deadline_ms: u64,
}

impl Default for Lease {
    fn default() -> Self {
        Self {
            every_ms: 5_000,
            deadline_ms: 60_000,
        }
    }
}

/// The structured outcome of a lease poll — the AgentResult carries the
/// wait, not just the verdict (pi-rs2 oob_poll envelope shape).
#[derive(Debug, Clone)]
pub struct PollReport {
    pub hit: bool,
    pub attempts: u32,
    pub elapsed_ms: u64,
    pub deadline_hit: bool,
    /// Matched interaction evidence (provider-shaped JSON).
    pub evidence: Vec<Value>,
    /// Last transient poll error, kept for diagnosis (auth failures abort
    /// the loop instead of being retried).
    pub last_error: Option<String>,
}

/// A minted callback: the match key, the DNS host, and the HTTP(S) URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Minted {
    /// The match key — poll evidence must contain this id.
    pub id: String,
    /// DNS callback host ({id}.{domain}).
    pub host: String,
    /// HTTPS callback URL (https://{host}/).
    pub url: String,
}

/// The generic lease loop: poll on a cadence, match each interaction, stop
/// at the first hit or the deadline. Transient poll errors are tolerated
/// (recorded, retried within the lease); auth failures abort immediately —
/// retrying a 401 is pointless.
pub fn poll_until<F, M>(lease: &Lease, mut poll: F, matches: M) -> Result<PollReport, Atom>
where
    F: FnMut() -> Result<Vec<Value>, Atom>,
    M: Fn(&Value) -> bool,
{
    let start = Instant::now();
    let mut attempts = 0u32;
    let mut last_error: Option<String> = None;
    loop {
        attempts += 1;
        match poll() {
            Ok(items) => {
                let evidence: Vec<Value> = items.into_iter().filter(|item| matches(item)).collect();
                if !evidence.is_empty() {
                    return Ok(PollReport {
                        hit: true,
                        attempts,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                        deadline_hit: false,
                        evidence,
                        last_error,
                    });
                }
            }
            Err(atom) => {
                if atom.kind == "auth_denied" {
                    return Err(atom);
                }
                last_error = Some(format!("{}: {}", atom.code, atom.message));
            }
        }
        if start.elapsed().as_millis() as u64 >= lease.deadline_ms {
            return Ok(PollReport {
                hit: false,
                attempts,
                elapsed_ms: start.elapsed().as_millis() as u64,
                deadline_hit: true,
                evidence: Vec::new(),
                last_error,
            });
        }
        std::thread::sleep(Duration::from_millis(lease.every_ms));
    }
}

/// The interactsh client (projectdiscovery protocol, pkg/client
/// dissected): RSA-2048 registration, correlation-id + nonce payloads,
/// AES-encrypted poll reads, deregistration. Short-lived session model —
/// no keep-alive; a script's lease is minutes, server eviction is hours.
pub struct InteractshClient {
    agent: ureq::Agent,
    server_url: String,
    domain: String,
    correlation_id: String,
    secret_key: String,
    token: String,
    priv_key: RsaPrivateKey,
}

impl InteractshClient {
    /// Register against the first server that accepts us (servers visited
    /// in random order, matching the Go client).
    pub fn register(servers_csv: &str, token: &str) -> Result<Self, Atom> {
        let mut servers: Vec<&str> = servers_csv
            .split(',')
            .map(str::trim)
            .filter(|server| !server.is_empty())
            .collect();
        if servers.is_empty() {
            return Err(Atom::parse("E_OOB_001", "no interactsh servers configured"));
        }
        servers.shuffle(&mut OsRng);
        let mut last_error = String::new();
        for server in servers {
            match Self::register_one(server, token) {
                Ok(client) => return Ok(client),
                Err(atom) => last_error = format!("{server}: {}", atom.message),
            }
        }
        Err(Atom::net_unreachable(
            "E_OOB_002",
            format!("register failed on every server ({last_error})"),
        ))
    }

    fn register_one(server: &str, token: &str) -> Result<Self, Atom> {
        let base = if server.starts_with("http://") || server.starts_with("https://") {
            server.trim_end_matches('/').to_string()
        } else {
            format!("https://{server}")
        };
        let mut rng = OsRng;
        let priv_key = RsaPrivateKey::new(&mut rng, 2048)
            .map_err(|error| Atom::parse("E_OOB_003", format!("rsa keygen: {error}")))?;
        let correlation_id = random_alphabet(XID_ALPHABET, CORRELATION_ID_LEN);
        let secret_key = uuid_v4();
        let public_key = encode_public_key_pem_b64(&priv_key)?;
        let body = register_body(&public_key, &secret_key, &correlation_id);
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(15))
            .build();
        let mut request = agent
            .post(&format!("{base}/register"))
            .set("Content-Type", "application/json");
        if !token.is_empty() {
            request = request.set("Authorization", token);
        }
        let response = request.send_string(&body).map_err(map_ureq_error)?;
        let text = response
            .into_string()
            .map_err(|error| Atom::parse("E_OOB_007", format!("read register body: {error}")))?;
        let parsed: Value = serde_json::from_str(&text)
            .map_err(|error| Atom::parse("E_OOB_007", format!("parse register body: {error}")))?;
        if parsed["message"] != json!("registration successful") {
            return Err(Atom::protocol_mismatch(
                "E_OOB_005",
                format!("register refused: {text}"),
            ));
        }
        let domain = base
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .to_string();
        Ok(Self {
            agent,
            server_url: base,
            domain,
            correlation_id,
            secret_key,
            token: token.to_string(),
            priv_key,
        })
    }

    /// Mint a fresh callback: {correlation-id}{nonce}.{domain} — the
    /// 33-char id is the match key (zbase32 nonce, Go client shape).
    pub fn mint(&self) -> Minted {
        let nonce = random_alphabet(ZBASE32_ALPHABET, NONCE_LEN);
        let id = format!("{}{}", self.correlation_id, nonce);
        let host = format!("{}.{}", id, self.domain);
        Minted {
            id,
            host: host.clone(),
            url: format!("https://{host}/"),
        }
    }

    /// One poll: GET /poll, decrypt the AES-encrypted data items, pass
    /// through the plaintext extra/tlddata channels. Reads are one-shot —
    /// the server's interaction buffer for this correlation id drains.
    pub fn poll_once(&self) -> Result<Vec<Value>, Atom> {
        let url = format!(
            "{}/poll?id={}&secret={}",
            self.server_url,
            self.correlation_id,
            crate::payload::url_encode(&self.secret_key)
        );
        let mut request = self.agent.get(&url).set("Accept", "application/json");
        if !self.token.is_empty() {
            request = request.set("Authorization", &self.token);
        }
        let response = request.call().map_err(map_ureq_error)?;
        let text = response
            .into_string()
            .map_err(|error| Atom::parse("E_OOB_007", format!("read poll body: {error}")))?;
        let parsed: Value = serde_json::from_str(&text)
            .map_err(|error| Atom::parse("E_OOB_007", format!("parse poll body: {error}")))?;
        interactsh_decrypted_items(&self.priv_key, &parsed)
    }

    /// Poll under a lease until an interaction matches the minted id.
    pub fn poll_until_hit(&self, marker: &str, lease: &Lease) -> Result<PollReport, Atom> {
        poll_until(
            lease,
            || self.poll_once(),
            |item| interactsh_matches(item, marker),
        )
    }

    /// Deregister the session (best effort; the lease model makes this
    /// hygiene, not correctness).
    pub fn deregister(&self) -> Result<(), Atom> {
        let body = json!({
            "correlation-id": self.correlation_id,
            "secret-key": self.secret_key,
        })
        .to_string();
        let mut request = self
            .agent
            .post(&format!("{}/deregister", self.server_url))
            .set("Content-Type", "application/json");
        if !self.token.is_empty() {
            request = request.set("Authorization", &self.token);
        }
        request.send_string(&body).map_err(map_ureq_error)?;
        Ok(())
    }
}

fn interactsh_matches(item: &Value, marker: &str) -> bool {
    let unique = item["unique-id"].as_str().unwrap_or("");
    let full = item["full-id"].as_str().unwrap_or("");
    unique == marker || full.contains(marker)
}

/// The register request body — kebab-case keys are the protocol (Go
/// RegisterRequest tags); camelCase would decode to empty server-side.
fn register_body(public_key: &str, secret_key: &str, correlation_id: &str) -> String {
    json!({
        "public-key": public_key,
        "secret-key": secret_key,
        "correlation-id": correlation_id,
    })
    .to_string()
}

/// Decrypt the poll response: aes_key is base64(RSA-OAEP-SHA256(32-byte
/// AES-256 key)); each data item is base64(IV || AES-CTR(json)). extra and
/// tlddata items are plaintext JSON strings (server-side token/root-tld
/// channels). One failed item does not fail the poll (the Go client
/// skips and continues).
fn interactsh_decrypted_items(
    priv_key: &RsaPrivateKey,
    response: &Value,
) -> Result<Vec<Value>, Atom> {
    let aes_key_b64 = response["aes_key"].as_str().unwrap_or("");
    let data = response["data"].as_array().cloned().unwrap_or_default();
    let mut out = Vec::new();
    if !data.is_empty() {
        if aes_key_b64.is_empty() {
            return Err(Atom::parse(
                "E_OOB_008",
                "encrypted data present but aes_key is empty",
            ));
        }
        let enc_key = crate::webshell::b64_decode(aes_key_b64)
            .ok_or_else(|| Atom::parse("E_OOB_008", "aes_key is not valid base64"))?;
        let aes_key = priv_key
            .decrypt(Oaep::new::<Sha256>(), &enc_key)
            .map_err(|error| Atom::parse("E_OOB_008", format!("unwrap aes_key: {error}")))?;
        if aes_key.len() != 32 {
            return Err(Atom::parse(
                "E_OOB_008",
                "unwrapped aes_key is not 32 bytes",
            ));
        }
        for item in data {
            let cipher_b64 = item.as_str().unwrap_or("");
            let Some(mut buf) = crate::webshell::b64_decode(cipher_b64) else {
                continue;
            };
            if buf.len() < 16 {
                continue;
            }
            let iv = buf[..16].to_vec();
            aes256_ctr(&aes_key, &iv, &mut buf[16..]);
            if let Ok(text) = String::from_utf8(buf[16..].to_vec()) {
                if let Ok(value) = serde_json::from_str(&text) {
                    out.push(value);
                }
            }
        }
    }
    for key in ["extra", "tlddata"] {
        for item in response[key].as_array().cloned().unwrap_or_default() {
            if let Some(text) = item.as_str() {
                if let Ok(value) = serde_json::from_str(text) {
                    out.push(value);
                }
            }
        }
    }
    Ok(out)
}

/// SPKI DER wrapped in an "RSA PUBLIC KEY" PEM block, base64'd — the exact
/// shape the interactsh server parses (Go: pem.Decode + ParsePKIXPublicKey).
fn encode_public_key_pem_b64(priv_key: &RsaPrivateKey) -> Result<String, Atom> {
    let document = priv_key
        .to_public_key()
        .to_public_key_der()
        .map_err(|error| Atom::parse("E_OOB_003", format!("spki encode: {error}")))?;
    let body = wrap64(&crate::payload::b64_encode(document.as_bytes()));
    let pem = format!("-----BEGIN RSA PUBLIC KEY-----\n{body}\n-----END RSA PUBLIC KEY-----\n");
    Ok(crate::payload::b64_encode(pem.as_bytes()))
}

fn wrap64(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + text.len() / 64);
    for (index, ch) in text.chars().enumerate() {
        if index > 0 && index % 64 == 0 {
            out.push('\n');
        }
        out.push(ch);
    }
    out
}

/// The Burp Collaborator public-polling client (pi-rs2 burp_collab
/// protocol absorbed natively): the biid secret derives <label>.oastify
/// hosts; the polling host reads the interactions back. DNS labels carry
/// exfiltrated data in the subdomain prefix (plaintext, no decode
/// needed); body channels risk dropped characters — the content-length
/// check guards that (pi-rs2 lesson).
pub struct CollaboratorClient {
    agent: ureq::Agent,
    server: String,
    poll_host: String,
    biid_b64: String,
    raw_biid: Vec<u8>,
    counter: u64,
}

impl CollaboratorClient {
    pub fn new(biid_b64: &str, server: &str, poll_host: &str) -> Result<Self, Atom> {
        let raw = crate::webshell::b64_decode(biid_b64)
            .ok_or_else(|| Atom::parse("E_OOB_009", "biid is not valid base64"))?;
        if raw.len() != 32 {
            return Err(Atom::parse(
                "E_OOB_009",
                format!("biid decodes to {} bytes, expected 32", raw.len()),
            ));
        }
        Ok(Self {
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(20))
                .build(),
            server: server.to_string(),
            poll_host: poll_host.to_string(),
            biid_b64: biid_b64.to_string(),
            raw_biid: raw,
            counter: 0,
        })
    }

    /// The secret comes from the environment, never from config files.
    pub fn from_env() -> Result<Self, Atom> {
        let biid = std::env::var("VF_OOB_BIID").map_err(|_| {
            Atom::auth_denied(
                "E_OOB_009",
                "VF_OOB_BIID not set (standard base64 of the 32-byte collaborator secret)",
            )
        })?;
        Self::new(
            &biid,
            &env_or("VF_OOB_SERVER", "oastify.com"),
            &env_or("VF_OOB_POLL_HOST", "polling.oastify.com"),
        )
    }

    /// Mint a callback host from the biid (counter-keyed, random salt —
    /// every mint is unique).
    pub fn mint(&mut self) -> Result<Minted, Atom> {
        let label = derive_label(&self.raw_biid, self.counter)?;
        self.counter += 1;
        let host = format!("{}.{}", label, self.server);
        Ok(Minted {
            id: label,
            host: host.clone(),
            url: format!("https://{host}/"),
        })
    }

    pub fn poll_once(&self) -> Result<Vec<Value>, Atom> {
        let url = format!(
            "https://{}/burpresults?biid={}",
            self.poll_host,
            crate::payload::url_encode(&self.biid_b64)
        );
        let response = self
            .agent
            .get(&url)
            .set("Accept", "application/json")
            .call()
            .map_err(map_ureq_error)?;
        let declared = response
            .header("Content-Length")
            .and_then(|value| value.parse::<usize>().ok());
        let text = response
            .into_string()
            .map_err(|error| Atom::parse("E_OOB_007", format!("read poll body: {error}")))?;
        let check = match declared {
            Some(length) if length == text.len() => "ok",
            Some(_) => "mismatch",
            None => "absent",
        };
        let mut parsed: Value = if text.trim().is_empty() {
            json!({"responses": []})
        } else {
            let snippet: String = text.chars().take(120).collect();
            serde_json::from_str(&text).map_err(|error| {
                Atom::parse(
                    "E_OOB_007",
                    format!("parse poll body: {error} :: {snippet}"),
                )
            })?
        };
        if let Some(object) = parsed.as_object_mut() {
            object.insert("content_length_check".to_string(), json!(check));
        }
        Ok(summarize_collaborator(&parsed))
    }

    pub fn poll_until_hit(&self, marker: &str, lease: &Lease) -> Result<PollReport, Atom> {
        poll_until(
            lease,
            || self.poll_once(),
            |item| item["sub_domain"].as_str().unwrap_or("").contains(marker),
        )
    }
}

/// Reduce the collaborator poll response to evidence rows (pi-rs2
/// summarize shape: sub_domain and prefix carry the exfiltrated data).
fn summarize_collaborator(response: &Value) -> Vec<Value> {
    response["responses"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|interaction| {
            let data = &interaction["data"];
            let sub_domain = data["subDomain"].as_str().unwrap_or("");
            json!({
                "protocol": interaction["protocol"],
                "time": interaction["time"],
                "client": interaction["client"],
                "sub_domain": sub_domain,
                "prefix": sub_domain.split('.').next().unwrap_or(""),
                "interaction_id": interaction["interactionString"],
                "content_length_check": response["content_length_check"],
            })
        })
        .collect()
}

fn base36_be(bytes: &[u8]) -> String {
    let mut digits = Vec::new();
    let mut work = bytes.to_vec();
    loop {
        let mut remainder: u32 = 0;
        let mut all_zero = true;
        for byte in work.iter_mut() {
            let current = remainder * 256 + *byte as u32;
            *byte = (current / 36) as u8;
            remainder = current % 36;
            if *byte != 0 {
                all_zero = false;
            }
        }
        digits.push(COLLAB_ALPHABET[remainder as usize] as char);
        if all_zero {
            break;
        }
    }
    digits.reverse();
    digits.into_iter().collect()
}

fn checksum_char(value: &str) -> char {
    let sum: usize = value.bytes().map(|b| b as usize).sum();
    COLLAB_ALPHABET[sum % 36] as char
}

fn key_hash(raw_biid: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    let digest = Sha1::digest(raw_biid);
    let mut encoded = base36_be(&digest);
    while encoded.len() < 20 {
        encoded.insert(0, 'a');
    }
    let key = &encoded[..20];
    let (left, right) = (&key[..10], &key[10..20]);
    format!(
        "{}{}{}{}",
        left,
        checksum_char(left),
        right,
        checksum_char(right)
    )
}

fn collab_index(ch: u8) -> Option<usize> {
    COLLAB_ALPHABET.iter().position(|&x| x == ch)
}

/// The collaborator interaction-id cipher: two rotating state registers
/// keyed by the salt; reversible by the polling service.
fn encrypt_interaction_id(plaintext: &str, salt: (u8, u8)) -> Result<String, Atom> {
    let (s1, s2) = salt;
    let mut state = [s1, s2];
    let mut out = String::new();
    for (i, ch) in plaintext.bytes().enumerate() {
        let ci = collab_index(ch).ok_or_else(|| {
            Atom::parse(
                "E_OOB_009",
                format!("unsupported payload char {:?}", ch as char),
            )
        })?;
        let reg = i % 2;
        let si = collab_index(state[reg]).unwrap();
        let cc = COLLAB_ALPHABET[(ci + si) % 36];
        out.push(cc as char);
        state[reg] = cc;
    }
    let salt_checksum = COLLAB_ALPHABET[(s1 as usize + s2 as usize) % 36];
    Ok(format!(
        "{}{}{}{}",
        s1 as char, s2 as char, salt_checksum as char, out
    ))
}

fn derive_label(raw_biid: &[u8], counter: u64) -> Result<String, Atom> {
    let kh = key_hash(raw_biid);
    let client_part = format!("{counter:x}y");
    let plaintext = format!("{kh}1g{client_part}z");
    let mut rng = OsRng;
    let mut salt_bytes = [0u8; 2];
    rng.fill_bytes(&mut salt_bytes);
    let salt = (
        COLLAB_ALPHABET[salt_bytes[0] as usize % 36],
        COLLAB_ALPHABET[salt_bytes[1] as usize % 36],
    );
    encrypt_interaction_id(&plaintext, salt)
}

/// The self-hosted DNSLog face (DNSLog-GO / cola_dnslog shape): a random
/// label under a config-declared domain, and a poll URL template with a
/// {marker} / {host} hole. Covers lab scenarios without public egress.
pub struct DnslogClient {
    agent: ureq::Agent,
    domain: String,
    poll_url: String,
}

impl DnslogClient {
    pub fn new(domain: &str, poll_url: &str) -> Result<Self, Atom> {
        if domain.is_empty() {
            return Err(Atom::parse(
                "E_OOB_010",
                "dnslog domain is empty (set VF_OOB_DOMAIN)",
            ));
        }
        if !poll_url.contains("{marker}") && !poll_url.contains("{host}") {
            return Err(Atom::parse(
                "E_OOB_010",
                "poll URL template has no {marker} or {host} hole (set VF_OOB_POLL_URL)",
            ));
        }
        Ok(Self {
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(15))
                .build(),
            domain: domain.to_string(),
            poll_url: poll_url.to_string(),
        })
    }

    pub fn from_env() -> Result<Self, Atom> {
        Self::new(&env_or("VF_OOB_DOMAIN", ""), &env_or("VF_OOB_POLL_URL", ""))
    }

    pub fn mint(&self) -> Minted {
        let label = random_alphabet(b"abcdefghijklmnopqrstuvwxyz0123456789", 12);
        let host = format!("{}.{}", label, self.domain);
        Minted {
            id: label,
            host: host.clone(),
            url: format!("http://{host}/"),
        }
    }

    pub fn poll_once(&self, marker: &str) -> Result<Vec<Value>, Atom> {
        let host = format!("{}.{}", marker, self.domain);
        let url = self
            .poll_url
            .replace("{marker}", marker)
            .replace("{host}", &host);
        let response = self.agent.get(&url).call().map_err(map_ureq_error)?;
        let text = response
            .into_string()
            .map_err(|error| Atom::parse("E_OOB_007", format!("read poll body: {error}")))?;
        Ok(text.lines().map(|line| json!({ "line": line })).collect())
    }

    pub fn poll_until_hit(&self, marker: &str, lease: &Lease) -> Result<PollReport, Atom> {
        poll_until(
            lease,
            || self.poll_once(marker),
            |item| item["line"].as_str().unwrap_or("").contains(marker),
        )
    }
}

/// The provider dispatch — VF_OOB_PROVIDER selects the channel. Facts may
/// come from .vulnforge.json's oob section (passed through as VF_OOB_*
/// env by the run tool); secrets only ever come from the user's
/// environment.
pub enum OobProvider {
    Interactsh(Box<InteractshClient>),
    Collaborator(Box<CollaboratorClient>),
    Dnslog(Box<DnslogClient>),
}

impl OobProvider {
    pub fn from_env() -> Result<Self, Atom> {
        match env_or("VF_OOB_PROVIDER", "interactsh").as_str() {
            "interactsh" => Ok(Self::Interactsh(Box::new(InteractshClient::register(
                &env_or("VF_OOB_SERVER", DEFAULT_INTERACTSH_SERVERS),
                &env_or("VF_OOB_TOKEN", ""),
            )?))),
            "collaborator" => Ok(Self::Collaborator(
                Box::new(CollaboratorClient::from_env()?),
            )),
            "dnslog" => Ok(Self::Dnslog(Box::new(DnslogClient::from_env()?))),
            other => Err(Atom::parse(
                "E_OOB_011",
                format!("unknown VF_OOB_PROVIDER {other:?} (interactsh | collaborator | dnslog)"),
            )),
        }
    }

    pub fn mint(&mut self) -> Result<Minted, Atom> {
        match self {
            Self::Interactsh(client) => Ok(client.mint()),
            Self::Collaborator(client) => client.mint(),
            Self::Dnslog(client) => Ok(client.mint()),
        }
    }

    pub fn poll_until_hit(&self, marker: &str, lease: &Lease) -> Result<PollReport, Atom> {
        match self {
            Self::Interactsh(client) => client.poll_until_hit(marker, lease),
            Self::Collaborator(client) => client.poll_until_hit(marker, lease),
            Self::Dnslog(client) => client.poll_until_hit(marker, lease),
        }
    }

    /// Session teardown (deregistration where the protocol has it).
    pub fn close(&self) -> Result<(), Atom> {
        match self {
            Self::Interactsh(client) => client.deregister(),
            _ => Ok(()),
        }
    }
}

fn env_or(name: &str, default: &str) -> String {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_string(),
        _ => default.to_string(),
    }
}

fn random_alphabet(alphabet: &[u8], length: usize) -> String {
    let mut rng = OsRng;
    let mut out = String::with_capacity(length);
    for _ in 0..length {
        let mut byte = [0u8; 1];
        rng.fill_bytes(&mut byte);
        out.push(alphabet[byte[0] as usize % alphabet.len()] as char);
    }
    out
}

/// A uuid-v4-shaped secret (the server treats it as an opaque string; the
/// shape matches the Go client).
fn uuid_v4() -> String {
    let mut rng = OsRng;
    let mut bytes = [0u8; 16];
    rng.fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = crate::payload::hex_encode(&bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// AES-256 in CTR mode with a full-width big-endian counter (Go
/// cipher.NewCTR semantics: the IV is the initial counter block,
/// incremented across blocks). NIST SP 800-38A F.5.5 vector tested below.
fn aes256_ctr(key: &[u8], iv: &[u8], data: &mut [u8]) {
    use aes::cipher::generic_array::GenericArray;
    use aes::cipher::{BlockEncrypt, KeyInit};

    let cipher = aes::Aes256::new(GenericArray::from_slice(key));
    let mut counter = [0u8; 16];
    counter.copy_from_slice(iv);
    let mut keystream = GenericArray::from([0u8; 16]);
    for (index, chunk) in data.chunks_mut(16).enumerate() {
        if index > 0 {
            for byte in counter.iter_mut().rev() {
                let (value, carry) = byte.overflowing_add(1);
                *byte = value;
                if !carry {
                    break;
                }
            }
        }
        keystream.copy_from_slice(&counter);
        cipher.encrypt_block(&mut keystream);
        for (byte, mask) in chunk.iter_mut().zip(keystream.iter()) {
            *byte ^= mask;
        }
    }
}

/// Strip anything after the host from a URL-ish string: poll URLs carry
/// `?biid=` / `?secret=` secrets, and ureq's Transport Display prints the
/// full URL — the message must never carry the query. Response bodies can
/// echo the request line (some 4xx pages), so the same sanitizer applies.
fn redact_url(text: &str) -> String {
    let no_query = text
        .split(['?', ' '])
        .next()
        .unwrap_or_default()
        .to_string();
    // Fragments and credentials never appear in ureq URLs, but a body
    // snippet may contain arbitrary text — keep only the scheme+host part.
    let host_part = no_query
        .split_once("://")
        .map(|(_, rest)| rest.split('/').next().unwrap_or_default().to_string())
        .unwrap_or(no_query);
    host_part
}

fn map_ureq_error(error: ureq::Error) -> Atom {
    match error {
        ureq::Error::Status(401, _) => Atom::auth_denied(
            "E_OOB_004",
            "server returned 401 (set VF_OOB_TOKEN for token-auth servers)",
        ),
        ureq::Error::Status(code, response) => {
            let body = response.into_string().unwrap_or_default();
            let snippet: String = redact_url(&body).chars().take(120).collect();
            Atom::protocol_mismatch("E_OOB_005", format!("http {code}: {snippet}"))
        }
        ureq::Error::Transport(transport) => Atom::net_unreachable(
            "E_OOB_006",
            format!(
                "transport: {} ({})",
                redact_url(&transport.to_string()),
                transport.kind()
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rsa::RsaPublicKey;

    fn hex_to_bytes(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn correlation_id_and_nonce_shapes() {
        for _ in 0..100 {
            let id = random_alphabet(XID_ALPHABET, CORRELATION_ID_LEN);
            assert_eq!(id.len(), 20);
            assert!(id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'v').contains(&b)));
            let nonce = random_alphabet(ZBASE32_ALPHABET, NONCE_LEN);
            assert_eq!(nonce.len(), 13);
            assert!(nonce.bytes().all(|b| ZBASE32_ALPHABET.contains(&b)));
        }
    }

    #[test]
    fn register_body_uses_kebab_case_keys() {
        let body = register_body("PK", "SEC", "cid");
        let parsed: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["public-key"], json!("PK"));
        assert_eq!(parsed["secret-key"], json!("SEC"));
        assert_eq!(parsed["correlation-id"], json!("cid"));
    }

    #[test]
    fn uuid_v4_shape() {
        let id = uuid_v4();
        assert_eq!(id.len(), 36);
        assert_eq!(id.as_bytes()[14], b'4');
    }

    #[test]
    fn aes256_ctr_matches_nist_sp800_38a_f55() {
        let key = hex_to_bytes("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
        let iv = hex_to_bytes("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
        let mut block = hex_to_bytes("6bc1bee22e409f96e93d7e117393172a");
        aes256_ctr(&key, &iv, &mut block);
        assert_eq!(
            crate::payload::hex_encode(&block),
            "601ec313775789a5b7a7f504bbf3d228"
        );
    }

    #[test]
    fn interactsh_poll_decrypt_roundtrip() {
        let mut rng = OsRng;
        let priv_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let pub_key = RsaPublicKey::from(&priv_key);
        let aes_key: Vec<u8> = (0..32u8).collect();
        let enc_key = pub_key
            .encrypt(&mut rng, Oaep::new::<Sha256>(), &aes_key)
            .unwrap();
        let interaction = json!({
            "protocol": "dns",
            "unique-id": "abc",
            "full-id": "abc.oast.fun",
            "remote-address": "1.2.3.4:53",
        });
        let plaintext = interaction.to_string();
        let iv = [7u8; 16];
        let mut buf = Vec::with_capacity(16 + plaintext.len());
        buf.extend_from_slice(&iv);
        buf.extend_from_slice(plaintext.as_bytes());
        aes256_ctr(&aes_key, &iv, &mut buf[16..]);
        let extra = serde_json::to_string(&json!({"protocol": "http"})).unwrap();
        let response = json!({
            "data": [crate::payload::b64_encode(&buf)],
            "extra": [extra],
            "tlddata": [],
            "aes_key": crate::payload::b64_encode(&enc_key),
        });
        let items = interactsh_decrypted_items(&priv_key, &response).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["full-id"], json!("abc.oast.fun"));
        assert_eq!(items[0]["protocol"], json!("dns"));
        assert_eq!(items[1]["protocol"], json!("http"));
    }

    #[test]
    fn interactsh_matching_by_unique_or_full_id() {
        let marker = "abc123";
        assert!(interactsh_matches(
            &json!({"unique-id": marker, "full-id": format!("{marker}.oast.fun")}),
            marker
        ));
        assert!(interactsh_matches(
            &json!({"unique-id": marker, "full-id": format!("whoami.{marker}.oast.fun")}),
            marker
        ));
        assert!(!interactsh_matches(
            &json!({"unique-id": "zzz", "full-id": "zzz.oast.fun"}),
            marker
        ));
    }

    #[test]
    fn public_key_pem_shape_matches_server_parser() {
        use rsa::pkcs8::DecodePublicKey;
        let mut rng = OsRng;
        let priv_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let b64 = encode_public_key_pem_b64(&priv_key).unwrap();
        let pem = String::from_utf8(crate::webshell::b64_decode(&b64).unwrap()).unwrap();
        assert!(pem.starts_with("-----BEGIN RSA PUBLIC KEY-----"));
        assert!(pem.ends_with("-----END RSA PUBLIC KEY-----\n"));
        let body: String = pem
            .lines()
            .skip(1)
            .take_while(|line| !line.starts_with("---"))
            .collect();
        let der = crate::webshell::b64_decode(&body).unwrap();
        let recovered = RsaPublicKey::from_public_key_der(&der).unwrap();
        assert_eq!(recovered, RsaPublicKey::from(&priv_key));
    }

    #[test]
    fn collaborator_label_cipher_is_reversible() {
        let raw: Vec<u8> = (0..32).collect();
        let label = derive_label(&raw, 0).unwrap();
        let bytes = label.as_bytes();
        let (s1, s2) = (bytes[0], bytes[1]);
        let mut state = [s1, s2];
        let mut plain = String::new();
        for (i, &ch) in bytes[3..].iter().enumerate() {
            let ci = collab_index(ch).unwrap();
            let si = collab_index(state[i % 2]).unwrap();
            let pc = COLLAB_ALPHABET[(ci + 36 - si) % 36];
            plain.push(pc as char);
            state[i % 2] = ch;
        }
        let kh = key_hash(&raw);
        assert!(
            plain.starts_with(&kh),
            "recovered {plain} does not start with key hash {kh}"
        );
    }

    #[test]
    fn collaborator_key_hash_shape() {
        let kh = key_hash(&[42u8; 32]);
        assert_eq!(kh.len(), 22);
        assert_ne!(key_hash(&[43u8; 32]), kh);
    }

    #[test]
    fn collaborator_poll_fixture_summarizes() {
        let fixture = json!({
            "responses": [
                {
                    "protocol": "dns",
                    "time": "2026-11-27T00:00:00Z",
                    "client": "1.2.3.4",
                    "interactionString": "abc123",
                    "data": { "subDomain": "whoami.abc123label.oastify.com", "type": "A" },
                }
            ],
            "content_length_check": "ok",
        });
        let rows = summarize_collaborator(&fixture);
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0]["sub_domain"],
            json!("whoami.abc123label.oastify.com")
        );
        assert_eq!(rows[0]["prefix"], json!("whoami"));
        assert!(rows[0]["sub_domain"]
            .as_str()
            .unwrap()
            .contains("abc123label"));
        assert_eq!(rows[0]["content_length_check"], json!("ok"));
    }

    #[test]
    fn collaborator_rejects_bad_biid() {
        assert!(CollaboratorClient::new("!!!", "oastify.com", "polling.oastify.com").is_err());
        let short = crate::payload::b64_encode(&[0u8; 16]);
        assert!(CollaboratorClient::new(&short, "oastify.com", "polling.oastify.com").is_err());
    }

    #[test]
    fn dnslog_template_and_mint_shape() {
        let client =
            DnslogClient::new("dns.lab", "http://dns.lab/api?token=t&domain={host}").unwrap();
        let minted = client.mint();
        assert!(minted.host.ends_with(".dns.lab"));
        assert_eq!(minted.id.len(), 12);
        assert_eq!(minted.url, format!("http://{}/", minted.host));
    }

    #[test]
    fn dnslog_rejects_bad_config() {
        assert!(DnslogClient::new("", "http://x/{marker}").is_err());
        assert!(DnslogClient::new("d", "http://x/").is_err());
    }

    #[test]
    fn poll_until_hits_after_retries() {
        let lease = Lease {
            every_ms: 1,
            deadline_ms: 5_000,
        };
        let mut calls = 0;
        let report = poll_until(
            &lease,
            || {
                calls += 1;
                if calls < 3 {
                    Ok(Vec::new())
                } else {
                    Ok(vec![json!({"unique-id": "m"})])
                }
            },
            |item| item["unique-id"] == json!("m"),
        )
        .unwrap();
        assert!(report.hit);
        assert_eq!(report.attempts, 3);
        assert!(!report.deadline_hit);
        assert_eq!(report.evidence.len(), 1);
    }

    #[test]
    fn poll_until_reports_deadline() {
        let lease = Lease {
            every_ms: 1,
            deadline_ms: 30,
        };
        let report = poll_until(&lease, || Ok(Vec::new()), |_| false).unwrap();
        assert!(!report.hit);
        assert!(report.deadline_hit);
        assert!(report.attempts >= 1);
    }

    #[test]
    fn poll_until_tolerates_transient_errors_but_not_auth() {
        let lease = Lease {
            every_ms: 1,
            deadline_ms: 30,
        };
        let mut calls = 0;
        let report = poll_until(
            &lease,
            || {
                calls += 1;
                if calls == 1 {
                    Err(Atom::net_unreachable("E_OOB_006", "blip"))
                } else {
                    Ok(vec![json!({"line": "hit m"})])
                }
            },
            |item| item["line"].as_str().unwrap().contains("m"),
        )
        .unwrap();
        assert!(report.hit);
        assert_eq!(report.attempts, 2);
        assert!(report.last_error.is_some());

        let auth = poll_until(
            &lease,
            || Err(Atom::auth_denied("E_OOB_004", "401")),
            |_| true,
        );
        assert!(auth.is_err());
    }

    #[test]
    #[ignore = "registers against public interactsh servers (manual verification)"]
    fn interactsh_full_flow_public() {
        let client = InteractshClient::register(DEFAULT_INTERACTSH_SERVERS, "").unwrap();
        let minted = client.mint();
        let report = client
            .poll_until_hit(
                &minted.id,
                &Lease {
                    every_ms: 2_000,
                    deadline_ms: 5_000,
                },
            )
            .unwrap();
        assert!(!report.hit);
        assert!(report.deadline_hit);
        client.deregister().unwrap();
    }
}
