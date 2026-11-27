/**
 * TS facade over the vf_rust_lib Machine-template scaffold constants: the
 * skeleton generation lives with the crate semantics, the TS side mirrors
 * the forms so exploit_rs_new renders templates that match the Rust lib.
 */
import { fileURLToPath } from "node:url";

/** The four delivery forms (mirrors vf_rust_lib DeliverForm; wire names). */
export const DELIVER_FORMS = ["submit", "exec_command", "write_file", "rev_shell"] as const;
export type DeliverFormName = (typeof DELIVER_FORMS)[number];

/** Absolute path of the vf-rust-lib crate shipped in this plugin — injected
 * into generated cargo blocks (scripts stay machine-independent in the
 * catalog; the path resolves at scaffold time on the dev machine, and the
 * executor re-resolves per machine). */
const VfRustLibPath = fileURLToPath(new URL("../../../vf-rust-lib", import.meta.url)).replaceAll("\\", "/");

/** The four exploit kinds (mirrors the crate's RS_EXPLOIT_TYPES). */
export const RS_EXPLOIT_TYPES = ["rce", "sqli", "auth-bypass", "info-disclosure"] as const;
export type RsExploitType = (typeof RS_EXPLOIT_TYPES)[number];

/** Map a vulnerability identifier to a file-safe script name (CVE ids keep
 * uppercase, aliases fold lowercase — same rule as the crate). */
export function scriptNameFromVulnId(vulnId: string): string {
  const cleaned = vulnId
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/\.rs$/, "");
  return /^CVE-\d{4}-\d{4,}$/i.test(cleaned) ? cleaned.toUpperCase() : cleaned.toLowerCase();
}

/** Directory per exploit kind. */
export function rsTargetDirectory(vulnType: RsExploitType): string {
  return vulnType;
}

/** Render the skeleton: shebang + //! header + cargo block + the mandatory
 * state-machine main (mirrors the crate template so scripts compile
 * against vf_rust_lib). */
export function rsSkeletonFor(input: {
  vulnType: RsExploitType;
  vulnId: string;
  description: string;
  deliverForm?: DeliverFormName | undefined;
}): string {
  const name = scriptNameFromVulnId(input.vulnId);
  const form = input.deliverForm ?? "submit";
  const formCamel =
    form === "exec_command"
      ? "ExecCommand"
      : form === "write_file"
        ? "WriteFile"
        : form === "rev_shell"
          ? "RevShell"
          : "Submit";
  const lines = [
    "#!/usr/bin/env rust-script",
    `//! name: ${name}`,
    `//! description: ${input.description}`,
    "//! description_en: TODO",
    "//! version: 1.0.0",
    "//! args: <url>",
    `//! keywords: ${input.vulnType}`,
    "//! codes: E_ARG_001=missing target url",
    "//!",
    "//! ```cargo",
    "//! [dependencies]",
    `//! vf_rust_lib = { path = "${VfRustLibPath}" }`,
    '//! serde_json = "1"',
    "//! ```",
    "use vf_rust_lib::error::Atom;",
    "use vf_rust_lib::machine::{DeliverForm, Machine, Outcome, Step};",
    "use vf_rust_lib::report;",
    "",
    "fn main() {",
    `    let mut m = Machine::with_deliver(DeliverForm::${formCamel});`,
    "    let (ok, value) = m.run(|step, state| match step {",
    '        Step::Check => Outcome::Success(serde_json::json!({"options": "complete"})),',
    '        Step::Probe => Outcome::Success(serde_json::json!({"fingerprint": "TODO"})),',
    '        Step::Craft => Outcome::Success(serde_json::json!({"payload": "TODO"})),',
    `        Step::Deliver(_) => Outcome::Success(serde_json::json!({"${form}": "TODO"})),`,
    '        Step::Verify => Outcome::Data(serde_json::json!({"exploited": true, "evidence": "TODO"})),',
    '        Step::Custom(_) => Outcome::Failure(Atom::parse("E_X_001", "unexpected step"), String::new()),',
    "    });",
    "    if ok {",
    `        report::success("${name}", value, "TODO next step in the chain");`,
    "    } else {",
    '        let atom = Atom::soft_success("E_FLOW_002", "failed");',
    `        report::failure("${name}", &atom, "");`,
    "    }",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}
