import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RsDb } from "../../../src/templates/rs/db.ts";
import { runRsSync } from "../../../src/templates/rs/sync.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeWorkspace(): { root: string; scriptsDir: string; dbPath: string; lockPath: string } {
  const root = mkdtempSync(join(tmpdir(), "vf-rssync-"));
  scratch.push(root);
  const scriptsDir = join(root, "rust-scripts");
  mkdirSync(scriptsDir, { recursive: true });
  return { root, scriptsDir, dbPath: join(root, "rs.db"), lockPath: join(root, "rs-lock.json") };
}

const SCRIPT = (name: string, description: string) =>
  [
    "#!/usr/bin/env rust-script",
    `//! name: ${name}`,
    `//! description: ${description}`,
    "//! version: 1.0.0",
    "//! args: <url>",
    "//! keywords: rce",
    "//!",
    "//! ```cargo",
    "//! [dependencies]",
    "//! ```",
    'fn main() { println!("{}", "{}"); }',
  ].join("\n");

describe("runRsSync", () => {
  it("indexes every .rs script in the rs dir with metadata", () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws.scriptsDir, "CVE-2026-1001.rs"), SCRIPT("CVE-2026-1001", "first exploit"));
    writeFileSync(join(ws.scriptsDir, "CVE-2026-1002.rs"), SCRIPT("CVE-2026-1002", "second exploit"));
    writeFileSync(join(ws.scriptsDir, "notes.md"), "not a script");
    const result = runRsSync(ws.root, ws.dbPath, ws.lockPath, { scriptsDir: "rust-scripts" });
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
    const db = new RsDb(ws.dbPath, ws.lockPath);
    expect(db.count()).toBe(2);
    const hit = db.findByName("CVE-2026-1001");
    expect(hit?.description).toBe("first exploit");
    expect(hit?.source).toBe("project");
    db.close();
  });

  it("re-sync is idempotent and lint findings surface", () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws.scriptsDir, "CVE-2026-1003.rs"), SCRIPT("CVE-2026-1003", "no envelope print"));
    writeFileSync(join(ws.scriptsDir, "bad.rs"), "fn main() {}\n"); // no headers at all
    const result = runRsSync(ws.root, ws.dbPath, ws.lockPath, { scriptsDir: "rust-scripts" });
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1); // bad.rs has no name header — counted, not silently indexed
    expect(result.lintFindings.filter((f) => f.path === "bad.rs").length).toBeGreaterThan(0);
    const again = runRsSync(ws.root, ws.dbPath, ws.lockPath, { scriptsDir: "rust-scripts" });
    expect(again.synced).toBe(1);
    const db = new RsDb(ws.dbPath, ws.lockPath);
    expect(db.count()).toBe(1);
    db.close();
  });

  it("seals and the lock file lands on disk", () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws.scriptsDir, "CVE-2026-1004.rs"), SCRIPT("CVE-2026-1004", "sealed"));
    const result = runRsSync(ws.root, ws.dbPath, ws.lockPath, { scriptsDir: "rust-scripts" });
    expect(result.seal.scriptCount).toBe(1);
    const db = new RsDb(ws.dbPath, ws.lockPath);
    const loaded = db.loadSeal();
    expect(loaded?.scriptCount).toBe(1);
    expect(db.verifySeal(loaded ?? result.seal).ok).toBe(true);
    db.close();
  });
});
