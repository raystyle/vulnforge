// P4 lint census: run lintTemplateFile over the full corpus, aggregate
// findings by rule x level, and split by source tree (converted aipts vs
// poc-templates base) so the converter's quality is measurable.
// Output: lint-census.json + top-rule console summary.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { lintTemplateFile } from "../src/templates/lint.ts";

const root = process.argv[2] ?? "D:/repos/vulnforge-workspace/nuclei-poc";
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name.startsWith(".") ||
      entry.name === "tools" ||
      entry.name === "dedupe-out" ||
      entry.name === "out-sample"
    )
      continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) files.push(full);
  }
};
walk(root);

const byRule = new Map();
const bySource = {
  "aipts-converted": { files: 0, errors: 0, warnings: 0 },
  "poc-base": { files: 0, errors: 0, warnings: 0 },
};
let parseErrors = 0;
for (const file of files) {
  const rel = relative(root, file).replaceAll("\\", "/");
  const source =
    rel.includes("/cves/") || rel.includes("vulnerabilities/aipts") || rel.includes("converted")
      ? "aipts-converted"
      : rel.includes("http/vulnerabilities/aipts/") || readFileSync(file, "utf8").includes("# converted from aipts_poc")
        ? "aipts-converted"
        : "poc-base";
  const bucket = bySource[source];
  bucket.files += 1;
  let lint;
  try {
    lint = lintTemplateFile(readFileSync(file, "utf8"), rel);
  } catch {
    parseErrors += 1;
    continue;
  }
  if (lint.error !== undefined) parseErrors += 1;
  const all = [
    ...lint.yamlFindings.map((f) => ({ level: f.level, rule: f.rule })),
    ...lint.docFindings.map((f) => ({ level: f.level, rule: f.rule })),
  ];
  for (const f of all) {
    if (f.level === "error") bucket.errors += 1;
    else bucket.warnings += 1;
    const key = `${f.rule}|${f.level}`;
    byRule.set(key, (byRule.get(key) ?? 0) + 1);
  }
}
const rules = [...byRule.entries()]
  .map(([key, count]) => {
    const [rule, level] = key.split("|");
    return { rule, level, count };
  })
  .sort((a, b) => b.count - a.count);
const report = { files: files.length, parseErrors, bySource, rules };
writeFileSync(join(root, "lint-census.json"), JSON.stringify(report, null, 2));
console.log("files:", files.length, "parseErrors:", parseErrors);
console.log("bySource:", JSON.stringify(bySource));
console.log("top 12 rules:");
for (const r of rules.slice(0, 12)) console.log(`  ${r.count}  [${r.level}] ${r.rule}`);
