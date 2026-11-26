#!/usr/bin/env node
/**
 * Performance probe: full upstream corpus through the VulnForge pipeline.
 * Stages: (1) parse-only throughput, (2) full db sync (parse+lint+upsert),
 * (3) FTS search latency at scale, (4) duplicate detection, (5) seal.
 * Scratch db — never touches the real templates repo db.
 */
// Template-repo root: read from the real config (no hardcoded paths).
// Resolution order: VULNFORGE_UPSTREAM env → .vulnforge.json sibling of ROOT → error.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { findTemplatesRoot } from "../src/templates/config.ts";
import { parseTemplateFile, TemplateDb } from "../src/templates/meta.ts";
import { runBatchSync } from "../src/templates/sync-machine.ts";

function resolveRoot() {
  // Config-driven: .vulnforge.json workspace marker discovered upward from
  // VULNFORGE_WORKSPACE (config dir) or cwd; env VULNFORGE_UPSTREAM only as an override.
  const workspace = process.env["VULNFORGE_WORKSPACE"] ?? process.cwd();
  try {
    return findTemplatesRoot(workspace);
  } catch {
    const fallback = join(homedir(), "repos", "vulnforge-workspace");
    if (existsSync(join(fallback, ".vulnforge.json"))) return fallback;
    if (process.env["VULNFORGE_UPSTREAM"] !== undefined && process.env["VULNFORGE_UPSTREAM"].length > 0) {
      return process.env["VULNFORGE_UPSTREAM"];
    }
    throw new Error(
      "No templates workspace found: run from a directory under the templates repo, or set VULNFORGE_WORKSPACE=<dir under the templates repo>, or VULNFORGE_UPSTREAM=<corpus root>",
    );
  }
}

const ROOT = resolveRoot();
// Scratch db for bench; the real repo db (config db.filename under ROOT) is
// only written by vf_nuclei_sync in a live session.
const SCRATCH = mkdtempSync(join(tmpdir(), "vf-bench-"));

// Corpus subdirs: template repos only, or explicit dir list via env.
const CORPUS_DIRS =
  process.env["VULNFORGE_BENCH_DIRS"] ?? "http,dns,ssl,network,file,headless,websocket,workflows,javascript,code";

function collectFiles() {
  const files = [];
  for (const dir of CORPUS_DIRS.split(",")
    .map((d) => d.trim())
    .filter(Boolean)) {
    const abs = join(ROOT, dir);
    const walk = (d) => {
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
          files.push(relative(ROOT, full).replaceAll("\\", "/"));
        }
      }
    };
    walk(abs);
  }
  return files;
}

async function main() {
  const files = collectFiles();
  console.log(`corpus: ${files.length} yaml files`);

  // Stage 1: parse-only
  const t1 = Date.now();
  let ok = 0;
  let fail = 0;
  const fails = [];
  for (const rel of files) {
    const parsed = parseTemplateFile(join(ROOT, rel));
    if ("parseError" in parsed) {
      fail += 1;
      if (fails.length < 5) fails.push(`${rel} :: ${parsed.parseError.slice(0, 60)}`);
    } else {
      ok += 1;
    }
  }
  const parseMs = Date.now() - t1;
  console.log(
    `[1] parse-only: ${ok} ok / ${fail} fail in ${parseMs}ms = ${(files.length / (parseMs / 1000)).toFixed(0)} files/sec`,
  );
  for (const line of fails) console.log(`    ${line}`);

  // Stage 2: full batch sync (machine: parse+lint+upsert)
  const db = new TemplateDb(join(SCRATCH, "bench.db"));
  const t2 = Date.now();
  const result = await runBatchSync(db, ROOT, { jobId: 1 });
  const syncMs = Date.now() - t2;
  console.log(
    `[2] batch sync: ${result.synced.length} synced / ${result.failed.length} failed in ${syncMs}ms = ${(result.synced.length / (syncMs / 1000)).toFixed(0)} files/sec; db rows ${db.count()}`,
  );

  // Stage 3: search latency at scale (cold + repeated)
  const queries = ["grafana", "cve rce", "apache struts", "panel", "wordpress plugin"];
  for (const query of queries) {
    const t3 = Date.now();
    const hits = db.search(query);
    console.log(`[3] search "${query}": ${hits.length} hits in ${Date.now() - t3}ms`);
  }
  const tFiltered = Date.now();
  db.search("panel", { severity: "critical" });
  console.log(`[3] filtered search: ${Date.now() - tFiltered}ms`);

  // Stage 4: duplicates
  const t4 = Date.now();
  const dups = db.findDuplicates();
  console.log(`[4] duplicate keys: ${dups.length} in ${Date.now() - t4}ms`);

  // Stage 5: seal
  const t5 = Date.now();
  const seal = db.seal();
  console.log(`[5] seal: sha16=${seal.dbSha256.slice(0, 16)} count=${seal.templateCount} in ${Date.now() - t5}ms`);

  db.close();
  rmSync(SCRATCH, { recursive: true, force: true });
  console.log(`TOTAL: ${Date.now() - t1}ms`);
}

await main();
