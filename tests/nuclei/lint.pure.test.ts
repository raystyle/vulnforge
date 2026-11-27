import { describe, expect, it } from "vitest";
import { checkStructure, checkWeakMatchers, lintDocument } from "../../src/nuclei/lint.ts";

const goodTemplate = {
  id: "acme-panel-rce",
  info: {
    name: "ACME Panel - Remote Code Execution",
    author: "ray",
    severity: "critical",
    description: "ACME Panel before 2.1 allows unauthenticated command execution via the exec endpoint.",
    tags: "cve,rce,acme",
    classification: { cve_id: "CVE-2026-1234" },
  },
  http: [
    {
      method: "POST",
      path: ["{{BaseURL}}/exec"],
      body: "cmd=echo {{randstr}}",
      matchers_condition: "and",
      matchers: [
        { type: "word", words: ["{{randstr}}"], part: "body" },
        { type: "status", status: [200] },
      ],
    },
  ],
};

const weakTemplate = {
  id: "Bad_Template",
  info: {
    name: "",
    author: "a b",
    severity: "extreme",
    description: "x",
  },
  http: [{ matchers: [{ type: "word", words: ["error", "admin"] }] }],
};

describe("checkStructure", () => {
  it("reports no findings for a compliant template", () => {
    expect(checkStructure(goodTemplate as never)).toEqual([]);
  });

  it("catches every structural problem in the weak template", () => {
    const rules = checkStructure(weakTemplate as never).map((finding) => finding.rule);
    expect(rules).toContain("structure/id-case");
    expect(rules).toContain("structure/id-format");
    expect(rules).toContain("structure/missing-name");
    expect(rules).toContain("structure/author-format");
    expect(rules).toContain("structure/severity-enum");
    expect(rules).toContain("structure/missing-description");
    expect(rules).toContain("structure/missing-tags");
  });

  it("warns when the id exceeds five words", () => {
    const doc = { ...goodTemplate, id: "a-very-long-template-id-name-here" };
    const rules = checkStructure(doc as never).map((finding) => finding.rule);
    expect(rules).toContain("structure/id-length");
  });
});

describe("checkWeakMatchers", () => {
  it("accepts multi-layer matchers with a proof marker", () => {
    expect(checkWeakMatchers(goodTemplate as never)).toEqual([]);
  });

  it("flags weak words as errors", () => {
    const rules = checkWeakMatchers(weakTemplate as never).map((finding) => finding.rule);
    expect(rules).toContain("matcher/weak-word");
  });

  it("flags a missing matcher block", () => {
    const rules = checkWeakMatchers({ http: [] } as never).map((finding) => finding.rule);
    expect(rules).toContain("matcher/missing");
  });

  it("suggests multi-layer verification for a single word matcher", () => {
    const doc = { http: [{ matchers: [{ type: "word", words: ["VulnApp v2.1.0"] }] }] };
    const findings = checkWeakMatchers(doc as never);
    expect(findings.map((finding) => finding.rule)).toContain("matcher/single-layer");
    expect(findings.map((finding) => finding.rule)).toContain("matcher/no-proof-marker");
    expect(findings.every((finding) => finding.level !== "error")).toBe(true);
  });
});

describe("lintDocument", () => {
  it("combines structure and matcher findings", () => {
    const findings = lintDocument(weakTemplate as never);
    expect(findings.length).toBeGreaterThan(6);
    expect(findings.some((finding) => finding.level === "error")).toBe(true);
  });
});
