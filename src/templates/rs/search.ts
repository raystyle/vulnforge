import { join } from "node:path";
import type { RsMeta } from "./contracts.ts";
import { RsDb } from "./db.ts";

/**
 * rs_search surface: FTS discovery over the rs catalog + the cross-domain
 * anchor (given a vulnerability id — typically from a nuclei PoC hit —
 * resolve the exploit rs for that vulnerability).
 */
export interface RsSearchHit extends RsMeta {
  snippet: string;
}

export interface RsSearchOutcome {
  hits: RsSearchHit[];
  /** Exploit scripts matching a vulnerability id (cross-domain query). */
  exploitFor: RsMeta[];
  engine: "fts";
}

export function rsSearch(
  db: RsDb,
  query: string,
  filters: { source?: string; dangerous?: boolean } = {},
): RsSearchOutcome {
  const hits = db.search(query, filters);
  return { hits, exploitFor: [], engine: "fts" };
}

/** Cross-domain: PoC hit (vulnerability id) -> the exploit rs for it. */
export function rsExploitFor(db: RsDb, vulnId: string): RsMeta[] {
  return db.findByVulnerability(vulnId);
}

/** Open the rs catalog db from workspace paths (config-derived). */
export function openRsDb(root: string): RsDb {
  return new RsDb(join(root, "rs.db"), join(root, "rs-lock.json"));
}

/** Render the search outcome for the tool result (agent-friendly text). */
export function renderRsSearch(outcome: RsSearchOutcome, limit = 20): string {
  if (outcome.exploitFor.length > 0) {
    const lines = outcome.exploitFor
      .slice(0, limit)
      .map((meta) => `- ${meta.name} [${meta.version}] ${meta.args} :: ${meta.description.slice(0, 80)}`);
    return `exploit rs for vulnerability (${outcome.exploitFor.length}):\n${lines.join("\n")}`;
  }
  if (outcome.hits.length === 0) return "no matches — run rs sync first or broaden the query";
  const lines = outcome.hits
    .slice(0, limit)
    .map((hit) => `- ${hit.name} [${hit.version}] (${hit.source}) ${hit.args} :: ${hit.snippet.slice(0, 70)}`);
  return `${outcome.hits.length} match(es):\n${lines.join("\n")}`;
}
