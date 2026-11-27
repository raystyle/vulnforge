import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DANGEROUS_PATTERNS, isDangerousCommand } from "./safety.ts";
import type { TemplatesRepo } from "./templates/config.ts";
import { parseConfig } from "./templates/config.ts";
import { applyContent, applyEdit, EditError, validateEditPatch } from "./templates/edit.ts";
import { probeEngine } from "./templates/engine-probe.ts";
import { checkEnvironment, environmentText, fixCommandsFor, runInstallAction } from "./templates/env.ts";
import type { LintFinding } from "./templates/lint.ts";
import type { MetaColumn, TplMetaContract } from "./templates/meta.ts";
import { benignProfile, type MockRoute, mockRoute, startMockTarget } from "./templates/mock.ts";
import { applyRsEdit, RsEditError, validateRsPatch } from "./templates/rs/edit.ts";
import { runRsScript } from "./templates/rs/executor.ts";
import { runRsExport } from "./templates/rs/export.ts";
import {
  type DeliverFormName,
  type RsExploitType,
  rsSkeletonFor,
  rsTargetDirectory,
  scriptNameFromVulnId,
} from "./templates/rs/scaffold-facade.ts";
import { openRsDb, renderRsSearch, rsExploitFor, rsSearch } from "./templates/rs/search.ts";
import { renderRsStats } from "./templates/rs/stats.ts";
import { runRsSync } from "./templates/rs/sync.ts";
import {
  checkNuclei,
  createMockScanPort,
  type MockFinding,
  type RunOptions,
  runTemplateAgainst,
  type ScanPort,
  verifyNoFalsePositive,
} from "./templates/run.ts";
import {
  type ScaffoldInput,
  skeletonFor,
  targetDirectory,
  templateIdFromName,
  VULN_TYPES,
  type VulnType,
} from "./templates/scaffold.ts";
import { renderStats } from "./templates/stats-report.ts";
import { runBatchSync } from "./templates/sync-machine.ts";
import { withToolMachine } from "./templates/tool-machine.ts";
import {
  envelope,
  errResult,
  openRepoTools,
  type RepoTools,
  resolveInsideRepo,
  textResult,
} from "./templates/tool-registry.ts";

/**
 * Engine resolution for poc_nuclei_run: explicit mock wins; otherwise probe
 * nuclei (config path first, then PATH) and fail with install guidance when
 * absent — never silently fall back to a different engine.
 */
async function resolveScanPortForRun(
  repo: TemplatesRepo,
  engine: "real" | "mock" | undefined,
  expectedHits: readonly string[] | undefined,
): Promise<ScanPort> {
  if (engine === "mock") {
    const findings: MockFinding[] = (expectedHits ?? []).map((templateId) => ({ templateId }));
    return createMockScanPort(findings);
  }
  const explicitPath = repo.config.tools.nucleiPath;
  const availability = await checkNuclei(explicitPath.length > 0 ? { nucleiPath: explicitPath } : {});
  const probe = probeEngine(availability);
  if (probe.phase !== "available") {
    const reason = probe.availability?.reason ?? availability.reason;
    throw new Error(
      `nuclei engine unavailable (engine="real" default, probe=${probe.phase}): ${reason}. Pass engine="mock" with expectedHits for the in-process scan port.`,
    );
  }
  return {
    mode: "real",
    scan: (tplPath, url, options) => {
      // Strip any scanPort from the options — this IS the scan port; passing
      // it through would recurse into itself.
      const rest: RunOptions = { ...options };
      delete (rest as { scanPort?: unknown }).scanPort;
      return runTemplateAgainst(tplPath, url, {
        ...rest,
        ...(explicitPath.length > 0 ? { nucleiPath: explicitPath } : {}),
      });
    },
  };
}

function findingsText(findings: LintFinding[]): string {
  if (findings.length === 0) return "no findings";
  return findings.map((finding) => `[${finding.level}] ${finding.rule}: ${finding.message}`).join("\n");
}

export default function (pi: ExtensionAPI): void {
  const vulnTypes = VULN_TYPES;

  pi.registerTool({
    name: "vf_init",
    label: "VulnForge environment init",
    description:
      "Environment and library entry (idempotent detect / diagnose / repair). Default action=check: per-item status with fix guidance, read-only. action=install + name: fix one failing item after confirmation, then re-check.",
    parameters: Type.Object({
      action: Type.Optional(
        StringEnum(["check", "install", "init"], {
          description:
            "check (default, read-only) or install (confirmed repair of one item) or init (generate .vulnforge.json)",
        }),
      ),
      name: Type.Optional(
        Type.String({ description: "Env item name to repair when action=install, e.g. 'fnm' or 'rust'" }),
      ),
      force: Type.Optional(
        Type.Boolean({
          description:
            "action=init only: overwrite an existing .vulnforge.json (confirm-gated; the old config is backed up to .vulnforge.json.bak)",
        }),
      ),
    }),
    execute: withToolMachine("vf_init", async (_id, params, _signal, _onUpdate, ctx) => {
      const action = (params.action ?? "check") as "check" | "install" | "init";
      if (action === "init") {
        const marker = join(ctx.cwd, ".vulnforge.json");
        if (existsSync(marker) && params.force !== true) {
          return textResult(
            [
              ".vulnforge.json already exists — idempotent no-op.",
              `current: ${marker}`,
              "regenerate with force=true (confirm-gated; backs up the old config to .vulnforge.json.bak).",
            ].join("\n"),
          );
        }
        if (existsSync(marker) && params.force === true) {
          if (!ctx.hasUI) {
            return errResult(
              "CANCELLED",
              "force-overwriting .vulnforge.json requires an interactive confirmation; this session is headless",
              "run from an interactive session, or move the old config manually",
            );
          }
          const ok = await ctx.ui.confirm(
            "Overwrite config",
            `About to overwrite ${marker} (a backup is written to .vulnforge.json.bak first).\n\nAllow?`,
          );
          if (!ok) {
            return errResult(
              "CANCELLED",
              "user declined the overwrite confirmation",
              "retry requires the user to approve; or edit the existing config in place",
            );
          }
          writeFileSync(`${marker}.bak`, readFileSync(marker, "utf8"));
        }
        const skeleton = [
          "{",
          '  "db": { "filename": "templates.db", "sealFile": "templates-lock.json" },',
          '  "tools": { "nucleiPath": "", "yamllintPath": "", "rustScriptPath": "" },',
          '  "sync": { "corpusDir": "" },',
          '  "rs": { "scriptsDir": "rust-scripts", "exportTargets": [] }',
          "}",
        ].join("\n");
        writeFileSync(marker, `${skeleton}\n`);
        // Immediate lint through the parse boundary (regex validity, field
        // types, unknown sections surface here).
        const parsed = parseConfig(skeleton);
        return textResult(
          [
            `scaffolded ${marker} (lint OK: db/tools/sync/rs sections parsed)`,
            `rs.scriptsDir=${parsed.rs.scriptsDir}; rs.exportTargets=${parsed.rs.exportTargets.length} (derive from rustup targets)`,
            "next: point sync.corpusDir at the nuclei-templates checkout, drop exploit rs into rust-scripts/, then run the rs sync.",
          ].join("\n"),
        );
      }
      if (action === "check") {
        const items = await checkEnvironment(ctx.cwd);
        return textResult(environmentText(items), !items.every((item) => item.ok));
      }
      if (params.name === undefined) {
        return errResult(
          "PARAM_CONFLICT",
          "action=install requires the name of the item to repair",
          "pass name from the check output (winget, node, fnm, bun, uv, go, rust, msvc, zig, nuclei)",
        );
      }
      const before = await checkEnvironment(ctx.cwd);
      const commands = fixCommandsFor(before, params.name);
      if (commands === undefined) {
        return errResult(
          "NO_FIX_COMMANDS",
          `no fix commands for item "${params.name}" (ok, unknown, or manual-only)`,
          "run the default check and use one of its item names",
        );
      }
      if (!ctx.hasUI) {
        return errResult(
          "CANCELLED",
          "install requires an interactive confirmation; this session is headless",
          "run from an interactive session, or install manually per the check fix guidance",
        );
      }
      const ok = await ctx.ui.confirm(
        "Env init",
        `About to run for ${params.name}:\n${commands.map((command) => `- ${command}`).join("\n")}\n\nAllow?`,
      );
      if (!ok) {
        return errResult(
          "CANCELLED",
          "user declined the confirmation gate",
          "retry requires the user to approve the confirmation",
        );
      }
      const outcome = await runInstallAction({ name: params.name, commands });
      const after = await checkEnvironment(ctx.cwd);
      const afterItem = after.find((item) => item.name === params.name);
      return textResult(
        [
          `ran: ${outcome.command}`,
          `exit: ${outcome.exitCode}`,
          outcome.output.slice(-1500),
          `re-check: ${params.name} is now ${afterItem?.ok ? "OK" : "STILL FAILING"} (${afterItem?.detail ?? "unknown"})`,
        ].join("\n"),
        outcome.exitCode !== 0,
      );
    }),
  });

  pi.registerTool({
    name: "poc_nuclei_lint",
    label: "VulnForge template lint",
    description:
      "Lint a nuclei template: YAML syntax/style (built-in TS yamllint), structure and metadata checks, plus weak-matcher analysis. Pass a path relative to the templates repo root.",
    parameters: Type.Object({
      path: Type.String({ description: "Template path relative to the templates repo root" }),
    }),
    execute: withToolMachine("poc_nuclei_lint", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const absolute = resolveInsideRepo(tools.repo, params.path);
        const source = readFileSync(absolute, "utf8");
        const { lintTemplateFile } = await import("./templates/sync-machine.ts");
        const lint = lintTemplateFile(source, params.path);
        if (lint.error !== undefined) {
          return errResult("TEMPLATE_INVALID", `yaml parse failed: ${lint.error}`, "fix the yaml syntax, then re-lint");
        }
        const yamlText = lint.yamlFindings
          .map((finding) => `[${finding.level}] ${finding.rule} (line ${finding.line}): ${finding.message}`)
          .join("\n");
        const findings = lint.docFindings;
        const hasError =
          lint.yamlFindings.some((finding) => finding.level === "error") ||
          findings.some((finding) => finding.level === "error");
        return textResult(
          `lint ${params.path}:\n${yamlText.length > 0 ? `${yamlText}\n` : ""}${findingsText(findings)}`,
          hasError,
        );
      } catch (error) {
        return envelope(error);
      } finally {
        tools.db.close();
      }
    }),
  });

  pi.registerTool({
    name: "poc_nuclei_edit",
    label: "VulnForge template edit",
    description:
      "Edit a nuclei template through the contract chain: either a structured patch (info fields, matcher words/regex/part, request paths) or whole-document content. The edit is applied via YAML parse → mutate → re-serialize, then linted; invalid edits are rejected and nothing is written.",
    parameters: Type.Object({
      path: Type.String({ description: "Template path relative to the templates repo root" }),
      patch: Type.Optional(
        Type.Union(
          [
            Type.Object({
              kind: Type.Literal("info"),
              patch: Type.Object({
                name: Type.Optional(Type.String()),
                author: Type.Optional(Type.String()),
                severity: Type.Optional(StringEnum(["info", "low", "medium", "high", "critical"])),
                description: Type.Optional(Type.String()),
                tags: Type.Optional(Type.String()),
                reference: Type.Optional(Type.Array(Type.String())),
              }),
            }),
            Type.Object({
              kind: Type.Literal("matcher"),
              requestIndex: Type.Optional(Type.Integer({ description: "http request index (default 0)" })),
              matcherIndex: Type.Integer({ description: "matcher index within the request" }),
              patch: Type.Object({
                words: Type.Optional(Type.Array(Type.String())),
                regex: Type.Optional(Type.Array(Type.String())),
                part: Type.Optional(Type.String()),
                condition: Type.Optional(Type.String()),
                status: Type.Optional(Type.Array(Type.Integer())),
              }),
            }),
            Type.Object({
              kind: Type.Literal("path"),
              requestIndex: Type.Optional(Type.Integer({ description: "http request index (default 0)" })),
              paths: Type.Array(Type.String(), { description: "full replacement path list" }),
            }),
          ],
          { description: "Structured patch: info fields, matcher fields, or request paths" },
        ),
      ),
      content: Type.Optional(
        Type.String({ description: "Whole-document replacement (validated: yaml + id + name required)" }),
      ),
    }),
    execute: withToolMachine("poc_nuclei_edit", async (_id, params, _signal, _onUpdate, ctx) => {
      if ((params.patch === undefined) === (params.content === undefined)) {
        return errResult(
          "PARAM_CONFLICT",
          "provide exactly one of patch or content — both rules received neither or both",
          'structured edit: {kind:"info"|"matcher"|"path", ...}; whole-document replace: content',
        );
      }
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const absolute = resolveInsideRepo(tools.repo, params.path);
        try {
          const outcome =
            params.content !== undefined
              ? applyContent(absolute, params.path, params.content)
              : applyEdit(absolute, params.path, validateEditPatch(params.patch));
          const findingsTextValue = outcome.lintFindings
            .map((finding) => `[${finding.level}] ${finding.rule}: ${finding.message}`)
            .join("\n");
          return textResult(
            [
              `applied: ${outcome.applied.join(", ")}`,
              `lint: ${outcome.lintErrors} error(s)`,
              findingsTextValue.length > 0 ? findingsTextValue : "no lint findings",
            ].join("\n"),
            outcome.lintErrors > 0,
          );
        } catch (error) {
          if (error instanceof EditError) {
            return errResult(
              "EDIT_REJECTED",
              error.message,
              "adjust the patch indexes or use content mode with a full valid template",
            );
          }
          throw error;
        }
      } finally {
        tools.db.close();
      }
    }),
  });

  pi.registerTool({
    name: "poc_nuclei_run",
    label: "VulnForge template run",
    description:
      "Validate a template against a target. Two target modes: (a) local mock — routes program a 127.0.0.1 target; the benign counter-check runs first (any hit = weak matcher). (b) remote target — pass target=<url> to scan a real host (requires explicit user confirmation; use authorized test environments only). Engine: 'real' nuclei binary (config or PATH), or 'mock' in-process scan port with expectedHits for environments without the binary.",
    parameters: Type.Object({
      path: Type.String({ description: "Template path relative to the templates repo root" }),
      routes: Type.Optional(
        Type.Array(
          Type.Object({
            method: StringEnum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "*"], {
              description: "HTTP method the route answers ('*' matches any)",
            }),
            path: Type.String({ description: "Request path; '*' matches any, 'prefix/*' matches prefixes" }),
            status: Type.Optional(Type.Integer({ description: "Response status (default 200)" })),
            body: Type.Optional(Type.String({ description: "Response body" })),
          }),
          {
            description:
              "Programmed routes for the local mock target (local mode) — validated against the MockRoute contract",
          },
        ),
      ),
      target: Type.Optional(
        Type.String({
          description:
            "Remote target URL (e.g. http://lab-host:8080) — remote mode: scan a real authorized target instead of the local mock; requires user confirmation",
        }),
      ),
      engine: Type.Optional(
        StringEnum(["real", "mock"] as const, {
          description:
            "real: spawn the nuclei binary (config tools.nucleiPath or PATH). mock: in-process scan port seeded with expectedHits — no nuclei binary needed. Remote targets always use real.",
        }),
      ),
      expectedHits: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "mock engine only: template-ids the scan is expected to report (asserts pipeline determinism without a real engine)",
        }),
      ),
    }),
    execute: withToolMachine("poc_nuclei_run", async (_id, params, _signal, _onUpdate, ctx) => {
      if (params.target !== undefined && params.engine === "mock") {
        return errResult(
          "PARAM_CONFLICT",
          "engine=mock cannot be combined with a remote target — the in-process mock answers locally only",
          "drop target for the local mock, or keep target and use the default real engine",
        );
      }
      if (params.target !== undefined && params.routes !== undefined) {
        return errResult(
          "PARAM_CONFLICT",
          "both target and routes provided — they are mutually exclusive scan modes",
          "use routes (local mock) OR target (remote scan), never both",
        );
      }
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const absolute = resolveInsideRepo(tools.repo, params.path);
        const engine = (params.engine ?? "real") as "real" | "mock" | undefined;
        const scanPort = await resolveScanPortForRun(tools.repo, engine, params.expectedHits);

        if (params.target !== undefined) {
          // Remote mode: an authorized real-host scan — confirm before any packet leaves.
          if (ctx.hasUI) {
            const ok = await ctx.ui.confirm(
              "Remote scan",
              `About to run the template against ${params.target} with the real nuclei engine.\n\nOnly proceed against targets you are authorized to test. Allow?`,
            );
            if (!ok)
              return errResult(
                "CANCELLED",
                "user declined the confirmation gate",
                "retry requires the user to approve the confirmation",
              );
          } else {
            return errResult(
              "CANCELLED",
              "remote target scans require an interactive confirmation; this session is headless",
              "run from an interactive session against authorized targets only",
            );
          }
          const result = await runTemplateAgainst(absolute, params.target, { scanPort });
          const hitLines = result.hits.map((hit) => `- ${hit.templateId} at ${hit.matchedAt}`).join("\n");
          return textResult(
            result.hits.length > 0
              ? `remote scan ${params.target}: ${result.hits.length} hit(s)\n${hitLines}`
              : `remote scan ${params.target}: 0 hits`,
            false,
          );
        }

        // Local mode: benign counter-check first — meaningful for the real
        // engine only. The mock scan answers every URL with its seeded
        // findings, so the counter-check would always false-positive there;
        // determinism is asserted against expectedHits instead.
        if (engine !== "mock") {
          const benign = await startMockTarget(benignProfile());
          try {
            const verdict = await verifyNoFalsePositive(absolute, benign.url, { scanPort });
            if (verdict.weakMatcher) {
              return textResult(
                `WEAK MATCHER: template hits the benign target (${verdict.hits
                  .map((hit) => hit.templateId)
                  .join(", ")}). Tighten the matchers before shipping.`,
                true,
              );
            }
          } finally {
            await benign.close();
          }
        }

        const routes: MockRoute[] = (params.routes ?? []).map(mockRoute);
        const target = await startMockTarget(routes);
        try {
          const result = await runTemplateAgainst(absolute, target.url, { scanPort });
          const hitLines = result.hits.map((hit) => `- ${hit.templateId} at ${hit.matchedAt}`).join("\n");
          if (engine === "mock") {
            const expected = params.expectedHits ?? [];
            const got = result.hits.map((hit) => hit.templateId);
            const missing = expected.filter((id) => !got.includes(id));
            const unexpected = got.filter((id) => !expected.includes(id));
            if (missing.length > 0 || unexpected.length > 0) {
              return textResult(
                [
                  "mock engine mismatch:",
                  missing.length > 0 ? `  missing: ${missing.join(", ")}` : "",
                  unexpected.length > 0 ? `  unexpected: ${unexpected.join(", ")}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
                true,
              );
            }
            return textResult(
              `mock engine: ${got.length}/${expected.length} expected hit(s) confirmed — pipeline deterministic`,
            );
          }
          return textResult(
            result.hits.length > 0
              ? `vulnerable profile: ${result.hits.length} hit(s)\n${hitLines}`
              : "vulnerable profile: 0 hits — routes may not match the template paths",
            result.hits.length === 0,
          );
        } finally {
          await target.close();
        }
      } catch (error) {
        return envelope(error);
      } finally {
        tools.db.close();
      }
    }),
  });

  pi.registerTool({
    name: "poc_nuclei_sync",
    label: "VulnForge template sync",
    description:
      "Batch-sync template files into the SQLite metadata index via the sync state machine (scan → index per file with lint → seal). Files are the source of truth; the job snapshot (cursor) enables resume after interruption. Returns synced/failed lists, lint aggregates, and the seal record.",
    parameters: Type.Object({
      resumeFrom: Type.Optional(
        Type.Integer({ description: "Skip the first N files (resume a checkpoint from the job snapshot)" }),
      ),
    }),
    execute: withToolMachine("poc_nuclei_sync", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const { syncFilterFromConfig } = await import("./templates/sync-machine.ts");
        const result = await runBatchSync(tools.db, tools.repo.root, {
          ...(params.resumeFrom !== undefined ? { resumeFrom: params.resumeFrom } : {}),
          filter: syncFilterFromConfig(tools.repo.config),
        });
        const seal = tools.db.seal();
        const lintErrors = result.lintFindings.filter((finding) => finding.errors > 0).length;
        return textResult(
          [
            `synced: ${result.synced.length}`,
            result.failed.length > 0 ? `failed: ${JSON.stringify(result.failed.slice(0, 10))}` : "failed: 0",
            `lint: ${lintErrors} file(s) with errors, ${result.lintFindings.length} checked`,
            `seal: version=${seal.version} sha256=${seal.dbSha256.slice(0, 16)}… count=${seal.templateCount}`,
          ].join("\n"),
          result.failed.length > 0,
        );
      } catch (error) {
        return envelope(error);
      } finally {
        tools.db.close();
      }
    }),
  });

  pi.registerTool({
    name: "poc_nuclei_search",
    label: "VulnForge template search",
    description:
      "Full-text search the template metadata index (bm25 over id/tags/cve/product/name/description) with optional filters.",
    parameters: Type.Object({
      query: Type.String({ description: "FTS query, e.g. 'grafana' or 'cve rce'" }),
      severity: Type.Optional(StringEnum(["info", "low", "medium", "high", "critical"])),
      protocol: Type.Optional(StringEnum(["http", "network", "dns", "ssl", "file", "websocket", "headless"])),
    }),
    execute: withToolMachine("poc_nuclei_search", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const severity = params.severity as "info" | "low" | "medium" | "high" | "critical" | undefined;
        const protocol = params.protocol as
          | "http"
          | "network"
          | "dns"
          | "ssl"
          | "file"
          | "websocket"
          | "headless"
          | undefined;
        const rows = tools.db.search(params.query, {
          ...(severity ? { severity } : {}),
          ...(protocol ? { protocol } : {}),
        });
        if (rows.length === 0) return textResult(`no matches for "${params.query}"`);
        const lines = rows.map(
          (row: TplMetaContract & { snippet: string }) =>
            `- ${row.id} [${row.severity}] ${row.relativePath} :: ${row.snippet.slice(0, 80)}`,
        );
        return textResult(`${rows.length} match(es):\n${lines.join("\n")}`);
      } catch (error) {
        return envelope(error);
      } finally {
        tools.db.close();
      }
    }),
  });

  pi.registerTool({
    name: "poc_nuclei_new",
    label: "VulnForge template new",
    description:
      "Scaffold a new nuclei template skeleton into the templates repo (detect/rce/sqli/lfi/panel) and return its path. Edit the matchers and metadata afterwards.",
    parameters: Type.Object({
      vulnType: StringEnum(vulnTypes as unknown as [VulnType, ...VulnType[]]),
      name: Type.String({ description: 'Template name, e.g. "ACME Panel - RCE" (Vendor Product - Vuln Type)' }),
      author: Type.String({ description: "Author handle(s), comma-separated" }),
      severity: StringEnum(["info", "low", "medium", "high", "critical"]),
      description: Type.String({ description: "One-sentence vulnerability description" }),
      tags: Type.String({ description: "Lowercase comma-separated tags" }),
      cveId: Type.Optional(Type.String({ description: "CVE id like CVE-2026-1234" })),
    }),
    execute: withToolMachine("poc_nuclei_new", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const input: ScaffoldInput = {
          vulnType: params.vulnType as VulnType,
          name: params.name,
          author: params.author,
          severity: params.severity as ScaffoldInput["severity"],
          description: params.description,
          tags: params.tags,
          ...(params.cveId !== undefined ? { cveId: params.cveId } : {}),
        };
        const skeleton = skeletonFor(input);
        const dir = join(tools.repo.root, targetDirectory(input));
        mkdirSync(dir, { recursive: true });
        const fileName = `${templateIdFromName(params.name)}.yaml`;
        const filePath = join(dir, fileName);
        writeFileSync(filePath, skeleton);
        return textResult(`scaffolded ${filePath}\n\n${skeleton}`);
      } catch (error) {
        return envelope(error);
      } finally {
        tools.db.close();
      }
    }),
  });

  pi.registerTool({
    name: "poc_nuclei_stats",
    label: "VulnForge template stats",
    description:
      "Analyze the template metadata index: total and severity overview, group-by any metadata dimension (severity/protocol/tags/cve/author/affected_product/duplicate_key), CVE-year histogram, and duplicate-key report. Read-only; millisecond queries over the sealed db.",
    parameters: Type.Object({
      dimension: StringEnum([
        "severity",
        "protocol",
        "tags",
        "cve",
        "author",
        "affected_product",
        "duplicate_key",
      ] as const),
      limit: Type.Optional(Type.Integer({ description: "Top-N rows per dimension (default 15)" })),
    }),
    execute: withToolMachine("poc_nuclei_stats", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        return textResult(renderStats(tools.db, params.dimension as MetaColumn, params.limit ?? 15));
      } catch (error) {
        return envelope(error);
      } finally {
        tools.db.close();
      }
    }),
  });

  pi.registerTool({
    name: "exploit_rs_search",
    label: "VulnForge exploit search",
    description:
      "Search the exploit rs catalog: FTS over script metadata (bm25: name 10/keywords 8/description 3). With vulnId: resolve the exploit rs for that vulnerability (cross-domain — a nuclei PoC hit maps straight to its exploit). Without a prior rs sync the catalog may be stale.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "FTS query over name/keywords/description" })),
      vulnId: Type.Optional(
        Type.String({
          description:
            "vulnerability identifier (e.g. CVE-2026-1234 or a template id) — cross-domain anchor: the exploit rs for that vulnerability",
        }),
      ),
      dangerous: Type.Optional(Type.Boolean({ description: "filter: only dangerous (true) or safe (false) scripts" })),
    }),
    execute: withToolMachine("exploit_rs_search", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      let rsDb: import("./templates/rs/db.ts").RsDb | undefined;
      try {
        rsDb = openRsDb(tools.repo.root);
        if (params.vulnId !== undefined) {
          const exploitFor = rsExploitFor(rsDb, params.vulnId);
          return textResult(renderRsSearch({ hits: [], exploitFor, engine: "fts" }));
        }
        if (params.query === undefined) {
          return errResult(
            "PARAM_CONFLICT",
            "provide query (FTS search) or vulnId (cross-domain exploit lookup), neither given",
            "query searches script metadata; vulnId resolves the exploit for a vulnerability id",
          );
        }
        const outcome = rsSearch(rsDb, params.query, {
          ...(params.dangerous !== undefined ? { dangerous: params.dangerous } : {}),
        });
        return textResult(renderRsSearch(outcome));
      } catch (error) {
        return envelope(error);
      } finally {
        rsDb?.close();
        tools.db.close();
      }
    }),
  });

  pi.registerTool({
    name: "exploit_rs_new",
    label: "VulnForge exploit rs scaffold",
    description:
      "Generate an exploit rs script skeleton into the workspace rs directory: shebang + //! metadata header + cargo block + the mandatory state-machine template (Check/Probe/Craft/Deliver/Verify with the delivery form), AgentResult-printing main. The script name IS the vulnerability identifier.",
    parameters: Type.Object({
      vulnType: StringEnum(["rce", "sqli", "auth-bypass", "info-disclosure"] as const, {
        description: "Exploit kind (the skeleton's delivery/verify guidance shapes to it)",
      }),
      vulnId: Type.String({
        description: "Vulnerability identifier — becomes the script name (CVE-2026-1234 or a kebab alias)",
      }),
      description: Type.String({ description: "One-line description for the //! header" }),
      deliverForm: Type.Optional(
        StringEnum(["submit", "exec_command", "write_file", "rev_shell"] as const, {
          description: "Delivery form for Machine::with_deliver (default submit)",
        }),
      ),
    }),
    execute: withToolMachine("exploit_rs_new", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const skeleton = rsSkeletonFor({
          vulnType: params.vulnType as RsExploitType,
          vulnId: params.vulnId,
          description: params.description,
          ...(params.deliverForm !== undefined ? { deliverForm: params.deliverForm as DeliverFormName } : {}),
        });
        const dir = join(tools.repo.rsRoot, rsTargetDirectory(params.vulnType as RsExploitType));
        mkdirSync(dir, { recursive: true });
        const fileName = `${scriptNameFromVulnId(params.vulnId)}.rs`;
        const filePath = join(dir, fileName);
        if (existsSync(filePath)) {
          return errResult(
            "PARAM_CONFLICT",
            `script already exists: ${fileName} (one exploit per vulnerability)`,
            "edit the existing script instead (read it first), or choose a different identifier",
          );
        }
        writeFileSync(filePath, skeleton);
        return textResult(`scaffolded ${filePath}\n\n${skeleton}`);
      } catch (error) {
        return envelope(error);
      }
    }),
  });

  pi.registerTool({
    name: "exploit_rs_edit",
    label: "VulnForge exploit rs edit",
    description:
      "Edit an exploit rs script through the contract chain: a metadata patch (//! header lines) or whole-body content. The edit applies only when the result still passes the header contract (the //! name = vulnerability identifier must survive) — invalid edits are rejected and nothing is written.",
    parameters: Type.Object({
      path: Type.String({ description: "Script path relative to the workspace rs directory" }),
      patch: Type.Optional(
        Type.Union(
          [
            Type.Object({
              kind: Type.Literal("metadata"),
              patch: Type.Object({
                description: Type.Optional(Type.String()),
                description_en: Type.Optional(Type.String()),
                version: Type.Optional(Type.String()),
                args: Type.Optional(Type.String()),
                keywords: Type.Optional(Type.String()),
                codes: Type.Optional(Type.String()),
              }),
            }),
            Type.Object({
              kind: Type.Literal("body"),
              content: Type.String({ description: "Whole-file replacement (must keep the //! name header)" }),
            }),
          ],
          { description: "metadata line patch OR whole-body replacement" },
        ),
      ),
    }),
    execute: withToolMachine("exploit_rs_edit", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        if (params.patch === undefined) {
          return errResult(
            "PARAM_CONFLICT",
            "provide a patch (metadata or body)",
            'metadata: {kind:"metadata", patch:{description:"..."}}; body: {kind:"body", content:"..."}',
          );
        }
        const absolute = resolveInsideRepo(tools.repo, join(tools.repo.config.rs.scriptsDir, params.path));
        try {
          const outcome = applyRsEdit(absolute, validateRsPatch(params.patch));
          return textResult(
            [`applied: ${outcome.applied.join(", ")}`, ...outcome.lintIssues].join("\n"),
            outcome.lintIssues.length > 0,
          );
        } catch (error) {
          if (error instanceof RsEditError) {
            return errResult("EDIT_REJECTED", error.message, "fix the patch or use body mode with a full valid script");
          }
          throw error;
        }
      } catch (error) {
        return envelope(error);
      }
    }),
  });

  pi.registerTool({
    name: "exploit_rs_execute",
    label: "VulnForge exploit rs execute",
    description:
      "Execute an exploit rs script: advisory //! lint, spawn rust-script (stream collection, timeout kill backstop, VF_TIMEOUT_SECS passthrough), then the single-line AgentResult contract parse. The full flow runs through the rs-execute domain state machine.",
    parameters: Type.Object({
      path: Type.String({ description: "Script path relative to the workspace rs directory" }),
      args: Type.Optional(Type.Array(Type.String(), { description: "Arguments passed to the script" })),
      timeoutSecs: Type.Optional(
        Type.Integer({ description: "Deadline in seconds (default 300); the process is killed after it" }),
      ),
    }),
    execute: withToolMachine("exploit_rs_execute", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const absolute = resolveInsideRepo(tools.repo, join(tools.repo.config.rs.scriptsDir, params.path));
        const outcome = await runRsScript({
          scriptPath: absolute,
          args: params.args ?? [],
          ...(params.timeoutSecs !== undefined ? { timeoutSecs: params.timeoutSecs } : {}),
        });
        if (outcome.phase === "done" && outcome.result?.success === true) {
          return textResult([`exploit done (${outcome.wallMs}ms)`, JSON.stringify(outcome.result, null, 2)].join("\n"));
        }
        const ctxText =
          outcome.context.lintFindings.length > 0 ? `lint: ${outcome.context.lintFindings.join("; ")}` : "";
        return errResult(
          "INTERNAL",
          `script failed at ${outcome.phase}${outcome.context.reason !== undefined ? `: ${outcome.context.reason}` : ""}${ctxText.length > 0 ? `\n${ctxText}` : ""}`,
          "read the failure detail; fix the script (exploit_rs_edit) or the target state, then retry",
        );
      } catch (error) {
        return envelope(error);
      }
    }),
  });

  pi.registerTool({
    name: "exploit_rs_export",
    label: "VulnForge exploit rs export",
    description:
      "Cross-compile an exploit rs script to standalone binaries via cargo zigbuild (targets incl. musl/windows; the config rs.exportTargets or the installed default set). Artifacts land under the rs export dir with a SHA256SUMS manifest.",
    parameters: Type.Object({
      path: Type.String({ description: "Script path relative to the workspace rs directory" }),
      targets: Type.Optional(
        Type.Array(Type.String(), {
          description: "rust triples to build (default: linux-gnu/musl + windows-msvc)",
        }),
      ),
    }),
    execute: withToolMachine("exploit_rs_export", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const absolute = resolveInsideRepo(tools.repo, join(tools.repo.config.rs.scriptsDir, params.path));
        const scriptName = basename(absolute).replace(/\.rs$/, "");
        const exportDir = join(tools.repo.rsRoot, "export");
        const targets = params.targets ?? tools.repo.config.rs.exportTargets;
        const result = await runRsExport({
          scriptPath: absolute,
          scriptName,
          exportDir,
          ...(targets.length > 0 ? { targets } : {}),
        });
        if (result.exported.length === 0) {
          return errResult(
            "RS_BUILD_FAILED",
            `no artifacts built; failed: ${result.failed.map((f) => f.triple).join(", ")}`,
            "install zig + cargo-zigbuild (vf_init checks) and the rustup targets, then retry",
          );
        }
        const lines = result.exported.map(
          (entry) => `- ${entry.triple}: ${entry.artifact} (sha256 ${entry.sha256.slice(0, 16)}…)`,
        );
        const failedLines = result.failed.map((entry) => `- FAILED ${entry.triple}: ${entry.reason}`);
        return textResult(
          [`exported ${result.exported.length} artifact(s):`, ...lines, ...failedLines].join("\n"),
          result.failed.length > 0,
        );
      } catch (error) {
        return envelope(error);
      }
    }),
  });

  pi.registerTool({
    name: "exploit_rs_sync",
    label: "VulnForge exploit rs sync",
    description:
      "Batch-index exploit rs scripts into the rs catalog (state machine: collect .rs under rs.scriptsDir, //! header contract per file, upsert by vulnerability identifier, seal to rs-lock.json). Idempotent; lint findings aggregate in the result.",
    parameters: Type.Object({}),
    execute: withToolMachine("exploit_rs_sync", async (_id, _params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      try {
        const result = runRsSync(
          tools.repo.root,
          join(tools.repo.root, "rs.db"),
          join(tools.repo.root, "rs-lock.json"),
          { scriptsDir: tools.repo.config.rs.scriptsDir },
        );
        const lintLines = result.lintFindings
          .slice(0, 10)
          .map((f) => `- ${f.path}: ${f.issues.join("; ").slice(0, 120)}`);
        return textResult(
          [
            `synced: ${result.synced}, failed: ${result.failed}`,
            `seal: version=${result.seal.version} sha256=${result.seal.dbSha256.slice(0, 16)}… count=${result.seal.scriptCount}`,
            ...(lintLines.length > 0 ? ["lint findings:", ...lintLines] : []),
          ].join("\n"),
          result.failed > 0,
        );
      } catch (error) {
        return envelope(error);
      }
    }),
  });

  pi.registerTool({
    name: "exploit_rs_stats",
    label: "VulnForge exploit rs stats",
    description:
      "Analyze the exploit rs catalog: overview (total, per-source distribution, dangerous count) or group-by a dimension (source/faces/dangerous/version/keywords). Read-only.",
    parameters: Type.Object({
      dimension: Type.Optional(
        StringEnum(["source", "faces", "dangerous", "version", "keywords"] as const, {
          description: "group-by dimension (omit for the overview)",
        }),
      ),
      limit: Type.Optional(Type.Integer({ description: "Top-N rows per dimension (default 15)" })),
    }),
    execute: withToolMachine("exploit_rs_stats", async (_id, params, _signal, _onUpdate, ctx) => {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return envelope(error);
      }
      let rsDb: import("./templates/rs/db.ts").RsDb | undefined;
      try {
        rsDb = openRsDb(tools.repo.root);
        const text = renderRsStats(rsDb, params.dimension, params.limit ?? 15);
        return textResult(text);
      } catch (error) {
        return envelope(error);
      } finally {
        rsDb?.close();
      }
    }),
  });

  pi.registerCommand("vf", {
    description: "VulnForge status: templates repo, index stats, safety patterns",
    handler: async (_args, ctx) => {
      let status = "templates repo: not found";
      try {
        const tools = openRepoTools(ctx.cwd);
        try {
          const stats = tools.db.stats();
          const severityLine = stats.bySeverity.map((row) => `${row.key}=${row.count}`).join(", ");
          status = `templates repo: ${tools.repo.root}\nindex: total=${stats.total} (${severityLine})`;
        } finally {
          tools.db.close();
        }
      } catch {
        // keep the not-found default
      }
      ctx.ui.notify(
        `${status}\nsafety patterns: ${DANGEROUS_PATTERNS.length}, rm -rf flagged: ${isDangerousCommand("rm -rf /")}`,
        "info",
      );
    },
  });

  pi.registerCommand("vf-debug", {
    description: "Show VulnForge internal state",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `safety patterns: ${DANGEROUS_PATTERNS.length}, isDangerousCommand("rm -rf /"): ${isDangerousCommand("rm -rf /")}`,
        "info",
      );
    },
  });
}
