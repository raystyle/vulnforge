import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DANGEROUS_PATTERNS, isDangerousCommand } from "./safety.ts";
import { openTemplatesRepo, type TemplatesRepo } from "./templates/config.ts";
import { checkEnvironment, environmentText, fixCommandsFor, runInstallAction } from "./templates/env.ts";
import { type LintFinding, lintDocument, type TemplateInfo } from "./templates/lint.ts";
import {
  parseTemplateFile,
  type SyncResult,
  syncFromFiles,
  TemplateDb,
  type TplMetaContract,
} from "./templates/meta.ts";
import { benignProfile, type MockRoute, startMockTarget } from "./templates/mock.ts";
import { verifyNoFalsePositive } from "./templates/run.ts";
import {
  type ScaffoldInput,
  skeletonFor,
  targetDirectory,
  templateIdFromName,
  VULN_TYPES,
  type VulnType,
} from "./templates/scaffold.ts";

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    details: { summary: text.slice(0, 200) },
    ...(isError ? { isError: true } : {}),
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
      "Lint a nuclei template: structure and metadata checks plus weak-matcher analysis. Pass a path relative to the templates repo root.",
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
        const parsed = parseTemplateFile(absolute);
        if ("parseError" in parsed) {
          return textResult(`parse failed: ${parsed.parseError}`, true);
        }
        const findings = lintDocument(parsed.meta as unknown as TemplateInfo);
        return textResult(
          `lint ${params.path}:\n${findingsText(findings)}`,
          findings.some((f) => f.level === "error"),
        );
      } finally {
        tools.db.close();
      }
    },
  });

  pi.registerTool({
    name: "vf_nuclei_run",
    label: "VulnForge template run",
    description:
      "Validate a template against a local mock target: first the benign counter-check (any hit = weak matcher), then the programmed routes. Pass routes as [{method, path, status, body}]. Local-only: the mock binds 127.0.0.1.",
    parameters: Type.Object({
      path: Type.String({ description: "Template path relative to the templates repo root" }),
      routes: Type.Optional(
        Type.Array(
          Type.Object({
            method: Type.String({ description: "HTTP method, e.g. GET or POST" }),
            path: Type.String({ description: "Request path; '*' matches any, 'prefix/*' matches prefixes" }),
            status: Type.Optional(Type.Integer({ description: "Response status (default 200)" })),
            body: Type.Optional(Type.String({ description: "Response body" })),
          }),
          { description: "Programmed vulnerable routes for the mock target" },
        ),
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
        const absolute = resolveInsideRepo(tools.repo, params.path);
        const benign = await startMockTarget(benignProfile());
        try {
          const verdict = await verifyNoFalsePositive(absolute, benign.url);
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
        const routes: MockRoute[] = params.routes ?? [];
        const target = await startMockTarget(routes);
        try {
          const { runTemplateAgainst } = await import("./templates/run.ts");
          const result = await runTemplateAgainst(absolute, target.url);
          const hitLines = result.hits.map((hit) => `- ${hit.templateId} at ${hit.matchedAt}`).join("\n");
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
      "Incrementally sync template files into the SQLite metadata index (files are the source of truth). Returns synced/failed/removed lists and the new seal record (version + hash for repo bookkeeping; the .db file itself stays out of git).",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      let tools: RepoTools;
      try {
        tools = openRepoTools(ctx.cwd);
      } catch (error) {
        return textResult((error as Error).message, true);
      }
      try {
        const result: SyncResult = await syncFromFiles(tools.db, tools.repo.root);
        const seal = tools.db.seal();
        return textResult(
          [
            `synced: ${result.synced.length}`,
            result.failed.length > 0 ? `failed: ${JSON.stringify(result.failed)}` : "failed: 0",
            result.removed.length > 0 ? `removed: ${result.removed.join(", ")}` : "removed: 0",
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

  pi.registerCommand("vf", {
    description: "VulnForge status: templates repo, index stats, safety patterns",
    handler: async (_args, ctx) => {
      let status = "templates repo: not found";
      try {
        const tools = openRepoTools(ctx.cwd);
        try {
          const stats = tools.db.stats();
          status = `templates repo: ${tools.repo.root}\nindex: ${JSON.stringify(stats)}`;
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
