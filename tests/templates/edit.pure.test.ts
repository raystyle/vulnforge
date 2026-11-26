import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyContent, applyEdit, EditError } from "../../src/templates/edit.ts";

const BASE = [
  "id: acme-panel-rce",
  "info:",
  "  name: ACME Panel - Remote Code Execution",
  "  author: ray",
  "  severity: critical",
  "  description: ACME Panel before 2.1 allows unauthenticated command execution via the exec endpoint.",
  "  tags: cve,rce,acme",
  "http:",
  "  - method: POST",
  "    path:",
  "      - '{{BaseURL}}/exec'",
  "    matchers:",
  "      - type: word",
  "        words:",
  "          - '{{randstr}}'",
  "        part: body",
].join("\n");

const tempDirs: string[] = [];

function makeFile(content = BASE): { dir: string; path: string; rel: string } {
  const dir = mkdtempSync(join(tmpdir(), "vf-edit-"));
  tempDirs.push(dir);
  const path = join(dir, "acme.yaml");
  writeFileSync(path, content);
  return { dir, path, rel: "acme.yaml" };
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("applyEdit (patch mode)", () => {
  it("patches info fields and rewrites valid yaml", () => {
    const file = makeFile();
    const outcome = applyEdit(file.path, file.rel, {
      kind: "info",
      patch: { severity: "high", tags: "cve,rce,acme,panel" },
    });
    expect(outcome.applied).toContain("info.severity");
    expect(outcome.applied).toContain("info.tags");
    const updated = readFileSync(file.path, "utf8");
    expect(updated).toContain("severity: high");
    expect(updated).toContain("cve,rce,acme,panel");
  });

  it("patches matcher words at a request/matcher index", () => {
    const file = makeFile();
    const outcome = applyEdit(file.path, file.rel, {
      kind: "matcher",
      requestIndex: 0,
      matcherIndex: 0,
      patch: { words: ["ACME_PROOF_9f2c1a"] },
    });
    expect(outcome.applied).toContain("http[0].matchers[0].words");
    expect(readFileSync(file.path, "utf8")).toContain("ACME_PROOF_9f2c1a");
  });

  it("replaces request paths", () => {
    const file = makeFile();
    applyEdit(file.path, file.rel, {
      kind: "path",
      requestIndex: 0,
      paths: ["{{BaseURL}}/api/exec"],
    });
    expect(readFileSync(file.path, "utf8")).toContain("{{BaseURL}}/api/exec");
  });

  it("reports lint errors after applying a weak-matcher edit", () => {
    const file = makeFile();
    const outcome = applyEdit(file.path, file.rel, {
      kind: "matcher",
      requestIndex: 0,
      matcherIndex: 0,
      patch: { words: ["admin"] },
    });
    expect(outcome.lintErrors).toBeGreaterThan(0);
    expect(outcome.lintFindings.some((finding) => finding.rule === "matcher/weak-word")).toBe(true);
  });

  it("rejects out-of-range matcher index", () => {
    const file = makeFile();
    expect(() =>
      applyEdit(file.path, file.rel, {
        kind: "matcher",
        requestIndex: 0,
        matcherIndex: 5,
        patch: { words: ["x"] },
      }),
    ).toThrow(EditError);
  });

  it("rejects a template without http block for matcher edits", () => {
    const file = makeFile("id: x\ninfo:\n  name: X\n  author: ray\n  severity: info\n  description: d\n");
    expect(() =>
      applyEdit(file.path, file.rel, {
        kind: "matcher",
        requestIndex: 0,
        matcherIndex: 0,
        patch: { words: ["x"] },
      }),
    ).toThrow(/no http request block/);
  });
});

describe("applyContent (whole-document mode)", () => {
  it("writes valid content and reports lint", () => {
    const file = makeFile();
    const outcome = applyContent(file.path, file.rel, BASE.replaceAll("critical", "high"));
    expect(outcome.applied).toEqual(["(whole document)"]);
    expect(readFileSync(file.path, "utf8")).toContain("severity: high");
  });

  it("refuses invalid yaml content", () => {
    const file = makeFile();
    const original = readFileSync(file.path, "utf8");
    expect(() => applyContent(file.path, file.rel, "id: [unclosed")).toThrow(EditError);
    expect(readFileSync(file.path, "utf8")).toBe(original);
  });

  it("refuses content without id or name", () => {
    const file = makeFile();
    expect(() => applyContent(file.path, file.rel, "info:\n  name: X\n")).toThrow(/no template id/);
    expect(() => applyContent(file.path, file.rel, "id: x\n")).toThrow(/no info.name/);
  });
});
