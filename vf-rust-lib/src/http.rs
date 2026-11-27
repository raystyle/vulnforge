//! The http widget: a snapshot face over rustls. Scripts call http::get /
//! http::post / http::request and receive a SNAPSHOT (status, lowercase
//! headers, body bytes) — IO stays in the widget, judgment stays pure in
//! the Machine step closures (the module.rs discipline). The snapshot is
//! clonable and comparable, so a Verify step can diff two responses
//! without re-issuing requests.
//!
//! TLS: roots-verified by default; `--insecure` legs (self-signed lab
//! targets) opt into the danger config per call site, never globally.

use std::io::Read;
use std::time::Duration;

use serde_json::{json, Value};

use crate::error::Atom;
use crate::tls;

/// One response, frozen. Headers lowercase for case-insensitive lookup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpSnapshot {
    pub status: u16,
    /// (lowercase-name, value) pairs in arrival order.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// Total wall time of the request in milliseconds.
    pub elapsed_ms: u64,
}

impl HttpSnapshot {
    /// First header value for a lowercase name (case-insensitive on the
    /// query string: "Content-Type" and "content-type" both match).
    pub fn header(&self, name: &str) -> Option<&str> {
        let lower = name.to_ascii_lowercase();
        self.headers
            .iter()
            .find(|(key, _)| *key == lower)
            .map(|(_, value)| value.as_str())
    }

    /// Body as UTF-8 (lossy — binary bodies surface as replacement chars;
    /// use `body` for the raw bytes).
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    /// JSON body parse (None when the body is not valid JSON).
    pub fn json(&self) -> Option<Value> {
        serde_json::from_slice(&self.body).ok()
    }

    /// Serializable form for the envelope's data field.
    pub fn to_value(&self) -> Value {
        json!({
            "status": self.status,
            "headers": self.headers.iter()
                .map(|(k, v)| json!({"name": k, "value": v}))
                .collect::<Vec<_>>(),
            "body_len": self.body.len(),
            "body_b64": crate::payload::b64_encode(&self.body),
            "elapsed_ms": self.elapsed_ms,
        })
    }

    /// A brief summary line for traces and logs (status + length, no body).
    pub fn summary(&self) -> String {
        format!("{} {}B {}ms", self.status, self.body.len(), self.elapsed_ms)
    }
}

/// Request options: method, headers, body, TLS posture, timeout.
#[derive(Debug, Clone, Default)]
pub struct RequestOptions {
    /// Header (name, value) pairs; names lowercased on send where the
    /// transport requires canonical form.
    pub headers: Vec<(String, String)>,
    /// Raw body bytes (POST/PUT).
    pub body: Vec<u8>,
    /// Skip certificate verification (lab/self-signed targets only).
    pub insecure: bool,
    /// Per-request timeout (default 15s).
    pub timeout: Option<Duration>,
}

impl RequestOptions {
    /// Fluent header add.
    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn body_bytes(mut self, data: Vec<u8>) -> Self {
        self.body = data;
        self
    }

    pub fn body_str(self, data: impl Into<String>) -> Self {
        let text: String = data.into();
        self.body_bytes(text.into_bytes())
    }

    pub fn insecure(mut self) -> Self {
        self.insecure = true;
        self
    }

    fn agent_config(&self) -> ureq::Agent {
        let mut builder =
            ureq::AgentBuilder::new().timeout(self.timeout.unwrap_or(Duration::from_secs(15)));
        if self.insecure {
            if let Ok(config) = tls::danger_client_config() {
                builder = builder.tls_config(std::sync::Arc::new(config.as_ref().clone()));
            }
        }
        builder.build()
    }
}

/// The core request. Method names uppercase; the URL must carry its scheme.
/// Non-2xx statuses are DATA, not errors — the exploit judgment (a 500 may
/// be the vulnerability signal) belongs to the Machine step.
pub fn request(method: &str, url: &str, options: RequestOptions) -> Result<HttpSnapshot, Atom> {
    let agent = options.agent_config();
    let start = std::time::Instant::now();
    let mut call = agent.request(&method.to_ascii_uppercase(), url);
    for (name, value) in &options.headers {
        call = call.set(name, value);
    }
    let outcome = if options.body.is_empty() {
        call.call()
    } else {
        call.send_bytes(&options.body)
    };
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let response = match outcome {
        Ok(response) => response,
        Err(ureq::Error::Status(_code, response)) => response,
        Err(error) => return Err(map_transport(error)),
    };
    let status = response.status();
    let headers: Vec<(String, String)> = response
        .headers_names()
        .into_iter()
        .flat_map(|name| {
            let values = response.all(&name).to_vec();
            values
                .into_iter()
                .map(move |value| (name.to_ascii_lowercase(), value.to_string()))
        })
        .collect();
    let mut body = Vec::new();
    response.into_reader().read_to_end(&mut body).ok();
    Ok(HttpSnapshot {
        status,
        headers,
        body,
        elapsed_ms,
    })
}

/// GET with default options.
pub fn get(url: &str) -> Result<HttpSnapshot, Atom> {
    request("GET", url, RequestOptions::default())
}

/// GET with options (headers / insecure / timeout).
pub fn get_with(url: &str, options: RequestOptions) -> Result<HttpSnapshot, Atom> {
    request("GET", url, options)
}

/// POST a body with options.
pub fn post(url: &str, options: RequestOptions) -> Result<HttpSnapshot, Atom> {
    request("POST", url, options)
}

fn map_transport(error: ureq::Error) -> Atom {
    match error {
        ureq::Error::Status(401, _) => {
            Atom::auth_denied("E_HTTP_001", "401 from the target (credentials/session)")
        }
        ureq::Error::Status(code, _) => {
            Atom::protocol_mismatch("E_HTTP_002", format!("unexpected transport status {code}"))
        }
        ureq::Error::Transport(transport) => Atom::net_unreachable(
            "E_HTTP_003",
            // ureq's Transport Display prints the full URL — target URLs can
            // carry credentials in the query; emit only the transport kind.
            format!("transport: {}", transport.kind()),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_header_lookup_is_case_insensitive() {
        let snapshot = HttpSnapshot {
            status: 200,
            headers: vec![("content-type".into(), "text/html".into())],
            body: b"<html/>".to_vec(),
            elapsed_ms: 12,
        };
        assert_eq!(snapshot.header("Content-Type"), Some("text/html"));
        assert_eq!(snapshot.header("content-type"), Some("text/html"));
        assert_eq!(snapshot.header("x-absent"), None);
    }

    #[test]
    fn snapshot_json_and_summary() {
        let snapshot = HttpSnapshot {
            status: 200,
            headers: vec![],
            body: br#"{"ok":true}"#.to_vec(),
            elapsed_ms: 5,
        };
        assert_eq!(snapshot.json().unwrap()["ok"], json!(true));
        assert_eq!(snapshot.summary(), "200 11B 5ms");
        let value = snapshot.to_value();
        assert_eq!(value["status"], json!(200));
        assert_eq!(value["body_len"], json!(11));
    }

    #[test]
    fn request_options_builder_shape() {
        let options = RequestOptions::default()
            .header("X-Test", "1")
            .body_str("hello")
            .insecure();
        assert_eq!(options.headers.len(), 1);
        assert_eq!(options.body, b"hello");
        assert!(options.insecure);
    }

    #[test]
    fn method_uppercased_and_bad_scheme_is_transport_atom() {
        let error = request("get", "ftp://nope/", RequestOptions::default()).unwrap_err();
        assert_eq!(error.kind, "net_unreachable");
    }
}
