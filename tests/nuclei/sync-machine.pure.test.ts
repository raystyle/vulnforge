import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TemplateDb } from "../../src/nuclei/meta.ts";
import { loadJobSnapshot, runBatchSync } from "../../src/nuclei/sync-machine.ts";

const TPL = (id: string, name: string) =>
  [
    `id: ${id}`,
    "info:",
    `  name: ${name}`,
    "  author: ray",
    "  severity: high",
    `  description: test template ${id}`,
    "  tags: test",
    "http:",
    "  - method: GET",
    "    path:",
    '      - "{{BaseURL}}/"',
    "    matchers:",
    "      - type: word",
    "        words:",
    `          - "${id}-marker"`,
  ].join("\n");

const tempDirs: string[] = [];

function makeRepo(templateCount: number): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-sm-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, ".vulnforge.json"), "{}");
  mkdirSync(join(dir, "http"), { recursive: true });
  for (let index = 0; index < templateCount; index++) {
    writeFileSync(join(dir, "http", `t${index}.yaml`), TPL(`test-template-${index}`, `Test ${index}`));
  }
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runBatchSync (state machine)", () => {
  it("indexes every file and records lint aggregates", async () => {
    const root = makeRepo(5);
    const db = new TemplateDb(join(root, "templates.db"));
    try {
      const result = await runBatchSync(db, root, { jobId: 1 });
      expect(result.synced).toHaveLength(5);
      expect(result.failed).toHaveLength(0);
      expect(db.count()).toBe(5);
      expect(result.lintFindings).toHaveLength(5);
      // all templates single-layer matcher => warnings present, no errors
      expect(result.lintFindings.every((finding) => finding.errors === 0)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("captures parse failures per file without stopping the batch", async () => {
    const root = makeRepo(2);
    writeFileSync(join(root, "http", "broken.yaml"), "id: [unclosed");
    const db = new TemplateDb(join(root, "templates.db"));
    try {
      const result = await runBatchSync(db, root, { jobId: 2 });
      expect(result.synced).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.path).toBe("http/broken.yaml");
      expect(db.count()).toBe(2);
    } finally {
      db.close();
    }
  });

  it("resumes from a checkpoint instead of re-running the whole batch", async () => {
    const root = makeRepo(6);
    const db = new TemplateDb(join(root, "templates.db"));
    try {
      // First run processes only the first 3 files, then "crashes".
      const all = ["http/t0.yaml", "http/t1.yaml", "http/t2.yaml"];
      for (const rel of all) {
        const absolute = join(root, rel);
        const parsed = await import("../../src/nuclei/meta.ts").then((m) => m.parseTemplateFile(absolute));
        if ("parseError" in parsed) throw new Error(parsed.parseError);
        await db.upsert(parsed.meta, rel);
      }
      const partial = await runBatchSync(db, root, { jobId: 3, resumeFrom: 3 });
      expect(partial.synced).toHaveLength(3);
      expect(partial.synced).not.toContain("http/t0.yaml");
      expect(db.count()).toBe(6);

      const snapshot = loadJobSnapshot(db, 3);
      expect(snapshot).toBeDefined();
      // the resumed machine only knows the remaining slice — 3 files
      expect(snapshot?.total).toBe(3);
      expect(snapshot?.cursor).toBe(3);
    } finally {
      db.close();
    }
  });

  it("skips non-template dirs and keeps the job snapshot queryable", async () => {
    const root = makeRepo(1);
    mkdirSync(join(root, ".github", "ISSUE_TEMPLATE"), { recursive: true });
    writeFileSync(join(root, ".github", "ISSUE_TEMPLATE", "bug.yml"), "name: bug\nbody: x\n");
    const db = new TemplateDb(join(root, "templates.db"));
    try {
      const result = await runBatchSync(db, root, { jobId: 4 });
      expect(result.failed).toHaveLength(0);
      expect(result.synced.every((path) => !path.startsWith(".github"))).toBe(true);
      const snapshot = loadJobSnapshot(db, 4);
      // sealing entry writes the snapshot; the timer hop to done is async
      expect(snapshot?.phase === "done" || snapshot?.phase === "indexing").toBe(true);
    } finally {
      db.close();
    }
  });
});
