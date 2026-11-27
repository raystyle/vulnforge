/**
 * Shared tool-surface helpers: the three-line vf-error envelope, path
 * resolution inside the workspace repo, and the repo+db bundle every
 * tool opens. Extracted from src/index.ts so the rs_* tools reuse the
 * identical shapes.
 */
import { join, resolve } from "node:path";
import type { TemplatesRepo } from "./config.ts";
import { resolveLayeredConfig } from "./config.ts";
import { type VfErrorCode, vfError, wrapAsVfError } from "./errors.ts";
import type { TemplateDb } from "./meta.ts";
import { TemplateDb as TemplateDbClass } from "./meta.ts";

export function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    details: { summary: text.slice(0, 200) },
    ...(isError ? { isError: true } : {}),
  };
}

export function errResult(code: VfErrorCode, detail: string, hint: string) {
  return textResult(vfError(code, detail, hint).message, true);
}

/** Wrap a boundary error in the agent-correction envelope with a stable code. */
export function envelope(error: unknown) {
  const wrapped = wrapAsVfError(error, (message) => {
    if (message.includes("no .vulnforge.json")) {
      return {
        code: "CONFIG_NOT_FOUND" as const,
        hint: "create .vulnforge.json in the workspace root or run the tool from inside it",
      };
    }
    if (message.includes("invalid .vulnforge.json")) {
      return { code: "CONFIG_INVALID" as const, hint: "fix the JSON (run vf_env_check for the templates-repo item)" };
    }
    if (message.includes("nuclei engine unavailable")) {
      return {
        code: "ENGINE_UNAVAILABLE" as const,
        hint: 'install nuclei (go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest) or pass engine="mock" with expectedHits',
      };
    }
    if (message.includes("rust-script") && /not found|ENOENT|not recognized/i.test(message)) {
      return {
        code: "ENGINE_UNAVAILABLE" as const,
        hint: "install rust-script (cargo install rust-script) or set tools.rustScriptPath in .vulnforge.json",
      };
    }
    if (message.includes("path escapes")) {
      return {
        code: "PATH_ESCAPE" as const,
        hint: 'pass a path relative to the workspace repo root, e.g. "rust-scripts/CVE-2026-1234.rs"',
      };
    }
    if (/ENOENT|no such file or directory/i.test(message)) {
      return {
        code: "PATH_NOT_FOUND" as const,
        hint: "check the path spelling relative to the workspace repo root, or run nuclei_sync / rs_search to locate indexed files",
      };
    }
    if (message.startsWith("rs script")) {
      return {
        code: "RS_SCRIPT_NOT_FOUND" as VfErrorCode,
        hint: "search first (rs_search) to list available script names, or create it with rs_new",
      };
    }
    if (message.startsWith("AgentResult envelope")) {
      return {
        code: "RS_ENVELOPE_INVALID" as VfErrorCode,
        hint: "the script must print exactly one AgentResult JSON line (success/action/data/error/next_suggestion)",
      };
    }
    if (
      message.startsWith("edit rejected") ||
      message.includes("out of range") ||
      message.includes("no http request block")
    ) {
      return {
        code: "EDIT_REJECTED" as const,
        hint: "adjust the patch indexes or use content mode with a full valid script",
      };
    }
    return {
      code: "INTERNAL" as const,
      hint: "inspect the detail; if it is a bug, report it with the exact tool call",
    };
  });
  return textResult(wrapped.message, true);
}

/** Resolve a user-supplied template path against the CORPUS root (config
 * sync.corpusDir; "" = repo root), refusing escapes beyond the repo root.
 * Search results' relative_path and lint/edit inputs share this base — one
 * basis for both faces (the workbench acceptance found the divergence). */
export function resolveInsideRepo(repo: TemplatesRepo, userPath: string): string {
  const absolute = resolve(repo.corpusRoot, userPath);
  const normalizedRoot = repo.root.replaceAll("\\", "/");
  const normalizedAbsolute = absolute.replaceAll("\\", "/");
  if (normalizedAbsolute !== normalizedRoot && !normalizedAbsolute.startsWith(`${normalizedRoot}/`)) {
    throw vfError(
      "PATH_ESCAPE",
      `path "${userPath}" escapes the templates repo root ${normalizedRoot} (resolved to ${normalizedAbsolute})`,
      'pass a path relative to the corpus root (as search returns), e.g. "http/cves/2026/CVE-2026-0545.yaml"',
    );
  }
  return absolute;
}

export interface RepoTools {
  repo: TemplatesRepo;
  db: TemplateDb;
}

/** Open the workspace repo, falling back to the pi data dir global config
 * when no workspace marker exists (config layering: workspace > global).
 * The global layer makes read tools (search/stats) usable from any cwd;
 * write tools stay workspace-scoped by the same repo-root path guard. */
export function openRepoTools(cwd: string): RepoTools {
  const resolved = resolveLayeredConfig(cwd);
  const repo: TemplatesRepo = {
    root: resolved.root,
    config: resolved.config,
    dbPath: join(resolved.root, resolved.config.db.filename),
    sealPath: join(resolved.root, resolved.config.db.sealFile),
    rsRoot: join(resolved.root, resolved.config.rs.scriptsDir),
    corpusRoot: join(resolved.root, resolved.config.sync.corpusDir.length > 0 ? resolved.config.sync.corpusDir : "."),
  };
  const db = new TemplateDbClass(repo.dbPath);
  return { repo, db };
}
