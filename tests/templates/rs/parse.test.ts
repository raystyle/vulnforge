import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRsScript } from "../../../src/templates/rs/script-parse.ts";

const SAMPLE = [
  "#!/usr/bin/env rust-script",
  "//! name: CVE-2026-1234",
  "//! description: Activemq RCE 利用",
  "//! description_en: Activemq RCE exploit",
  "//! version: 1.0.0",
  "//! args: <url> [--timeout-ms N]",
  "//! keywords: rce, activemq, cve-2026-1234",
  "//! codes: E_PARSE_412=runtime error; E_PARSE_413=no url",
  "//!",
  "//! ```cargo",
  "//! [dependencies]",
  '//! serde_json = "1"',
  "//! ```",
  "use serde_json::json;",
  "fn main() {",
  '    println!("{}", json!({"success": true, "action": "exploit", "next_suggestion": "verify"}));',
  "}",
].join("\n");

describe("parseRsScript", () => {
  it("parses the //! header run (contiguous after shebang)", () => {
    const parsed = parseRsScript(SAMPLE);
    expect(parsed.meta.name).toBe("CVE-2026-1234");
    expect(parsed.meta.description).toBe("Activemq RCE 利用");
    expect(parsed.meta.descriptionEn).toBe("Activemq RCE exploit");
    expect(parsed.meta.version).toBe("1.0.0");
    expect(parsed.meta.keywords).toEqual(["rce", "activemq", "cve-2026-1234"]);
    expect(parsed.meta.codes).toBe("E_PARSE_412=runtime error; E_PARSE_413=no url");
  });

  it("parses the cargo dependency block", () => {
    const parsed = parseRsScript(SAMPLE);
    expect(parsed.cargoDeps.some((line) => line.includes('serde_json = "1"'))).toBe(true);
  });

  it("rejects a script without a name header (lint error, not exception)", () => {
    const parsed = parseRsScript("fn main() {}\n");
    expect(parsed.meta.name).toBe("");
    expect(parsed.lintIssues.some((issue) => issue.rule === "metadata")).toBe(true);
  });

  it("flags a missing AgentResult print as a lint issue", () => {
    const withoutPrint = SAMPLE.split("\n")
      .map((line) => line.replace("println!", "eprintln!"))
      .join("\n");
    const parsed = parseRsScript(withoutPrint);
    expect(parsed.lintIssues.some((issue) => issue.rule === "envelope")).toBe(true);
  });

  it("real reference script parses (pi-rs2 bundled fleet)", () => {
    const path = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      ".reference",
      "pi-rs2",
      "plugins",
      "rust_script",
      "scripts",
      "hunter-suite",
      "b64.rs",
    );
    const source = readFileSync(path, "utf8");
    const parsed = parseRsScript(source);
    expect(parsed.meta.name).toBe("b64");
    expect(parsed.meta.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.lintIssues.filter((issue) => issue.rule === "metadata")).toHaveLength(0);
  });
});
