import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createActor, setup } from "xstate";
import { parse } from "yaml";
import { type LintFinding, lintDocument, type TemplateInfo } from "./lint.ts";
import { parseTemplateFile, type SyncResult, type TemplateDb } from "./meta.ts";
import { lintYaml, type YamlLintFinding } from "./yamllint.ts";

export interface BatchItemOutcome {
  path: string;
  status: "indexed" | "failed";
  error?: string;
  lintErrors: number;
}

export interface SyncJobSnapshot {
  jobId: number;
  root: string;
  phase: "scanning" | "indexing" | "sealing" | "done" | "aborted";
  cursor: number;
  total: number;
  indexed: number;
  failed: Array<{ path: string; error: string }>;
  sealedSha16?: string;
}

export interface SyncMachineContext {
  jobId: number;
  root: string;
  db: TemplateDb;
  files: string[];
  cursor: number;
  results: BatchItemOutcome[];
  sealedSha16?: string;
}

export type SyncEvent =
  | { type: "SCAN_DONE"; files: string[] }
  | { type: "FILE_DONE"; path: string; outcome: BatchItemOutcome }
  | { type: "BATCH_COMPLETE" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "ABORT"; reason: string };

// Upstream non-template dirs: profiles/ and helpers/ hold engine configs and
// payload files, never templates.
const SYNC_EXCLUDED_DIRS = [".git", ".github", "node_modules", "profiles", "helpers"];

export interface SyncMachineInput {
  jobId: number;
  root: string;
  db: TemplateDb;
  files: string[];
  cursor: number;
  results: BatchItemOutcome[];
}

export interface SyncFilter {
  corpusDir: string;
  includeDirs: string[];
  excludeDirs: string[];
  includeFiles: string[];
  excludeFiles: string[];
  includePatterns: RegExp[];
  excludePatterns: RegExp[];
}

/** Build the sync filter from a parsed config (patterns compiled here). */
export function syncFilterFromConfig(config: {
  sync: {
    corpusDir: string;
    includeDirs: string[];
    excludeDirs: string[];
    includeFiles: string[];
    excludeFiles: string[];
    includePatterns: string[];
    excludePatterns: string[];
  };
}): SyncFilter {
  return {
    corpusDir: config.sync.corpusDir,
    includeDirs: config.sync.includeDirs,
    excludeDirs: config.sync.excludeDirs,
    includeFiles: config.sync.includeFiles,
    excludeFiles: config.sync.excludeFiles,
    includePatterns: config.sync.includePatterns.map((source) => new RegExp(source, "i")),
    excludePatterns: config.sync.excludePatterns.map((source) => new RegExp(source, "i")),
  };
}

const DEFAULT_FILTER: SyncFilter = {
  corpusDir: "",
  includeDirs: [],
  excludeDirs: SYNC_EXCLUDED_DIRS,
  includeFiles: [],
  excludeFiles: [],
  includePatterns: [],
  excludePatterns: [],
};

/** Config-driven file collection: corpusDir → include/exclude dirs, files, and
 * regex patterns (relative path, case-insensitive). */
export function collectYamlFiles(root: string, filter: SyncFilter = DEFAULT_FILTER): string[] {
  const corpusRoot = filter.corpusDir.length > 0 ? join(root, filter.corpusDir) : root;
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Excluded at any depth — nested corpora put excluded dirs below the root.
        if (filter.excludeDirs.includes(entry.name)) continue;
        walk(full);
        continue;
      }
      const rel = relative(corpusRoot, full).replaceAll("\\", "/");
      if (filter.includeDirs.length > 0) {
        const top = rel.split("/")[0] ?? "";
        if (!filter.includeDirs.includes(top)) continue;
      }
      const fileName = entry.name;
      if (filter.includeFiles.length > 0) {
        if (!filter.includeFiles.includes(fileName)) continue;
      } else if (!fileName.endsWith(".yaml") && !fileName.endsWith(".yml")) {
        continue;
      }
      if (filter.excludeFiles.includes(fileName)) continue;
      if (filter.excludePatterns.some((pattern) => pattern.test(rel))) continue;
      if (filter.includePatterns.length > 0 && !filter.includePatterns.some((pattern) => pattern.test(rel))) continue;
      files.push(rel);
    }
  };
  walk(corpusRoot);
  return files.sort();
}

/** Fully lint one template file: yaml syntax/style + structure + weak matchers. */
export function lintTemplateFile(
  source: string,
  fileName: string,
): { yamlFindings: YamlLintFinding[]; docFindings: LintFinding[]; error?: string | undefined } {
  const yamlFindings = lintYaml(source, fileName);
  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    return { yamlFindings, docFindings: [], error: (error as Error).message.split("\n")[0] ?? "yaml parse failed" };
  }
  const docFindings = lintDocument(parsed as TemplateInfo);
  return { yamlFindings, docFindings, error: undefined };
}

/**
 * Batch sync machine: scanning → indexing (one file per self-transition) →
 * sealing → done. PAUSE checkpoints cursor+results into the db job table;
 * RESUME continues from the cursor instead of restarting the batch.
 */
/** Compile-time exhaustiveness: adding a SyncEvent variant without handling
 * it in the machine's coverage switch below fails `tsc --noEmit`. */
export function assertSyncEventHandled(event: SyncEvent): never {
  switch (event.type) {
    case "SCAN_DONE":
    case "FILE_DONE":
    case "BATCH_COMPLETE":
    case "PAUSE":
    case "RESUME":
    case "ABORT":
      throw new Error(`unreachable: ${event.type} is handled by the machine graph`);
    default: {
      const unhandled: never = event;
      throw new Error(`unhandled sync event: ${JSON.stringify(unhandled)}`);
    }
  }
}

function handledEventTypes(): ReadonlySet<string> {
  const types = new Set<string>();
  for (const variant of [
    { type: "SCAN_DONE" },
    { type: "FILE_DONE" },
    { type: "BATCH_COMPLETE" },
    { type: "PAUSE" },
    { type: "RESUME" },
    { type: "ABORT" },
  ] as SyncEvent[]) {
    types.add(variant.type);
  }
  return types;
}

export const SYNC_EVENT_TYPES: ReadonlySet<string> = handledEventTypes();

export const syncMachine = setup({
  types: {
    context: {} as SyncMachineContext,
    events: {} as SyncEvent,
    input: {} as SyncMachineInput,
  },
  actions: {
    recordScan: ({ context, event }) => {
      if (event.type !== "SCAN_DONE") return;
      context.files = event.files;
      context.cursor = 0;
      context.results = [];
    },
    recordFile: ({ context, event }) => {
      if (event.type !== "FILE_DONE") return;
      context.results.push(event.outcome);
      context.cursor += 1;
    },
    seal: ({ context }) => {
      const seal = context.db.seal();
      context.sealedSha16 = seal.dbSha256.slice(0, 16);
      saveJobSnapshot(context, "done");
    },
    abortJob: ({ context, event }) => {
      if (event.type !== "ABORT") return;
      saveJobSnapshot(context, "aborted");
    },
  },
  guards: {
    hasMoreFiles: ({ context }) => context.cursor < context.files.length,
    batchEmpty: ({ context }) => context.files.length === 0,
  },
}).createMachine({
  id: "sync",
  initial: "scanning",
  context: ({ input }) => ({
    jobId: input.jobId,
    root: input.root,
    db: input.db,
    files: input.files,
    cursor: input.cursor,
    results: input.results,
  }),
  states: {
    scanning: {
      entry: ({ context }) => saveJobSnapshot(context, "scanning"),
      on: {
        SCAN_DONE: {
          target: "indexing",
          actions: "recordScan",
        },
        RESUME: { actions: ({ context }) => saveJobSnapshot(context, "scanning") },
      },
    },
    indexing: {
      entry: ({ context }) => saveJobSnapshot(context, "indexing"),
      on: {
        FILE_DONE: { actions: "recordFile" },
        BATCH_COMPLETE: { target: "sealing" },
        PAUSE: {
          target: "sealing",
          actions: ({ context }) => saveJobSnapshot(context, "indexing"),
        },
        ABORT: { target: "aborted", actions: "abortJob" },
      },
    },
    sealing: {
      entry: "seal",
      type: "final",
    },
    done: { type: "final" },
    aborted: { type: "final" },
  },
});

const JOB_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS sync_jobs (
  job_id INTEGER PRIMARY KEY,
  root TEXT NOT NULL,
  phase TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT ''
);
`;

function ensureJobTable(db: TemplateDb): void {
  (db as unknown as { client: { exec: (sql: string) => void } }).client.exec(JOB_TABLE_DDL);
}

function saveJobSnapshot(context: SyncMachineContext, phase: SyncJobSnapshot["phase"]): void {
  const snapshot: SyncJobSnapshot = {
    jobId: context.jobId,
    root: context.root,
    phase,
    cursor: context.cursor,
    total: context.files.length,
    indexed: context.results.filter((result) => result.status === "indexed").length,
    failed: context.results
      .filter((result) => result.status === "failed")
      .map((result) => ({ path: result.path, error: result.error ?? "unknown" })),
    ...(context.sealedSha16 !== undefined ? { sealedSha16: context.sealedSha16 } : {}),
  };
  const client = (
    context.db as unknown as { client: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }
  ).client;
  client
    .prepare(
      "INSERT INTO sync_jobs (job_id, root, phase, cursor, total, snapshot_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET root=excluded.root, phase=excluded.phase, cursor=excluded.cursor, total=excluded.total, snapshot_json=excluded.snapshot_json, updated_at=excluded.updated_at",
    )
    .run(
      snapshot.jobId,
      snapshot.root,
      snapshot.phase,
      snapshot.cursor,
      snapshot.total,
      JSON.stringify(snapshot),
      new Date().toISOString(),
    );
}

export function loadJobSnapshot(db: TemplateDb, jobId: number): SyncJobSnapshot | undefined {
  ensureJobTable(db);
  const client = (db as unknown as { client: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } } })
    .client;
  const row = client.prepare("SELECT snapshot_json FROM sync_jobs WHERE job_id = ?").get(jobId) as
    | { snapshot_json?: string }
    | undefined;
  if (row === undefined || typeof row.snapshot_json !== "string") return undefined;
  try {
    return JSON.parse(row.snapshot_json) as SyncJobSnapshot;
  } catch {
    return undefined;
  }
}

export interface BatchRunResult extends SyncResult {
  lintFindings: Array<{ path: string; errors: number; warnings: number }>;
}

/**
 * Drive the sync machine over every file: parse → lint → upsert, one FILE_DONE
 * event per file. Returns the classic SyncResult shape plus lint aggregates.
 * Pause/abort write a snapshot that runBatchSync can resume from later.
 */
export async function runBatchSync(
  db: TemplateDb,
  root: string,
  options: { jobId?: number; resumeFrom?: number; filter?: SyncFilter } = {},
): Promise<BatchRunResult> {
  ensureJobTable(db);
  const jobId = options.jobId ?? Date.now();
  const previous = loadJobSnapshot(db, jobId);
  let startCursor = 0;
  if (typeof options.resumeFrom === "number") {
    startCursor = options.resumeFrom;
  } else if (previous?.phase === "indexing") {
    startCursor = previous.cursor;
  }

  const files = collectYamlFiles(root, options.filter);
  const batch = files.slice(startCursor);
  // Relative paths are corpus-relative; reads must resolve against the corpus root.
  const corpusRoot =
    options.filter !== undefined && options.filter.corpusDir.length > 0 ? join(root, options.filter.corpusDir) : root;
  const actor = createActor(syncMachine, {
    input: {
      jobId,
      root,
      db,
      files: batch,
      cursor: 0,
      results: [],
    },
  });
  actor.start();
  actor.send({ type: "SCAN_DONE", files: batch });

  const synced: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  const removed: string[] = [];
  const lintFindings: Array<{ path: string; errors: number; warnings: number }> = [];

  for (const rel of batch) {
    let outcome: BatchItemOutcome;
    try {
      const absolute = join(corpusRoot, rel);
      const lint = lintTemplateFile(readFileSync(absolute, "utf8"), rel);
      const lintErrors =
        lint.yamlFindings.filter((finding) => finding.level === "error").length +
        lint.docFindings.filter((finding) => finding.level === "error").length;
      const lintWarnings =
        lint.yamlFindings.filter((finding) => finding.level === "warning").length +
        lint.docFindings.filter((finding) => finding.level === "warning").length;
      if (lint.error !== undefined) {
        outcome = { path: rel, status: "failed", error: lint.error, lintErrors };
        failed.push({ path: rel, error: lint.error });
      } else {
        const parsed = parseTemplateFile(absolute);
        if ("parseError" in parsed) {
          outcome = { path: rel, status: "failed", error: parsed.parseError, lintErrors };
          failed.push({ path: rel, error: parsed.parseError });
        } else {
          await db.upsert(parsed.meta, rel);
          outcome = { path: rel, status: "indexed", lintErrors };
          synced.push(rel);
        }
      }
      lintFindings.push({ path: rel, errors: lintErrors, warnings: lintWarnings });
    } catch (error) {
      outcome = { path: rel, status: "failed", error: (error as Error).message, lintErrors: 0 };
      failed.push({ path: rel, error: (error as Error).message });
    }
    actor.send({ type: "FILE_DONE", path: rel, outcome });
  }

  actor.send({ type: "BATCH_COMPLETE" });

  return { synced, failed, removed, lintFindings };
}
