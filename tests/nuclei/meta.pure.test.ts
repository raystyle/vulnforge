import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseTemplateFile, syncFromFiles, TemplateDb } from "../../src/nuclei/meta.ts";

const GOOD_TEMPLATE = `
id: acme-panel-rce
info:
  name: ACME Panel - Remote Code Execution
  author: ray
  severity: critical
  description: ACME Panel before 2.1 allows unauthenticated command execution via the exec endpoint.
  tags: cve,rce,acme
  classification:
    cve-id: CVE-2026-1234
  metadata:
    affected_product: "ACME Panel"
http:
  - method: POST
    path:
      - "{{BaseURL}}/exec"
    matchers:
      - type: word
        words:
          - "{{randstr}}"
`;

const SECOND_TEMPLATE = `
id: other-app-lfi
info:
  name: Other App - Local File Inclusion
  author: ray
  severity: high
  description: Other App exposes a file view endpoint vulnerable to path traversal.
  tags: lfi,other
http:
  - method: GET
    path:
      - "{{BaseURL}}/view"
`;

const tempDirs: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-meta-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseTemplateFile (zod schema)", () => {
  it("parses a compliant template into typed metadata", () => {
    const root = makeRoot();
    const file = join(root, "tpl.yaml");
    writeFileSync(file, GOOD_TEMPLATE);
    const parsed = parseTemplateFile(file);
    expect("parseError" in parsed).toBe(false);
    if ("parseError" in parsed) return;
    expect(parsed.meta.id).toBe("acme-panel-rce");
    expect(parsed.meta.severity).toBe("critical");
    expect(parsed.meta.cve).toBe("CVE-2026-1234");
    expect(parsed.meta.affectedProduct).toBe("ACME Panel");
    expect(parsed.meta.protocol).toBe("http");
  });

  it("rejects an invalid severity with a structured error", () => {
    const root = makeRoot();
    const file = join(root, "bad.yaml");
    writeFileSync(
      file,
      ["id: x", "info:", "  name: X", "  author: ray", "  severity: extreme", "  description: something"].join("\n"),
    );
    const parsed = parseTemplateFile(file);
    expect("parseError" in parsed).toBe(true);
    if (!("parseError" in parsed)) return;
    expect(parsed.parseError).toContain("severity");
  });

  it("rejects a bad id format (upstream pattern)", () => {
    const root = makeRoot();
    const file = join(root, "bad.yaml");
    writeFileSync(
      file,
      ["id: bad id!!", "info:", "  name: X", "  author: ray", "  severity: low", "  description: something"].join("\n"),
    );
    const parsed = parseTemplateFile(file);
    expect("parseError" in parsed && parsed.parseError).toContain("upstream nuclei id pattern");
  });

  it("accepts upstream-compatible ids that repo lint would tighten", () => {
    const root = makeRoot();
    const file = join(root, "legacy.yaml");
    writeFileSync(
      file,
      ["id: Bad_Template", "info:", "  name: X", "  author: ray", "  severity: low", "  description: something"].join(
        "\n",
      ),
    );
    const parsed = parseTemplateFile(file);
    expect("parseError" in parsed).toBe(false);
  });

  it("rejects invalid YAML with a parse error", () => {
    const root = makeRoot();
    const file = join(root, "broken.yaml");
    writeFileSync(file, "id: [unclosed");
    const parsed = parseTemplateFile(file);
    expect("parseError" in parsed && parsed.parseError).toContain("YAML parse failed");
  });
});

describe("TemplateDb", () => {
  it("upserts, searches with bm25 ranking, and reports duplicates", async () => {
    const root = makeRoot();
    mkdirSync(join(root, "http", "cves"), { recursive: true });
    writeFileSync(join(root, "http", "cves", "acme.yaml"), GOOD_TEMPLATE);
    writeFileSync(join(root, "http", "cves", "other.yaml"), SECOND_TEMPLATE);
    const db = new TemplateDb(join(root, "templates.db"));
    try {
      const result = await syncFromFiles(db, root);
      expect(result.synced).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(db.count()).toBe(2);

      const hits = db.search("rce");
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0]?.id).toBe("acme-panel-rce");
      expect(hits[0]?.snippet.length).toBeGreaterThan(0);

      const filtered = db.search("acme", { severity: "critical" });
      expect(filtered.map((hit) => hit.id)).toEqual(["acme-panel-rce"]);
      expect(db.search("acme", { severity: "low" })).toHaveLength(0);

      // Same duplicate_key (cve) reported.
      writeFileSync(
        join(root, "http", "cves", "dup.yaml"),
        GOOD_TEMPLATE.replace("id: acme-panel-rce", "id: acme-panel-rce-copy"),
      );
      await syncFromFiles(db, root);
      const dups = db.findDuplicates();
      expect(dups.length).toBe(1);
      expect(dups[0]?.ids).toContain("acme-panel-rce");
      expect(dups[0]?.ids).toContain("acme-panel-rce-copy");
    } finally {
      db.close();
    }
  });

  it("sync is incremental: removals are pruned, re-sync is idempotent", async () => {
    const root = makeRoot();
    mkdirSync(join(root, "http"), { recursive: true });
    const file = join(root, "http", "acme.yaml");
    writeFileSync(file, GOOD_TEMPLATE);
    const db = new TemplateDb(join(root, "templates.db"));
    try {
      await syncFromFiles(db, root);
      expect(db.count()).toBe(1);
      await syncFromFiles(db, root);
      expect(db.count()).toBe(1);

      rmSync(file);
      const result = await syncFromFiles(db, root);
      expect(result.removed).toEqual(["http/acme.yaml"]);
      expect(db.count()).toBe(0);
    } finally {
      db.close();
    }
  });

  it("seals the db and verifies the recorded hash", async () => {
    const root = makeRoot();
    mkdirSync(join(root, "http"), { recursive: true });
    writeFileSync(join(root, "http", "acme.yaml"), GOOD_TEMPLATE);
    const db = new TemplateDb(join(root, "templates.db"));
    try {
      await syncFromFiles(db, root);
      const seal = db.seal();
      expect(seal.templateCount).toBe(1);
      expect(seal.dbSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(db.verifySeal(seal).ok).toBe(true);

      writeFileSync(
        join(root, "http", "acme.yaml"),
        GOOD_TEMPLATE.replace("command execution", "remote command execution"),
      );
      await syncFromFiles(db, root);
      const afterDrift = db.verifySeal(seal);
      expect(afterDrift.ok).toBe(false);
      expect(afterDrift.reason).toContain("hash differs");
    } finally {
      db.close();
    }
  });
});
