#!/usr/bin/env node
/**
 * brand-lint: enforce the branded-contract discipline in src/.
 *
 * Violations (each line matched, `// brand-allow` on the line opts out):
 *   1. Casting to a contract type instead of decoding:
 *      `as Severity` / `as Protocol` / `as TemplateId` / `as TplMetaRow`
 *   2. String()-coercing raw record fields instead of a typed decoder:
 *      `String(row.` / `String(record.`
 *   3. Array-cast to silence SQL params:
 *      `as string[]`
 *
 * Exit 0 = clean; exit 1 = violations listed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

const PATTERNS = [
  { rule: "brand/cast-to-contract", regex: /\bas\s+(?:Severity|Protocol|TemplateId|TplMetaRow|TplMetaContract)\b/ },
  { rule: "brand/string-coercion", regex: /String\(\s*(?:row|record|entry|item|parsed)\./ },
  { rule: "brand/array-cast", regex: /\bas\s+string\[\]/ },
];

/**
 * Tool registry discipline: registerTool execute bodies must stay thin —
 * no imperative loops (for/while/do). Multi-step logic belongs in an
 * event-driven state machine or a pure module function.
 */
function lintToolBodies(source, relPath, violations) {
  const toolPattern = /registerTool\(\{[\s\S]*?async execute\([\s\S]*?\n {2}\}\)/g;
  let match;
  for (;;) {
    match = toolPattern.exec(source);
    if (match === null) break;
    const body = match[0];
    const loopPattern = /^\s*(?:for\s*\(|while\s*\(|do\s*\{)/m;
    if (loopPattern.test(body)) {
      violations.push({
        file: relPath,
        line: lineOfIndex(source, match.index),
        rule: "brand/tool-loop",
        text: "imperative loop inside registerTool execute — move multi-step logic to an event-driven state machine or pure module",
      });
    }
  }
}

function lineOfIndex(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (entry.name.endsWith(".ts")) yield full;
  }
}

const violations = [];
for (const file of walk(SRC)) {
  const relPath = file.slice(ROOT.length + 1).replaceAll("\\", "/");
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.includes("// brand-allow")) continue;
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) {
        violations.push({
          file: relPath,
          line: index + 1,
          rule: pattern.rule,
          text: line.trim().slice(0, 120),
        });
      }
    }
  }
  lintToolBodies(source, relPath, violations);
}

if (violations.length > 0) {
  console.error(`brand-lint: ${violations.length} violation(s)`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line} [${violation.rule}] ${violation.text}`);
  }
  console.error(
    "Decode at the boundary (zod safeParse / branded constructors) instead of casting. Opt out per line with `// brand-allow`.",
  );
  process.exit(1);
}
console.log("brand-lint: clean");
