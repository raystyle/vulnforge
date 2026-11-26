/**
 * exploit rs skeleton generation: shebang + `//!` metadata header +
 * ```cargo dependency block + an AgentResult-printing fn main. The script
 * name IS the vulnerability identifier (one exploit per vulnerability).
 */
export const RS_EXPLOIT_TYPES = ["rce", "sqli", "auth-bypass", "info-disclosure"] as const;
export type RsExploitType = (typeof RS_EXPLOIT_TYPES)[number];

export interface RsScaffoldInput {
  vulnType: RsExploitType;
  /** Vulnerability identifier — becomes the script name (CVE-id or alias). */
  vulnId: string;
  description: string;
}

/** Map a vulnerability identifier to a file-safe script name. CVE-id forms
 * keep canonical uppercase; free-form aliases fold to lowercase. */
export function scriptNameFromVulnId(vulnId: string): string {
  const cleaned = vulnId
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/\.rs$/, "");
  return /^CVE-\d{4}-\d{4,}$/i.test(cleaned) ? cleaned.toUpperCase() : cleaned.toLowerCase();
}

/** Directory per exploit kind (keeps the library browsable by type). */
export function rsTargetDirectory(vulnType: RsExploitType): string {
  return vulnType;
}

export function rsSkeletonFor(input: RsScaffoldInput): string {
  const name = scriptNameFromVulnId(input.vulnId);
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
    '//! serde_json = "1"',
    "//! ```",
    "fn main() {",
    "    let target = std::env::args().nth(1);",
    "    let result = match target {",
    "        Some(url) => serde_json::json!({",
    '            "success": true,',
    `            "action": "${input.vulnType}",`,
    '            "data": { "target": url },',
    '            "next_suggestion": "implement the exploit logic"',
    "        }),",
    "        None => serde_json::json!({",
    '            "success": false,',
    '            "error": "E_ARG_001",',
    '            "next_suggestion": "pass the target url as the first argument"',
    "        }),",
    "    };",
    '    println!("{}", result);',
    "}",
  ];
  return `${lines.join("\n")}\n`;
}
