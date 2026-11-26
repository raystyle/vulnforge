#!/usr/bin/env node
/**
 * Spot-check: stratified sample from the workspace corpus through the full
 * pipeline (parse → lint → seed db → FTS lookup per sampled template).
 * Read-only against the real workspace db — uses a scratch db instead.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { TemplateDb } from "../src/templates/meta.ts";
import { lintTemplateFile } from "../src/templates/sync-machine.ts";

const ROOT = "D:/repos/vulnforge-workspace/nuclei-templates";
const CORPUS_DIRS = [
  "http",
  "dns",
  "ssl",
  "network",
  "file",
  "headless",
  "websocket",
  "workflows",
  "javascript",
  "code",
];

function collectFiles() {
  const files = [];
  for (const dir of CORPUS_DIRS) {
    const walk = (d) => {
      let entries;
      try {
        entries = readdirSync(join(ROOT, d), { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
          files.push(relative(ROOT, join(ROOT, full)).replaceAll("\\", "/"));
      }
    };
    walk(dir);
  }
  return files;
}

const files = collectFiles();
const sample = files.filter((_, i) => i % 97 === 0).slice(0, 150);
console.log(`corpus: ${files.length} | sampled: ${sample.length}`);
const byTop = {};
for (const f of sample) {
  const top = f.split("/")[0];
  byTop[top] = (byTop[top] ?? 0) + 1;
}
console.log("sample distribution:", JSON.stringify(byTop));

// Stage 1: parse + lint per sample
let parseOk = 0;
let parseFail = 0;
let lintErrors = 0;
let lintWarnings = 0;
const failList = [];
const lintErrorList = [];
for (const rel of sample) {
  const lint = lintTemplateFile(readFileSync(join(ROOT, rel), "utf8"), rel);
  if (lint.error !== undefined) {
    parseFail += 1;
    if (failList.length < 5) failList.push(`${rel} :: ${lint.error.slice(0, 70)}`);
    continue;
  }
  parseOk += 1;
  lintErrors += lint.docFindings.filter((f) => f.level === "error").length;
  lintWarnings +=
    lint.yamlFindings.filter((f) => f.level === "warning").length +
    lint.docFindings.filter((f) => f.level === "warning").length;
  if (lintErrorList.length < 5 && lint.docFindings.some((f) => f.level === "error")) {
    lintErrorList.push(`${rel} :: ${lint.docFindings.filter((f) => f.level === "error")[0]?.message.slice(0, 70)}`);
  }
}
console.log(`[1] parse: ${parseOk} ok / ${parseFail} fail`);
for (const line of failList) console.log(`    ${line}`);
console.log(`[2] lint: ${lintErrors} error findings, ${lintWarnings} warnings`);
for (const line of lintErrorList) console.log(`    ${line}`);
// error rule distribution across the sample
const ruleFreq = {};
for (const rel of sample) {
  const lint = lintTemplateFile(readFileSync(join(ROOT, rel), "utf8"), rel);
  for (const finding of lint.docFindings) {
    if (finding.level === "error") ruleFreq[finding.rule] = (ruleFreq[finding.rule] ?? 0) + 1;
  }
}
console.log("    error rule distribution:");
Object.entries(ruleFreq)
  .sort((a, b) => b[1] - a[1])
  .forEach(([rule, n]) => console.log(`      ${String(n).padStart(4)}  ${rule}`));

// Stage 2: seed scratch db + FTS lookup per sample id
const scratch = mkdtempSync(join(tmpdir(), "vf-spot-"));
const db = new TemplateDb(join(scratch, "spot.db"));
let indexed = 0;
for (const rel of sample) {
  const parsed = parseOne(join(ROOT, rel));
  if (parsed === null) continue;
  await db.upsert(parsed, rel);
  indexed += 1;
}
function parseOne(absolutePath) {
  // re-use parseTemplateFile through sync-machine's module graph
  return parseOneCache(absolutePath);
}

import { parseTemplateFile } from "../src/templates/meta.ts";

function parseOneCache(absolutePath) {
  const parsed = parseTemplateFile(absolutePath);
  return "parseError" in parsed ? null : parsed.meta;
}
console.log(`[3] indexed into scratch db: ${indexed}`);

// Stage 3: FTS lookup by id fragment per 10th sample (quote the term for FTS5)
let lookupOk = 0;
let lookupMiss = 0;
for (let i = 0; i < sample.length; i += 10) {
  const id = sample[i]
    .split("/")
    .pop()
    .replace(/\.(yaml|yml)$/, "");
  const hits = db.search(`"${id}"`);
  if (hits.some((hit) => hit.relativePath === sample[i])) lookupOk += 1;
  else lookupMiss += 1;
}
console.log(`[4] FTS roundtrip: ${lookupOk} found / ${lookupMiss} missed`);
db.close();
rmSync(scratch, { recursive: true, force: true });
