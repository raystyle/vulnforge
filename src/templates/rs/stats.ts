import { z } from "zod";
import type { RsDb } from "./db.ts";

/**
 * exploit_rs_stats: read-only analysis over the rs catalog — the
 * exploit-side counterpart of the poc_nuclei_stats face. Same group-by
 * shape as the poc side (non-empty key + branded count via zod).
 */
export const RsStatsDimensionSchema = z.enum(["source", "faces", "dangerous", "version", "keywords"]);
export type RsStatsDimension = z.infer<typeof RsStatsDimensionSchema>;

export const RsStatsRowSchema = z.object({
  key: z.string().min(1),
  count: z.number().int().nonnegative().brand<"RowCount">(),
});
export type RsStatsRow = z.infer<typeof RsStatsRowSchema>;

export const RsOverviewSchema = z.object({
  total: z.number().int().nonnegative().brand<"RsTotalCount">(),
  bySource: z.array(RsStatsRowSchema),
  dangerousCount: z.number().int().nonnegative().brand<"RsDangerousCount">(),
});
export type RsOverview = z.infer<typeof RsOverviewSchema>;

/** Build the rows through the zod boundary — never trust raw SQL counts. */
function brandedRows(rows: Array<{ key: string; count: number }>): RsStatsRow[] {
  return rows.map((row) => RsStatsRowSchema.parse(row));
}

/** Overview: total + per-source distribution + dangerous count. */
export function rsOverview(db: RsDb): RsOverview {
  return RsOverviewSchema.parse({
    total: db.count(),
    bySource: db.groupBy("source"),
    dangerousCount: db.groupBy("dangerous").find((row) => row.key === "1")?.count ?? 0,
  });
}

/** Group-by one analysis dimension (branded rows). */
export function rsStatsBy(db: RsDb, dimension: RsStatsDimension): RsStatsRow[] {
  return brandedRows(db.groupBy(dimension));
}

/** Render the analysis as the tool result text. */
export function renderRsStats(db: RsDb, dimension?: RsStatsDimension, limit = 15): string {
  if (dimension === undefined) {
    const overview = rsOverview(db);
    const sourceLine = overview.bySource.map((row) => `${row.key}=${row.count}`).join(", ");
    return [`total: ${overview.total}`, `source: ${sourceLine}`, `dangerous: ${overview.dangerousCount}`].join("\n");
  }
  const rows = rsStatsBy(db, dimension).slice(0, limit);
  return [
    `dimension ${dimension}: ${rows.length} group(s)`,
    ...rows.map((row) => `${String(row.count).padStart(5)}  ${row.key}`), // brand-allow: display pad, contract already decoded,
  ].join("\n");
}
