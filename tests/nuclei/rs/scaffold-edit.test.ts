import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyRsEdit, RsEditError, validateRsPatch } from "../../../src/nuclei/rs/edit.ts";
import {
  RS_EXPLOIT_TYPES,
  rsSkeletonFor,
  rsTargetDirectory,
  scriptNameFromVulnId,
} from "../../../src/nuclei/rs/scaffold.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeWorkspace(): { root: string; scriptsDir: string } {
  const root = mkdtempSync(join(tmpdir(), "vf-rsnew-"));
  scratch.push(root);
  const scriptsDir = join(root, "rust-scripts");
  mkdirSync(scriptsDir, { recursive: true });
  return { root, scriptsDir };
}

describe("rs scaffold", () => {
  it("RS_EXPLOIT_TYPES covers the four exploit kinds", () => {
    expect(RS_EXPLOIT_TYPES).toEqual(["rce", "sqli", "auth-bypass", "info-disclosure"]);
  });

  it("skeleton carries shebang + //! header + cargo block + AgentResult main", () => {
    const skeleton = rsSkeletonFor({ vulnType: "rce", vulnId: "CVE-2026-1234", description: "test" });
    expect(skeleton.startsWith("#!/usr/bin/env rust-script")).toBe(true);
    expect(skeleton).toContain("//! name: CVE-2026-1234");
    expect(skeleton).toContain("//! ```cargo");
    expect(skeleton).toContain('"success"');
    expect(skeleton).toContain("next_suggestion");
  });

  it("scriptNameFromVulnId maps identifiers to file-safe names", () => {
    expect(scriptNameFromVulnId("CVE-2026-1234")).toBe("CVE-2026-1234");
    expect(scriptNameFromVulnId("ThinkPHP 5 RCE")).toBe("thinkphp-5-rce");
  });

  it("targetDirectory groups scripts by exploit kind", () => {
    expect(rsTargetDirectory("rce")).toBe("rce");
    expect(rsTargetDirectory("sqli")).toBe("sqli");
  });
});

describe("rs edit contract chain", () => {
  const SAMPLE = [
    "#!/usr/bin/env rust-script",
    "//! name: CVE-2026-1234",
    "//! description: 原描述",
    "//! version: 1.0.0",
    "//! args: <url>",
    "//! keywords: rce",
    "//!",
    "//! ```cargo",
    "//! [dependencies]",
    "//! ```",
    "fn main() {",
    '    println!("{}", "{}");',
    "}",
  ].join("\n");

  it("metadata patch rewrites one //! header line", () => {
    const { scriptsDir } = makeWorkspace();
    const file = join(scriptsDir, "CVE-2026-1234.rs");
    writeFileSync(file, SAMPLE);
    const outcome = applyRsEdit(file, validateRsPatch({ kind: "metadata", patch: { description: "新描述" } }));
    expect(outcome.applied).toContain("description");
    expect(readFileSync(file, "utf8")).toContain("//! description: 新描述");
    expect(readFileSync(file, "utf8")).toContain("//! name: CVE-2026-1234");
  });

  it("body patch replaces whole content after contract check", () => {
    const { scriptsDir } = makeWorkspace();
    const file = join(scriptsDir, "CVE-2026-1235.rs");
    writeFileSync(file, SAMPLE);
    const outcome = applyRsEdit(file, validateRsPatch({ kind: "body", content: SAMPLE.replace("1.0.0", "2.0.0") }));
    expect(outcome.applied).toContain("body");
    expect(readFileSync(file, "utf8")).toContain("2.0.0");
  });

  it("invalid content without //! name is rejected with EditError, nothing written", () => {
    const { scriptsDir } = makeWorkspace();
    const file = join(scriptsDir, "keep-me.rs");
    writeFileSync(file, SAMPLE);
    expect(() =>
      applyRsEdit(file, validateRsPatch({ kind: "body", content: 'fn main() { println!("{}", "{}"); }' })),
    ).toThrow(RsEditError);
    expect(readFileSync(file, "utf8")).toBe(SAMPLE);
  });

  it("unknown metadata key is rejected", () => {
    expect(() => validateRsPatch({ kind: "metadata", patch: { nonsense: "x" } })).toThrow(RsEditError);
  });
});
