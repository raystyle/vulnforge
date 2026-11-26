//! AgentResult JSON envelope: the single output contract for exploit rs
//! scripts. Success and failure share one shape; failures carry the atomic
//! error plus a next_suggestion (the attack-chain pointer, script-declared).
//! Tool-usage guidance never appears here — that is the vf-error hint's
//! territory at the tool layer.

use serde_json::{json, to_string, Value};

use crate::error::Atom;

/// Print the success envelope and consume it. `data` carries whatever the
/// script serializes (including the machine trace — see crate::machine).
pub fn success(action: &str, data: Value, next_suggestion: &str) {
    let line = to_string(&json!({
        "success": true,
        "action": action,
        "data": data,
        "next_suggestion": next_suggestion,
    }))
    .unwrap_or_else(|_| fallback_line(true, action));
    println!("{line}");
}

/// Print the failure envelope from an atomic error. The next_suggestion is
/// the script-declared attack-chain pointer; when empty, the atom's
/// internalized default suggestion stands in.
pub fn failure(action: &str, atom: &Atom, next_suggestion: &str) {
    let suggestion = if next_suggestion.is_empty() {
        atom.default_suggestion()
    } else {
        next_suggestion.to_string()
    };
    let line = to_string(&json!({
        "success": false,
        "action": action,
        "error": atom.to_value(),
        "next_suggestion": suggestion,
    }))
    .unwrap_or_else(|_| fallback_line(false, action));
    println!("{line}");
}

fn fallback_line(success: bool, action: &str) -> String {
    format!(
        "{{\"success\":{success},\"action\":\"{action}\",\"error\":{{\"kind\":\"parse\",\"code\":\"E_PARSE_000\",\"message\":\"serialization failed\"}},\"next_suggestion\":\"check the script output handling\"}}"
    )
}
