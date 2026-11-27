import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scriptName } from "../../../src/templates/rs/contracts.ts";
import { RsDb } from "../../../src/templates/rs/db.ts";
import { type RsStatsDimension, renderRsStats, rsOverview, rsStatsBy } from "../../../src/templates/rs/stats.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seeded(): RsDb {
  const dir = mkdtempSync(join(tmpdir(), "vf-rsstats-"));
  scratch.push(dir);
  const db = new RsDb(join(dir, "rs.db"), join(dir, "rs-lock.json"));
  const mk = (
    raw: string,
    source: "project" | "global" | "bundled",
    kind: string,
    dangerous: boolean,
    description: string,
  ) =>
    db.upsert({
      name: scriptName(raw),
      description,
      descriptionEn: description,
      version: "1.0.0",
      keywords: [kind],
      args: "<url>",
      codes: "",
      file: `rust-scripts/${scriptName(raw)}.rs`,
      source,
      faces: [kind],
      dangerous,
      sha256: "ab".repeat(32),
    });
  mk("CVE-2026-0001", "project", "rce", false, "rce one");
  mk("CVE-2026-0002", "project", "rce", true, "rce two");
  mk("CVE-2026-0003", "global", "sqli", false, "sqli one");
  mk("thinkphp-5-rce", "bundled", "rce", false, "rce alias");
  return db;
}

describe("rs stats", () => {
  it("overview: total + per-source counts + dangerous count", () => {
    const db = seeded();
    const overview = rsOverview(db);
    expect(overview.total).toBe(4);
    expect(overview.bySource).toContainEqual({ key: "project", count: 2 });
    expect(overview.bySource).toContainEqual({ key: "global", count: 1 });
    expect(overview.bySource).toContainEqual({ key: "bundled", count: 1 });
    expect(overview.dangerousCount).toBe(1);
    db.close();
  });

  it("group-by every dimension sums to the total", () => {
    const db = seeded();
    for (const dimension of [
      "source",
      "faces",
      "dangerous",
      "version",
      "keywords",
    ] as const satisfies readonly RsStatsDimension[]) {
      const rows = rsStatsBy(db, dimension);
      expect(rows.length).toBeGreaterThan(0);
      const total = rows.reduce((sum, row) => sum + row.count, 0);
      expect(total).toBe(4);
    }
    db.close();
  });

  it("render output carries the overview facts", () => {
    const db = seeded();
    const text = renderRsStats(db);
    expect(text).toContain("total: 4");
    expect(text).toContain("project=2");
    db.close();
  });
});
