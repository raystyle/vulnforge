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
// 3b. Bidirectional asset links (user ruling: global lint enforced on the
//     asset graph, both directions). An asset that references another must
//     resolve, and the referenced asset's index must point back; a status
//     stated in two places must agree.
// ---------------------------------------------------------------------------

// Memory files <-> MEMORY.md index: every memory file has an index line,
// every index line resolves to a file.
check("memory-index-alignment", () => {
  const results = [];
  if (!exists(".claude/memory")) return results;
  const memoryFiles = readdirSync(join(ROOT, ".claude/memory"))
    .filter((name) => name.endsWith(".md") && name !== "MEMORY.md")
    .sort();
  const index = exists(".claude/memory/MEMORY.md") ? read(".claude/memory/MEMORY.md") : "";
  for (const file of memoryFiles) {
    if (!index.includes(`](${file})`)) {
      results.push({
        file: ".claude/memory/MEMORY.md",
        text: `memory file ${file} exists but the index has no row for it`,
      });
    }
  }
  for (const link of index.matchAll(/\]\(([^)]+\.md)\)/g)) {
    const target = link[1];
    if (!memoryFiles.includes(target)) {
      results.push({
        file: ".claude/memory/MEMORY.md",
        text: `index line links "${target}" but the memory file does not exist`,
      });
    }
  }
  return results;
});

// .claude asset dirs <-> .claude/README.md asset table: every shipped asset
// (rule/skill/hook/agent) is registered; every registered asset exists.
check("claude-assets-alignment", () => {
  const results = [];
  const readme = read(".claude/README.md");
  const registrations = {
    rules: readdirSync(join(ROOT, ".claude", "rules")).filter((name) => name.endsWith(".md")),
    skills: readdirSync(join(ROOT, ".claude", "skills")),
    hooks: readdirSync(join(ROOT, ".claude", "hooks")).filter((name) => name.endsWith(".mjs")),
    agents: readdirSync(join(ROOT, ".claude", "agents")).filter((name) => name.endsWith(".md")),
  };
  for (const [kind, names] of Object.entries(registrations)) {
    for (const name of names) {
      // The README table lists asset names inline (e.g. `pi-extension.md`,
      // `precedent/`, `guard-dangerous.mjs`). Skills register by directory.
      const token = kind === "skills" ? `${name}/` : name;
      if (!readme.includes(token)) {
        results.push({
          file: ".claude/README.md",
          text: `${kind} asset "${name}" exists but is not registered in the asset table`,
        });
      }
    }
  }
  // Reverse: backtick-quoted .md/.mjs tokens in the rules/hooks/agents rows
  // must resolve to files (skills resolve as directories).
  for (const token of readme.matchAll(/`([A-Za-z0-9._-]+\.(?:md|mjs))`/g)) {
    const name = token[1];
    for (const dir of ["rules", "hooks", "agents"]) {
      if (readme.includes(`${dir}`) && exists(join(".claude", dir, name))) break;
      if (
        (name.endsWith(".md") && exists(join(".claude", "rules", name))) ||
        (name.endsWith(".mjs") && exists(join(".claude", "hooks", name))) ||
        (name.endsWith(".md") && exists(join(".claude", "agents", name)))
      ) {
        break;
      }
    }
  }
  return results;
});

// ADR in-file status <-> index-row status: the same decision stated in two
// places must agree (实施中/已完成/提案中/已废弃).
check("adr-status-alignment", () => {
  const results = [];
  const files = readdirSync(join(ROOT, ".ad_records"))
    .filter((name) => /^\d{3}-.*\.md$/.test(name))
    .sort();
  const index = read(".ad_records/README.md");
  const statuses = ["提案中", "实施中", "已完成", "已废弃"];
  for (const file of files) {
    const number = file.slice(0, 3);
    const body = read(join(".ad_records", file));
    const inFile = statuses.find((status) => new RegExp(`^- 状态：${status}$`, "m").test(body));
    const row = index.match(new RegExp(`^\\|\\s*${number}\\s*\\|[^|]*\\|[^|]*\\|\\s*([^|]*?)\\s*\\|`, "m"));
    const inIndex = row ? statuses.find((status) => row[1].trim() === status) : undefined;
    if (inFile === undefined) continue; // non-standard body status: not this check's beat
    if (inIndex !== undefined && inIndex !== inFile) {
      results.push({
        file: ".ad_records/README.md",
        text: `ADR ${number} body says "${inFile}" but the index row says "${inIndex}"`,
      });
    }
  }
  return results;
});

// Research feature status <-> ship.md existence: a shipped feature (ship.md
// present) must not sit in a non-terminal status row (研究中/进行中).
check("research-status-alignment", () => {
  const results = [];
  const readme = read(".research/README.md");
  const features = readdirSync(join(ROOT, ".research"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const feature of features) {
    if (!exists(join(".research", feature, "ship.md"))) continue;
    const row = readme.match(new RegExp(`^\\|\\s*\\[${feature}\\]\\([^)]*\\)\\s*\\|\\s*([^|]*?)\\s*\\|`, "m"));
    if (row && /(研究中|进行中)/.test(row[1])) {
      results.push({
        file: ".research/README.md",
        text: `feature "${feature}" has ship.md (closed) but the status row still says "${row[1].trim()}"`,
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
  const templateDir = join(ROOT, "src", "nuclei");
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
      // spec like "./mock.ts" or "../src/nuclei/run.ts" — resolve against
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
    const moduleId = `src/nuclei/${module}`;
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
      file: "src/nuclei/",
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
  for (const tool of ["nuclei_edit", "nuclei_stats", "nuclei_sync"]) {
    const short = tool.replace(/^nuclei_/, "").replace(/^rs_/, "");
    const present = text.includes(tool) || new RegExp(`nuclei_[a-z/]*\\b${short}\\b`).test(text);
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

// ---------------------------------------------------------------------------
// 12. Controlled-language terminology (docs-style.md): forbidden synonyms for
//     fixed terms. "机器" referring to the XState concept is the top violation.
//     Scope: README/README_EN, docs/, .ad_records/, .research/, .claude/ md files.
//     "机器" is allowed only for physical machines (跨机器/新机器/机器本身).
// ---------------------------------------------------------------------------
const TERM_RULES = [
  // [forbidden pattern, why, allow-if context matches this exception]
  { pattern: /机器(?!人)/, term: "状态机", exception: /(跨机器|新机器|本机器|机器本身|peer 机器|物理机器)/ },
];
const TERM_SCOPE_DIRS = ["docs", ".ad_records", ".research", ".claude", "."];
function* markdownFiles(dirRel) {
  const abs = dirRel === "." ? ROOT : join(ROOT, dirRel);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.name.startsWith(".") &&
      dirRel === "." &&
      entry.name !== ".ad_records" &&
      entry.name !== ".research" &&
      entry.name !== ".claude"
    )
      continue;
    if (
      entry.name === "node_modules" ||
      entry.name === "worktrees" ||
      entry.name === "plans" ||
      entry.name === "memory" ||
      entry.name === "agents"
    )
      continue;
    if (entry.name === "docs-style.md") continue; // the rule itself quotes forbidden terms
    const rel = dirRel === "." ? entry.name : `${dirRel}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* markdownFiles(rel);
    } else if (
      dirRel === "."
        ? ["README.md", "README_EN.md", "CLAUDE.md", "CHANGELOG.md"].includes(entry.name)
        : entry.name.endsWith(".md")
    ) {
      yield rel;
    }
  }
}
check("docs-terminology", () => {
  const results = [];
  const seen = new Set();
  for (const dir of TERM_SCOPE_DIRS) {
    for (const rel of markdownFiles(dir)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      let text;
      try {
        text = read(rel);
      } catch {
        continue;
      }
      for (const rule of TERM_RULES) {
        for (const match of text.matchAll(new RegExp(rule.pattern.source, "g"))) {
          const line = text.slice(0, match.index).split("\n").length;
          const context = text.slice(Math.max(0, match.index - 12), match.index + 12);
          if (rule.exception?.test(context)) continue;
          results.push({
            file: rel,
            text: `line ${line}: "机器" must be "状态机" when referring to the XState concept (docs-style.md term table) — context: ${context.trim()}`,
          });
        }
      }
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 13. Chinese sentence length: prose sentences ≤60 chars in scoped docs
//     (table rows, code, paths, frontmatter exempt)
// ---------------------------------------------------------------------------
check("docs-sentence-length", () => {
  const results = [];
  const seen = new Set();
  for (const dir of TERM_SCOPE_DIRS) {
    for (const rel of markdownFiles(dir)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      let text;
      try {
        text = read(rel);
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("|") || line.startsWith("#") || line.startsWith("```") || line.startsWith("  ")) continue;
        if (!/[一-鿿]/.test(line)) continue;
        // split on 。；！？ and measure each sentence's han char count
        for (const sentence of line.split(/(?<=[。；！？])/)) {
          const hanCount = (sentence.match(/[一-鿿]/g) ?? []).length;
          if (hanCount > 60) {
            results.push({ file: rel, text: `line ${i + 1}: sentence exceeds 60 han chars (${hanCount}) — split it` });
          }
        }
      }
    }
  }
  return results;
});

// ---------------------------------------------------------------------------
// 14. Code naming shapes (docs-style.md naming table): tools, commands,
//     machines, guards registered in src must follow the fixed forms.
// ---------------------------------------------------------------------------
check("code-naming", () => {
  const indexSource = read("src/index.ts");
  const results = [];
  for (const match of indexSource.matchAll(/registerTool\(\{[\s\S]*?name:\s*"([^"]+)"/g)) {
    // Naming form (user ruling): env keeps the vf_ prefix (vf_init); domain
    // Three-segment form (user ruling): nuclei_<action> / rs_<action>; env keeps vf_(init|reload).
    if (!/^(vf_init|vf_reload|nuclei_[a-z]+|rs_[a-z]+)$/.test(match[1])) {
      results.push({
        file: "src/index.ts",
        text: `tool "${match[1]}" breaks the nuclei_<action> / rs_<action> (or vf_(init|reload)) naming form`,
      });
    }
  }
  for (const match of indexSource.matchAll(/registerCommand\(\s*"([^"]+)"/g)) {
    if (!/^vf(-[a-z-]+)?$/.test(match[1])) {
      results.push({ file: "src/index.ts", text: `command "${match[1]}" breaks the /vf[-<name>] naming form` });
    }
  }
  for (const entry of readdirSync(join(ROOT, "src", "nuclei"))) {
    if (entry.endsWith(".ts")) {
      const source = readFileSync(join(ROOT, "src", "nuclei", entry), "utf8");
      for (const match of source.matchAll(/export const (\w+) = setup\(/g)) {
        if (!/Machine$/.test(match[1])) {
          results.push({
            file: `src/nuclei/${entry}`,
            text: `machine export "${match[1]}" lacks the Machine suffix`,
          });
        }
      }
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
