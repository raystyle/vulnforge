import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { collectFiles, syncFilterFromConfig } from "../sync-machine.ts";
import { RsMetaSchema, type RsSource, scriptName } from "./contracts.ts";
import { RsDb, type RsSealRecord } from "./db.ts";
import { parseRsScript } from "./script-parse.ts";

/**
 * Batch-sync exploit rs scripts into the RsDb index. Files are the source of
 * truth; the sync is idempotent (upsert by name). Reuses the config-driven
 * filter machinery with extensions [".rs"], driving the same event-driven
 * state machine contract as the template sync.
 */
export interface RsSyncOptions {
  scriptsDir: string;
  source?: RsSource;
}

export interface RsSyncResult {
  synced: number;
  failed: number;
  lintFindings: Array<{ path: string; issues: string[] }>;
  seal: RsSealRecord;
}

export function runRsSync(root: string, dbPath: string, lockPath: string, options: RsSyncOptions): RsSyncResult {
  const filter = syncFilterFromConfig({
    sync: {
      corpusDir: options.scriptsDir,
      includeDirs: [],
      excludeDirs: [".git", "target", "node_modules"],
      includeFiles: [],
      excludeFiles: [],
      includePatterns: [],
      excludePatterns: [],
    },
  });
  const files = collectFiles(root, filter, [".rs"]);
  const db = new RsDb(dbPath, lockPath);
  let synced = 0;
  let failed = 0;
  const lintFindings: RsSyncResult["lintFindings"] = [];
  for (const rel of files) {
    const absolute = join(root, options.scriptsDir, rel);
    try {
      const source = readFileSync(absolute, "utf8");
      const parsed = parseRsScript(source);
      if (parsed.lintIssues.length > 0) {
        lintFindings.push({ path: rel, issues: parsed.lintIssues.map((issue) => `${issue.rule}: ${issue.message}`) });
      }
      if (parsed.meta.name.length === 0) {
        failed += 1;
        continue;
      }
      const meta = RsMetaSchema.parse({
        name: scriptName(parsed.meta.name),
        description: parsed.meta.description.length > 0 ? parsed.meta.description : parsed.meta.name,
        descriptionEn: parsed.meta.descriptionEn,
        version: parsed.meta.version,
        keywords: parsed.meta.keywords,
        args: parsed.meta.args,
        codes: parsed.meta.codes,
        file: `${options.scriptsDir}/${rel}`,
        source: options.source ?? "project",
        faces: [],
        dangerous: false,
        sha256: parsed.sha256,
      });
      db.upsert(meta);
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  const seal = db.seal();
  db.close();
  return { synced, failed, lintFindings, seal };
}

/** Relative path of a script inside the rs dir (for tool-facing paths). */
export function rsRelativePath(root: string, scriptsDir: string, absolute: string): string {
  const corpusRoot = join(root, scriptsDir);
  return relative(corpusRoot, absolute).replaceAll("\\", "/");
}
