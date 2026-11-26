#!/usr/bin/env node
/**
 * contracts-lint: verify the contract docs cover every exported contract.
 *
 * For each module under src/templates/, extract exported symbols (types,
 * interfaces, classes, functions, const schemas) and check that the
 * corresponding contract doc mentions every symbol name. A missing name
 * means the docs drifted behind the code (or the export is undocumented).
 *
 * Mapping: docs/contracts/<topic>.md ↔ src/templates/<module>.ts
 *   meta.ts        → template-contracts.md
 *   env.ts         → env-contracts.md
 *   config.ts      → config-contracts.md
 *   run.ts         → run-contracts.md
 *   mock.ts        → run-contracts.md
 *   lint.ts        → run-contracts.md
 *   scaffold.ts    → run-contracts.md
 *
 * Exit 0 = all covered; exit 1 = missing symbols listed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src", "templates");
const DOCS = join(ROOT, "docs", "contracts");

const MAPPING = {
  "meta.ts": "template-contracts.md",
  "env.ts": "env-contracts.md",
  "config.ts": "config-contracts.md",
  "run.ts": "run-contracts.md",
  "mock.ts": "run-contracts.md",
  "lint.ts": "run-contracts.md",
  "scaffold.ts": "run-contracts.md",
};

/** Exported symbol names, per export statement form. */
function extractExports(source) {
  const names = new Set();
  const patterns = [
    /export\s+type\s+([A-Za-z0-9_]+)/g,
    /export\s+interface\s+([A-Za-z0-9_]+)/g,
    /export\s+class\s+([A-Za-z0-9_]+)/g,
    /export\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)/g,
    /export\s+\{\s*([^}]+)\s*\}/g,
  ];
  for (const pattern of patterns) {
    const namedList = pattern.source.includes("\\{");
    let match;
    for (;;) {
      match = pattern.exec(source);
      if (match === null) break;
      if (namedList) {
        // named export list: split "a, b as c, type d"
        for (const part of match[1].split(",")) {
          const cleaned = part
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)
            .pop();
          const name = cleaned === undefined ? "" : (cleaned.split(/\s+/).pop() ?? "");
          if (name.length > 0 && /^[A-Za-z0-9_]+$/.test(name)) names.add(name);
        }
      } else {
        names.add(match[1]);
      }
    }
  }
  return [...names];
}

const missing = [];
let checked = 0;

for (const [module, doc] of Object.entries(MAPPING)) {
  const sourcePath = join(SRC, module);
  const docPath = join(DOCS, doc);
  let source;
  let docText;
  try {
    source = readFileSync(sourcePath, "utf8");
    docText = readFileSync(docPath, "utf8");
  } catch {
    missing.push({ module, symbol: "(file unreadable)", doc });
    continue;
  }
  const symbols = extractExports(source);
  for (const symbol of symbols) {
    checked++;
    if (!docText.includes(symbol)) {
      missing.push({ module, symbol, doc });
    }
  }
}

if (missing.length > 0) {
  console.error(`contracts-lint: ${missing.length} symbol(s) missing from docs (of ${checked} checked)`);
  for (const item of missing) {
    console.error(`  src/templates/${item.module}: ${item.symbol} not documented in docs/contracts/${item.doc}`);
  }
  console.error("Contract docs must list every exported contract symbol. Update the doc or drop the export.");
  process.exit(1);
}
console.log(`contracts-lint: all ${checked} exported contract symbols documented`);
