import type { MetaColumn, TemplateDb } from "./meta.ts";

/** Render the metadata stats report for one dimension (pure, db-injected). */
export function renderStats(db: TemplateDb, dimension: MetaColumn, limit: number): string {
  const stats = db.stats();
  const lines: string[] = [`total: ${stats.total}`];
  lines.push(`severity: ${stats.bySeverity.map((row) => `${row.key}=${row.count}`).join(", ")}`);

  if (dimension === "cve") {
    const cves = db.groupBy("cve", limit * 4, "cve != ''");
    const byYear = new Map<string, number>();
    for (const row of cves) {
      const year = /^CVE-(\d{4})-/.exec(row.key)?.[1];
      if (year === undefined) continue;
      const ids = row.key.split(",").filter((entry) => /^CVE-\d{4}-\d+/.test(entry)).length;
      byYear.set(year, (byYear.get(year) ?? 0) + row.count * Math.max(1, Math.min(ids, 4)));
    }
    lines.push("cve year histogram (weighted):");
    for (const [year, count] of [...byYear.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
      lines.push(`  ${year}: ${count}`);
    }
  } else {
    const groups = db.groupBy(dimension, limit);
    lines.push(`${dimension} top${limit}:`);
    for (const row of groups) {
      // row.count is a branded natural from GroupByRowSchema — display only.
      lines.push(`  ${String(row.count).padStart(6)}  ${row.key.slice(0, 60)}`); // brand-allow: display of branded natural
    }
  }

  const dups = db.findDuplicates();
  lines.push(`duplicate keys: ${dups.length}`);
  return lines.join("\n");
}
