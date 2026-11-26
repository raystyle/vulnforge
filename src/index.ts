import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DANGEROUS_PATTERNS, isDangerousCommand } from "./safety.ts";
import { openTemplatesRepo, type TemplatesRepo } from "./templates/config.ts";
import { applyContent, applyEdit, EditError, validateEditPatch } from "./templates/edit.ts";
import { checkEnvironment, environmentText, fixCommandsFor, runInstallAction } from "./templates/env.ts";
import type { LintFinding } from "./templates/lint.ts";
import { type MetaColumn, TemplateDb, type TplMetaContract } from "./templates/meta.ts";
import { benignProfile, type MockRoute, mockRoute, startMockTarget } from "./templates/mock.ts";
import {
  checkNuclei,
  createMockScanPort,
  type MockFinding,
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

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    details: { summary: text.slice(0, 200) },
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Engine resolution for vf_nuclei_run: explicit mock wins; otherwise probe
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
  if (!availability.available) {
    throw new Error(
      `nuclei engine unavailable (engine="real" default): ${availability.reason}. Pass engine="mock" with expectedHits for the in-process scan port.`,
    );
  }
  return {
    mode: "real",
    scan: (tplPath, url, options) =>
      runTemplateAgainst(tplPath, url, {
        ...options,
        ...(explicitPath.length > 0 ? { nucleiPath: explicitPath } : {}),
      }),
  };
}

function findingsText(findings: LintFinding[]): string {
  if (findings.length === 0) return "no findings";
  return findings.map((finding) => `[${finding.level}] ${finding.rule}: ${finding.message}`).join("\n");
}

/** Resolve a user-supplied path inside the templates repo, refusing escapes. */
function resolveInsideRepo(repo: TemplatesRepo, userPath: string): string {
  const absolute = resolve(repo.root, userPath);
  const normalizedRoot = repo.root.replaceAll("\\", "/");
  const normalizedAbsolute = absolute.replaceAll("\\", "/");
  if (normalizedAbsolute !== normalizedRoot && !normalizedAbsolute.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`path escapes the templates repo: ${userPath}`);
  }
  return absolute;
}

interface RepoTools {
  repo: TemplatesRepo;
  db: TemplateDb;
}

function openRepoTools(cwd: string): RepoTools {
  const repo = openTemplatesRepo(cwd);
  const db = new TemplateDb(repo.dbPath);
  return { repo, db };
}

export default function (pi: ExtensionAPI): void {
  const vulnTypes = VULN_TYPES;

  pi.registerTool({
    name: "vf_env_check",
    label: "VulnForge env check",
    description:
      "Check that the environment supports nuclei template work: winget, node/fnm, bun, uv, go (GO111MODULE/GOPROXY), rust (rustup/cargo, rsproxy mirror, msvc, zig), nuclei, template repo, yamllint, mock target. Tools under managed roots (e.g. ohmyenv) are listed separately. Returns per-item status with fix guidance. Read-only.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const items = await checkEnvironment(ctx.cwd);
      return textResult(environmentText(items), !items.every((item) => item.ok));
    },
  });

  pi.registerTool({
    name: "vf_env_install",
    label: "VulnForge env install",
    description:
      "Fix one failing env-check item by running its install/config commands (from vf_env_check fix guidance), then re-check and report. Asks for confirmation before running (system-modifying). Names: winget, node, fnm, bun, uv, go, rust, msvc, zig, nuclei.",
    parameters: Type.Object({
      name: Type.String({ description: "Env-check item name to fix, e.g. 'fnm' or 'rust'" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const before = await checkEnvironment(ctx.cwd);
      const commands = fixCommandsFor(before, params.name);
      if (commands === undefined) {
        return textResult(`no fix commands for "${params.name}" — item ok, unknown, or manual-only guidance`, true);
      }
      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          "Env install",
          `About to run for ${params.name}:\n${commands.map((command) => `- ${command}`).join("\n")}\n\nAllow?`,
        );
        if (!ok) return textResult("cancelled by user", true);
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
    },
  });

  pi.registerTool({
    name: "vf_nuclei_lint",
    label: "VulnForge template lint",
    description:
      "Lint a nuclei template: YAML syntax/style (built-in TS yamllint), structure and metadata checks, plus weak-matcher analysis. Pass a path relative to the templates repo root.",
    parameters: Type.Object({
      path: Type.String({ description: "Template path relative to the templates repo root" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return textResult((error as Error).message, true);
      }
      try {
        const absolute = resolveInsideRepo(tools.repo, params.path);
        const source = readFileSync(absolute, "utf8");
        const { lintTemplateFile } = await import("./templates/sync-machine.ts");
        const lint = lintTemplateFile(source, params.path);
        if (lint.error !== undefined) {
          return textResult(`parse failed: ${lint.error}`, true);
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
      } finally {
        tools.db.close();
      }
    },
  });

  pi.registerTool({
    name: "vf_nuclei_edit",
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
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if ((params.patch === undefined) === (params.content === undefined)) {
        return textResult("provide exactly one of patch or content", true);
      }
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return textResult((error as Error).message, true);
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
            return textResult(`edit rejected: ${error.message}`, true);
          }
          throw error;
        }
      } finally {
        tools.db.close();
      }
    },
  });

  pi.registerTool({
    name: "vf_nuclei_run",
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
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (params.target !== undefined && params.engine === "mock") {
        return textResult("engine=mock cannot be combined with a remote target — mock is local-only", true);
      }
      if (params.target !== undefined && params.routes !== undefined) {
        return textResult("provide either target (remote) or routes (local mock), not both", true);
      }
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return textResult((error as Error).message, true);
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
            if (!ok) return textResult("cancelled by user", true);
          } else {
            return textResult(
              "remote target scans require an interactive session (headless runs are refused for safety)",
              true,
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
      } finally {
        tools.db.close();
      }
    },
  });

  pi.registerTool({
    name: "vf_nuclei_sync",
    label: "VulnForge template sync",
    description:
      "Batch-sync template files into the SQLite metadata index via the sync state machine (scan → index per file with lint → seal). Files are the source of truth; the job snapshot (cursor) enables resume after interruption. Returns synced/failed lists, lint aggregates, and the seal record.",
    parameters: Type.Object({
      resumeFrom: Type.Optional(
        Type.Integer({ description: "Skip the first N files (resume a checkpoint from the job snapshot)" }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return textResult((error as Error).message, true);
      }
      try {
        const result = await runBatchSync(tools.db, tools.repo.root, {
          ...(params.resumeFrom !== undefined ? { resumeFrom: params.resumeFrom } : {}),
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
      } finally {
        tools.db.close();
      }
    },
  });

  pi.registerTool({
    name: "vf_nuclei_search",
    label: "VulnForge template search",
    description:
      "Full-text search the template metadata index (bm25 over id/tags/cve/product/name/description) with optional filters.",
    parameters: Type.Object({
      query: Type.String({ description: "FTS query, e.g. 'grafana' or 'cve rce'" }),
      severity: Type.Optional(StringEnum(["info", "low", "medium", "high", "critical"])),
      protocol: Type.Optional(StringEnum(["http", "network", "dns", "ssl", "file", "websocket", "headless"])),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return textResult((error as Error).message, true);
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
      } finally {
        tools.db.close();
      }
    },
  });

  pi.registerTool({
    name: "vf_nuclei_new",
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
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return textResult((error as Error).message, true);
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
      } finally {
        tools.db.close();
      }
    },
  });

  pi.registerTool({
    name: "vf_nuclei_stats",
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
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return textResult((error as Error).message, true);
      }
      try {
        return textResult(renderStats(tools.db, params.dimension as MetaColumn, params.limit ?? 15));
      } finally {
        tools.db.close();
      }
    },
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
