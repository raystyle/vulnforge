//! The fingerprint widget: the standard Probe step implementation. Server
//! identification from response surface (headers + body markers), pure
//! judgment over an HttpSnapshot — no IO here, so it is fully testable
//! and usable on replayed/cached snapshots.

use serde_json::{json, Value};

use crate::http::HttpSnapshot;

/// A matched middleware/server with the evidence that matched it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    /// Server family: tomcat / jetty / weblogic / webshell_php / iis / nginx / apache.
    pub server: String,
    /// Version string when detectable from the surface.
    pub version: Option<String>,
    /// The (header, value) pairs and body markers that produced the match.
    pub evidence: Vec<String>,
}

impl Fingerprint {
    pub fn to_value(&self) -> Value {
        json!({
            "server": self.server,
            "version": self.version,
            "evidence": self.evidence,
        })
    }
}

/// Server identification from a snapshot. First match wins by specificity
/// order (framework-specific headers before generic Server tokens).
pub fn server(snapshot: &HttpSnapshot) -> Option<Fingerprint> {
    let server_header = snapshot.header("server").unwrap_or("");
    let x_powered = snapshot.header("x-powered-by").unwrap_or("");
    let body = snapshot.text();

    if let Some(version) = extract_tomcat_version(server_header) {
        return Some(Fingerprint {
            server: "tomcat".into(),
            version: Some(version),
            evidence: vec![format!("server={server_header}")],
        });
    }
    if server_header.contains("Jetty") || snapshot.header("x-jetty").is_some() {
        return Some(Fingerprint {
            server: "jetty".into(),
            version: server_header
                .split_whitespace()
                .find(|token| token.chars().next().is_some_and(|c| c.is_ascii_digit()))
                .map(str::to_string),
            evidence: vec![format!("server={server_header}")],
        });
    }
    // WebLogic: the classic admin/console cookies and error-page markers.
    if snapshot.header("x-oracle-dms-ecid").is_some()
        || body.contains("WebLogic Server")
        || body.contains("bea_wls_internal")
    {
        return Some(Fingerprint {
            server: "weblogic".into(),
            version: None,
            evidence: evidence_from_markers(
                snapshot,
                &["x-oracle-dms-ecid"],
                &["WebLogic Server", "bea_wls_internal"],
            ),
        });
    }
    if x_powered.contains("PHP")
        || body.contains("PHP Version")
        || snapshot.header("x-php-version").is_some()
    {
        return Some(Fingerprint {
            server: "webshell_php".into(),
            version: extract_php_version(x_powered, &body),
            evidence: evidence_from_markers(snapshot, &["x-powered-by"], &["PHP Version"]),
        });
    }
    if server_header.contains("IIS") || snapshot.header("x-aspnet-version").is_some() {
        return Some(Fingerprint {
            server: "iis".into(),
            version: snapshot
                .header("x-aspnet-version")
                .map(|value| format!("aspnet {value}")),
            evidence: evidence_from_markers(snapshot, &["server", "x-aspnet-version"], &[]),
        });
    }
    if server_header.contains("nginx") {
        return Some(Fingerprint {
            server: "nginx".into(),
            version: extract_leading_version(server_header),
            evidence: vec![format!("server={server_header}")],
        });
    }
    if server_header.contains("Apache") {
        return Some(Fingerprint {
            server: "apache".into(),
            version: extract_leading_version(server_header),
            evidence: vec![format!("server={server_header}")],
        });
    }
    None
}

fn evidence_from_markers(
    snapshot: &HttpSnapshot,
    headers: &[&str],
    body_markers: &[&str],
) -> Vec<String> {
    let mut evidence: Vec<String> = headers
        .iter()
        .filter_map(|name| snapshot.header(name).map(|value| format!("{name}={value}")))
        .collect();
    let body = snapshot.text();
    for marker in body_markers {
        if body.contains(marker) {
            evidence.push(format!("body~={marker}"));
        }
    }
    evidence
}

fn extract_tomcat_version(server_header: &str) -> Option<String> {
    if !server_header.contains("Tomcat") && !server_header.contains("Coyote") {
        return None;
    }
    extract_leading_version(server_header)
}

/// First token after the name that starts with a digit (e.g. "Apache/2.4.41" -> "2.4.41").
fn extract_leading_version(text: &str) -> Option<String> {
    text.split(|c: char| c.is_whitespace() || c == '/')
        .find(|token| token.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(str::to_string)
}

fn extract_php_version(x_powered: &str, body: &str) -> Option<String> {
    extract_leading_version(x_powered).or_else(|| {
        body.split_whitespace()
            .find(|token| token.starts_with("PHP/") && token.len() > 4)
            .map(|token| token.trim_start_matches("PHP/").to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot_with(headers: &[(&str, &str)], body: &str) -> HttpSnapshot {
        HttpSnapshot {
            status: 200,
            headers: headers
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect(),
            body: body.as_bytes().to_vec(),
            elapsed_ms: 1,
        }
    }

    #[test]
    fn tomcat_version_extracted() {
        let fp = server(&snapshot_with(&[("server", "Apache-Coyote/1.1")], "")).unwrap();
        assert_eq!(fp.server, "tomcat");
        assert_eq!(fp.version.as_deref(), Some("1.1"));
    }

    #[test]
    fn weblogic_from_body_marker_and_cookie() {
        let fp = server(&snapshot_with(&[], "<title>WebLogic Server</title>")).unwrap();
        assert_eq!(fp.server, "weblogic");
        assert!(fp.evidence.iter().any(|e| e.contains("WebLogic")));
    }

    #[test]
    fn jetty_header_wins_over_generic() {
        let fp = server(&snapshot_with(&[("server", "Jetty(9.4.z-SNAPSHOT)")], "")).unwrap();
        assert_eq!(fp.server, "jetty");
    }

    #[test]
    fn php_surface_detected() {
        let fp = server(&snapshot_with(&[("x-powered-by", "PHP/7.4.3")], "")).unwrap();
        assert_eq!(fp.server, "webshell_php");
        assert_eq!(fp.version.as_deref(), Some("7.4.3"));
    }

    #[test]
    fn iis_and_nginx_extracted() {
        let fp = server(&snapshot_with(
            &[
                ("server", "Microsoft-IIS/10.0"),
                ("x-aspnet-version", "4.0.30319"),
            ],
            "",
        ))
        .unwrap();
        assert_eq!(fp.server, "iis");
        let fp = server(&snapshot_with(&[("server", "nginx/1.18.0")], "")).unwrap();
        assert_eq!(fp.server, "nginx");
        assert_eq!(fp.version.as_deref(), Some("1.18.0"));
    }

    #[test]
    fn unknown_surface_is_none() {
        assert!(server(&snapshot_with(&[("server", "GoAhead")], "")).is_none());
        assert!(server(&snapshot_with(&[], "")).is_none());
    }
}
