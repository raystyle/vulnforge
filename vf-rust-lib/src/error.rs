//! Atomic errors: closed kind vocabulary, stable codes, internalized
//! default suggestions. `E_<KIND>_<NNN>` codes are stable after release
//! (retired codes are never reused).

use serde_json::{json, Value};

/// The closed seven-word kind vocabulary (pentest_rs error_atom precedent).
/// An out-of-table kind is a bug in the script, never a panic.
pub const KINDS: [&str; 7] = [
    "timeout",
    "auth_denied",
    "parse",
    "net_unreachable",
    "protocol_mismatch",
    "response_limit",
    "soft_success",
];

/// The atomic error. Everything a caller needs to branch on; the default
/// suggestion is derived from the kind — no external registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Atom {
    pub kind: &'static str,
    pub code: String,
    pub message: String,
}

impl Atom {
    pub fn new(kind: &'static str, code: &str, message: impl Into<String>) -> Self {
        debug_assert!(
            KINDS.contains(&kind),
            "out-of-table error kind: {kind} (bug in the script, never a panic)"
        );
        Self {
            kind,
            code: code.to_string(),
            message: message.into(),
        }
    }

    /// Serialize for the AgentResult error field.
    pub fn to_value(&self) -> Value {
        json!({
            "kind": self.kind,
            "code": self.code,
            "message": self.message,
        })
    }

    /// Default next-step suggestion derived from the kind — internalized,
    /// deterministic, no lookup surface.
    pub fn default_suggestion(&self) -> String {
        match self.kind {
            "timeout" => "retry with a longer timeout or a smaller target slice".to_string(),
            "auth_denied" => "re-check credentials/session validity, then retry".to_string(),
            "parse" => "inspect the raw response shape, adjust the parse step".to_string(),
            "net_unreachable" => {
                "verify target reachability (alive probe) before retrying".to_string()
            }
            "protocol_mismatch" => {
                "confirm the service fingerprint, adjust the protocol step".to_string()
            }
            "response_limit" => "narrow the request rate or paginate the response".to_string(),
            "soft_success" => "treat as inconclusive, re-verify with a different angle".to_string(),
            other => format!("unhandled kind {other} — report this script bug"),
        }
    }
}

/// Convenience constructors over the closed vocabulary.
impl Atom {
    pub fn timeout(code: &str, message: impl Into<String>) -> Self {
        Self::new("timeout", code, message)
    }
    pub fn auth_denied(code: &str, message: impl Into<String>) -> Self {
        Self::new("auth_denied", code, message)
    }
    pub fn parse(code: &str, message: impl Into<String>) -> Self {
        Self::new("parse", code, message)
    }
    pub fn net_unreachable(code: &str, message: impl Into<String>) -> Self {
        Self::new("net_unreachable", code, message)
    }
    pub fn protocol_mismatch(code: &str, message: impl Into<String>) -> Self {
        Self::new("protocol_mismatch", code, message)
    }
    pub fn response_limit(code: &str, message: impl Into<String>) -> Self {
        Self::new("response_limit", code, message)
    }
    pub fn soft_success(code: &str, message: impl Into<String>) -> Self {
        Self::new("soft_success", code, message)
    }
}
