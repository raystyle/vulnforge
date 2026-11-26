import { describe, expect, it } from "vitest";
import { lintYaml } from "../../src/templates/yamllint.ts";

describe("lintYaml", () => {
  it("accepts clean block-style yaml", () => {
    const findings = lintYaml("id: acme\ninfo:\n  name: ACME\n", "t.yaml");
    expect(findings).toEqual([]);
  });

  it("reports syntax errors with a line number", () => {
    const findings = lintYaml("id: acme\ninfo:\n  name: [unclosed\n", "t.yaml");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("yaml/syntax");
    expect(findings[0]?.line).toBeGreaterThan(0);
  });

  it("flags flow style mappings and sequences", () => {
    const findings = lintYaml("map: {a: 1}\nseq: [1, 2]\n", "t.yaml");
    expect(findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["yaml/flow-style", "yaml/flow-style"]),
    );
    expect(findings.every((finding) => finding.level === "error")).toBe(true);
  });

  it("flags trailing spaces and bad comment spacing", () => {
    const findings = lintYaml("id: acme   \ninfo: x  # comment\n", "t.yaml");
    expect(findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["yaml/trailing-spaces", "yaml/comment-spacing"]),
    );
    expect(findings.every((finding) => finding.level === "warning")).toBe(true);
  });

  it("flags more than five consecutive empty lines", () => {
    const findings = lintYaml("a: 1\n\n\n\n\n\n\nb: 2\n", "t.yaml");
    expect(findings.map((finding) => finding.rule)).toContain("yaml/empty-lines");
  });

  it("handles empty documents without crashing", () => {
    expect(lintYaml("", "t.yaml")).toEqual([]);
    expect(lintYaml("\n\n", "t.yaml")).toEqual([]);
  });
});
