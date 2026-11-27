import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AgentResultSchema, RsMetaSchema, scriptName } from "../../../src/nuclei/rs/contracts.ts";
import { RsDb } from "../../../src/nuclei/rs/db.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("rs contracts (branded)", () => {
  it("scriptName accepts vulnerability-identifier shapes and rejects paths", () => {
    expect(scriptName("CVE-2026-1234")).toBe("CVE-2026-1234");
    expect(scriptName("thinkphp-5-rce")).toBe("thinkphp-5-rce");
    expect(() => scriptName("../evil")).toThrow();
    expect(() => scriptName("a/b")).toThrow();
    expect(() => scriptName("")).toThrow();
  });

  it("RsMetaSchema validates the full metadata row", () => {
    const good = {
      name: scriptName("CVE-2026-1234"),
      description: "exploit",
      descriptionEn: "exploit en",
      version: "1.0.0",
      keywords: ["rce"],
      args: "<url>",
      codes: "E_X_001=bad url",
      file: "rust-scripts/CVE-2026-1234.rs",
      source: "project",
      faces: ["activemq"],
      dangerous: false,
      sha256: "ab".repeat(32),
    };
    expect(RsMetaSchema.safeParse(good).success).toBe(true);
    expect(RsMetaSchema.safeParse({ ...good, source: "elsewhere" }).success).toBe(false);
    expect(RsMetaSchema.safeParse({ ...good, version: "not semver" }).success).toBe(false);
  });

  it("AgentResultSchema enforces the single-line script envelope", () => {
    const good = { success: true, action: "exploit", data: { k: 1 }, next_suggestion: "next" };
    expect(AgentResultSchema.safeParse(good).success).toBe(true);
    const fail = { success: false, error: "E_X_001", next_suggestion: "retry" };
    expect(AgentResultSchema.safeParse(fail).success).toBe(true);
    expect(AgentResultSchema.safeParse({ success: true, error: "x" }).success).toBe(false);
    expect(AgentResultSchema.safeParse({}).success).toBe(false);
  });
});

describe("RsDb", () => {
  function makeDb(): RsDb {
    const dir = mkdtempSync(join(tmpdir(), "vf-rsdb-"));
    scratch.push(dir);
    return new RsDb(join(dir, "rs.db"), join(dir, "rs-lock.json"));
  }

  it("upsert + search by bm25 (name ranks above description)", () => {
    const db = makeDb();
    db.upsert({
      name: scriptName("CVE-2026-1234"),
      description: "remote code execution in activemq",
      descriptionEn: "rce in activemq",
      version: "1.0.0",
      keywords: ["rce", "activemq"],
      args: "<url>",
      codes: "",
      file: "rust-scripts/CVE-2026-1234.rs",
      source: "project",
      faces: ["activemq"],
      dangerous: false,
      sha256: "ab".repeat(32),
    });
    const hits = db.search("activemq");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.name).toBe("CVE-2026-1234");
    db.close();
  });

  it("re-upsert replaces (one row per name), remove deletes", () => {
    const db = makeDb();
    const meta = {
      name: scriptName("CVE-2026-0001"),
      description: "d",
      descriptionEn: "d",
      version: "1.0.0",
      keywords: ["k"],
      args: "",
      codes: "",
      file: "rust-scripts/CVE-2026-0001.rs",
      source: "project" as const,
      faces: [],
      dangerous: false,
      sha256: "cd".repeat(32),
    };
    db.upsert(meta);
    db.upsert({ ...meta, version: "1.1.0" });
    expect(db.count()).toBe(1);
    db.remove("CVE-2026-0001");
    expect(db.count()).toBe(0);
    db.close();
  });

  it("seal persists the record to the lock file (unlike the tpl vapor pattern)", () => {
    const db = makeDb();
    db.upsert({
      name: scriptName("CVE-2026-0002"),
      description: "d",
      descriptionEn: "d",
      version: "1.0.0",
      keywords: [],
      args: "",
      codes: "",
      file: "rust-scripts/CVE-2026-0002.rs",
      source: "project",
      faces: [],
      dangerous: false,
      sha256: "ef".repeat(32),
    });
    const record = db.seal();
    expect(record.scriptCount).toBe(1);
    const verify = db.verifySeal(record);
    expect(verify.ok).toBe(true);
    db.close();
  });

  it("cross-domain join: find exploits for a template's cve", () => {
    const db = makeDb();
    db.upsert({
      name: scriptName("CVE-2026-4242"),
      description: "targeted by tpl",
      descriptionEn: "",
      version: "1.0.0",
      keywords: [],
      args: "",
      codes: "",
      file: "rust-scripts/CVE-2026-4242.rs",
      source: "project",
      faces: [],
      dangerous: false,
      sha256: "11".repeat(32),
    });
    const byName = db.findByName("CVE-2026-4242");
    expect(byName?.name).toBe("CVE-2026-4242");
    expect(db.findByName("CVE-9999-0000")).toBeUndefined();
    db.close();
  });
});
