#!/usr/bin/env node
/**
 * system-lint: global consistency checks for the Claude dev-system assets.
 *
 * Precedent: manypkg's check registry (each check = a named unit: validate →
 * typed findings → aggregated exit) specialized for THIS repo's asset graph:
 *
 *   facts-of-record                      derived documents that must echo them
 *   ----------------                     ----------------------------------
 *   package.json scripts.check           .claude/rules/pi-extension.md, verify
 *                                         skill, README.md, README_EN.md
 *   src/index.ts registrations           docs/tools.md (already covered by
 *                                         contracts-lint; here: counts + no
 *                                         duplicate doc sections)
 *   .ad_records/NNN-*.md files           .ad_records/README.md index rows
 *   .research/<feature>/ dirs            .research/README.md feature table
 *   .claude/hooks/*.mjs                  CODE_DIRS watched by verify-evidence
 *   state-machine rule in rules          src machine wiring + README mention
 *   skill three-piece discipline         every skill dir has SKILL.md
 *
 * Exit 0 = all checks pass; exit 1 = findings listed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const exists = (rel) => existsSync(join(ROOT, rel));

const findings = [];
let checked = 0;

function check(name, validate) {
  const results = validate();
  for (const result of results) {
    findings.push({ check: name, ...result });
  }
  checked++;
}

/** Extract the check-gate command list from package.json scripts.check. */
function gateStages() {
  const pkg = JSON.parse(read("package.json"));
  const stages = [];
  for (const part of pkg.scripts.check.split("&&")) {
    const cleaned = part.trim();
    // "node tools/brand-lint.mjs" → "brand-lint"; "vitest run" → "vitest"
    const match = cleaned.match(/^(?:node tools\/)?([a-z-]+)(?:\.mjs)?(?:\s|$)/);
    if (match) stages.push(match[1]);
  }
  return stages;
}

// ---------------------------------------------------------------------------
// 1. Check-gate list must be echoed by every document that describes the gate
// ---------------------------------------------------------------------------
check("gate-docs-alignment", () => {
  const required = ["brand-lint", "contracts-lint", "system-lint", "vitest", "tsc"];
  const docs = [
    [".claude/rules/pi-extension.md", "Pi extension rules (gate block)"],
    [".claude/skills/verify/SKILL.md", "verify skill (gate step)"],
    ["README.md", "Chinese README (engineering discipline)"],
    ["README_EN.md", "English README (engineering discipline)"],
  ];
  const results = [];
  for (const [rel, what] of docs) {
    if (!exists(rel)) {
      results.push({ file: rel, text: `${what}: file missing` });
      continue;
    }
    const text = read(rel);
    for (const stage of required) {
      if (!text.includes(stage)) {
        results.push({ file: rel, text: `${what}: does not mention gate stage "${stage}"` });
      }
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 2. Tool/command surface: docs/tools.md must document every registration,
//    and no doc section may appear twice (drift duplicate)
// ---------------------------------------------------------------------------
check("tools-md-surface", () => {
  const indexSource = read("src/index.ts");
  const registrations = [];
  for (const pattern of [/registerTool\(\{[\s\S]*?name:\s*"([a-z_]+)"/g, /registerCommand\(\s*"([a-z-]+)"/g]) {
    let match;
    for (;;) {
      match = pattern.exec(indexSource);
      if (match === null) break;
      registrations.push(match[1]);
    }
  }
  const doc = read("docs/tools.md");
  const results = [];
  for (const name of registrations) {
    if (!doc.includes(name)) {
      results.push({
        file: "docs/tools.md",
        text: `tool/command "${name}" registered in src/index.ts but absent from docs/tools.md`,
      });
    }
  }
  // duplicate "### <tool>" sections
  const sectionTitles = [...doc.matchAll(/^### ([a-z/-]+)$/gm)].map((m) => m[1]);
  const seen = new Set();
  for (const title of sectionTitles) {
    if (seen.has(title)) {
      results.push({ file: "docs/tools.md", text: `duplicate section "### ${title}" (drift copy)` });
    }
    seen.add(title);
  }
  return results;
});

// ---------------------------------------------------------------------------
// 3. ADR index: every .ad_records/NNN-*.md has an index row; every index row
//    points to an existing file (derived doc aligns with files-of-record)
// ---------------------------------------------------------------------------
check("adr-index-alignment", () => {
  const files = readdirSync(join(ROOT, ".ad_records"))
    .filter((name) => /^\d{3}-.*\.md$/.test(name))
    .sort();
  const index = read(".ad_records/README.md");
  const results = [];
  for (const file of files) {
    const number = file.slice(0, 3);
    const rowExists = new RegExp(`^\\|\\s*${number}\\s*\\|`, "m").test(index);
    if (!rowExists) {
      results.push({ file: `.ad_records/README.md`, text: `ADR ${file} exists but the index has no row for it` });
    }
  }
  for (const row of index.matchAll(/^\| (\d{3}) \|.*\|.*\|\s*$/gm)) {
    const number = row[1];
    if (!files.some((file) => file.startsWith(number))) {
      results.push({
        file: ".ad_records/README.md",
        text: `index row ${number} has no .ad_records/${number}-*.md file`,
      });
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 4. Research five-piece: every .research/<feature>/ must have the required
//    files; the feature table in .research/README.md must list every feature
// ---------------------------------------------------------------------------
check("research-feature-alignment", () => {
  const features = readdirSync(join(ROOT, ".research"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const readme = read(".research/README.md");
  const required = ["notes.md", "result.md", "ship.md"];
  const results = [];
  for (const feature of features) {
    for (const file of required) {
      if (!exists(join(".research", feature, file))) {
        results.push({ file: `.research/${feature}/`, text: `missing ${file} (five-piece research structure)` });
      }
    }
    if (!readme.includes(`](${feature}/)`)) {
      results.push({
        file: ".research/README.md",
        text: `feature "${feature}" directory exists but the feature table has no row`,
      });
    }
  }
  for (const link of readme.matchAll(/\[([^\]]+)\]\(([^)]+\/)\)/g)) {
    const feature = link[2].replace(/\/$/, "");
    if (feature.startsWith("http")) continue;
    if (!features.includes(feature)) {
      results.push({
        file: ".research/README.md",
        text: `feature table links "${feature}" but the directory does not exist`,
      });
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 5. Stop hook watches the dirs that actually hold the gate scripts:
//    every tool script referenced by package.json must live under a
//    verify-evidence CODE_DIR
// ---------------------------------------------------------------------------
check("hook-watchlist-alignment", () => {
  const hook = read(".claude/hooks/verify-evidence.mjs");
  const dirs = [...hook.matchAll(/CODE_DIRS = \[([^\]]+)\]/g)].map((m) =>
    m[1]
      .split(",")
      .map((part) => part.trim().replace(/["']/g, ""))
      .filter((part) => part.length > 0),
  )[0];
  const results = [];
  if (dirs === undefined) {
    results.push({ file: ".claude/hooks/verify-evidence.mjs", text: "CODE_DIRS declaration not found (rename?)" });
    return results;
  }
  const stages = gateStages();
  for (const stage of stages) {
    const script = `tools/${stage}.mjs`;
    if (!exists(script)) continue;
    if (!dirs.includes("tools")) {
      results.push({
        file: ".claude/hooks/verify-evidence.mjs",
        text: `gate script ${script} exists but CODE_DIRS ${JSON.stringify(dirs)} does not watch "tools" (stale watchlist)`,
      });
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 6. State-machine discipline: every XState machine module must be reachable
//    from an entry point (src/index.ts extension entry, tools/*.mjs dev
//    harness) — knip-style reachability, no dead machines.
// ---------------------------------------------------------------------------
const WIRED_MACHINES_FLOOR = 3; // sync, engine-probe, mock-lifecycle; only goes up
check("machines-wired", () => {
  const templateDir = join(ROOT, "src", "templates");
  const machineModules = readdirSync(templateDir)
    .filter((name) => /machine\.ts$/.test(name) || /lifecycle\.ts$/.test(name) || /probe\.ts$/.test(name))
    .map((name) => name.replace(/\.ts$/, ""));

  // Build a module graph over src/ + tools/ and walk from the entry points.
  const modules = new Map(); // rel path (posix, no ext) → source
  const collect = (absDir, prefix) => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const full = join(absDir, entry.name);
      if (entry.isDirectory()) {
        collect(full, `${prefix}/${entry.name}`);
      } else if (/\.(ts|mjs)$/.test(entry.name)) {
        modules.set(`${prefix}/${entry.name.replace(/\.(ts|mjs)$/, "")}`, readFileSync(full, "utf8"));
      }
    }
  };
  collect(join(ROOT, "src"), "src");
  collect(join(ROOT, "tools"), "tools");

  const importsOf = (source) =>
    [...source.matchAll(/from\s+"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((spec) => spec.startsWith("."))
      .map((spec) => spec.replace(/\.ts$/, ""));

  const reachable = new Set();
  const queue = [
    "src/index",
    ...readdirSync(join(ROOT, "tools"))
      .filter((n) => n.endsWith(".mjs"))
      .map((n) => `tools/${n.replace(/\.mjs$/, "")}`),
  ];
  while (queue.length > 0) {
    const current = queue.pop();
    if (reachable.has(current)) continue;
    const source = modules.get(current);
    if (source === undefined) continue;
    reachable.add(current);
    for (const spec of importsOf(source)) {
      // spec like "./mock.ts" or "../src/templates/run.ts" — resolve against
      // the importing module's dir, then normalize the result.
      const parts = current.split("/");
      const dirParts = spec.startsWith("../") ? parts.slice(0, -2) : parts.slice(0, -1);
      const rest = spec.startsWith("../") ? spec.slice(3) : spec.replace(/^\.\//, "");
      const resolved = [...dirParts, ...rest.split("/")].filter((p) => p.length > 0).join("/");
      queue.push(resolved);
    }
  }

  const results = [];
  let wired = 0;
  for (const module of machineModules) {
    const moduleId = `src/templates/${module}`;
    if (reachable.has(moduleId)) {
      wired++;
    } else {
      results.push({
        file: moduleId,
        text: "machine module not reachable from any entry point (src/index.ts or tools/*.mjs) — dead machine",
      });
    }
  }
  if (wired < WIRED_MACHINES_FLOOR) {
    results.push({
      file: "src/templates/",
      text: `wired machines ${wired} below ratchet floor ${WIRED_MACHINES_FLOOR}`,
    });
  }
  return results;
});

// ---------------------------------------------------------------------------
// 7. State-machine rule ↔ README: the discipline must be described in both
//    READMEs' engineering-discipline sections (docs echo the rules)
// ---------------------------------------------------------------------------
check("machine-rule-echoed", () => {
  const results = [];
  for (const rel of ["README.md", "README_EN.md"]) {
    const text = read(rel);
    if (!/状态机|state machine/i.test(text) || !/XState|xstate/.test(text)) {
      results.push({
        file: rel,
        text: "engineering-discipline section does not mention the event-driven state machine rule",
      });
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 8. Skill discipline: every skills/<name>/ directory ships SKILL.md
// ---------------------------------------------------------------------------
check("skill-shape", () => {
  const skillsDir = join(ROOT, ".claude", "skills");
  const results = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !exists(join(".claude", "skills", entry.name, "SKILL.md"))) {
      results.push({ file: `.claude/skills/${entry.name}/`, text: "missing SKILL.md" });
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 9. Hook shape: every hook referenced by settings.json exists on disk
// ---------------------------------------------------------------------------
check("hook-shape", () => {
  const settings = JSON.parse(read(".claude/settings.json"));
  const referenced = [...JSON.stringify(settings.hooks ?? {}).matchAll(/([A-Za-z0-9-]+\.mjs)/g)].map((m) => m[1]);
  const results = [];
  for (const name of referenced) {
    if (!exists(join(".claude", "hooks", name))) {
      results.push({ file: ".claude/settings.json", text: `referenced hook "${name}" missing on disk` });
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 10. Docs drift: CLAUDE.md "当前状态" must enumerate the live tool surface
//     (stale enumeration = broken navigation). Accepts either the full name
//     or the compact "vf_nuclei_new/lint/edit" slash-list form.
// ---------------------------------------------------------------------------
check("claude-md-current", () => {
  const text = read("CLAUDE.md");
  const results = [];
  for (const tool of ["vf_nuclei_edit", "vf_nuclei_stats", "vf_nuclei_sync"]) {
    const short = tool.replace("vf_nuclei_", "");
    const present = text.includes(tool) || new RegExp(`vf_nuclei_[a-z/]*\\b${short}\\b`).test(text);
    if (!present) {
      results.push({ file: "CLAUDE.md", text: `tool "${tool}" missing from the status surface enumeration` });
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 11. Test↔tool alignment: every registered tool name has at least one test
//     that exercises it by name (tests/tools*.test.ts or helper capture)
// ---------------------------------------------------------------------------
check("test-tool-alignment", () => {
  const indexSource = read("src/index.ts");
  const names = [];
  for (const pattern of [/registerTool\(\{[\s\S]*?name:\s*"([a-z_]+)"/g, /registerCommand\(\s*"([a-z-]+)"/g]) {
    let match;
    for (;;) {
      match = pattern.exec(indexSource);
      if (match === null) break;
      names.push(match[1]);
    }
  }
  const testsDir = join(ROOT, "tests");
  const testCorpus = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".test.ts")) {
        testCorpus.push(readFileSync(full, "utf8"));
      }
    }
  };
  walk(testsDir);
  const corpus = testCorpus.join("\n");
  const results = [];
  for (const name of names) {
    if (!corpus.includes(`"${name}"`)) {
      results.push({ file: "tests/", text: `no test exercises tool "${name}" by name` });
    }
  }
  return results;
});

if (findings.length > 0) {
  console.error(`system-lint: ${findings.length} finding(s) across ${checked} checks`);
  for (const finding of findings) {
    console.error(`  [${finding.check}] ${finding.file}: ${finding.text}`);
  }
  console.error("Dev-system assets drifted apart. Fix the derived doc or the source of record.");
  process.exit(1);
}
console.log(`system-lint: all ${checked} checks pass (asset graph consistent)`);
