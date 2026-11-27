import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export interface VulnforgeTemplatesConfig {
  db: {
    filename: string;
    sealFile: string;
  };
  tools: {
    nucleiPath: string;
    yamllintPath: string;
  };
  sync: {
    /** Subdirectory of the repo root holding the template corpus ("" = root). */
    corpusDir: string;
    /** Directory names included in batch sync (relative to corpusDir; empty = all). */
    includeDirs: string[];
    /** Directory names excluded from batch sync at any depth. */
    excludeDirs: string[];
    /** File names included in batch sync (empty = *.yaml/*.yml default). */
    includeFiles: string[];
    /** File names excluded from batch sync. */
    excludeFiles: string[];
    /** Regex source strings (case-insensitive) matched against relative paths. */
    includePatterns: string[];
    excludePatterns: string[];
  };
  rs: {
    /** Workspace subdirectory holding exploit rs scripts (one per vulnerability). */
    scriptsDir: string;
    /** cargo zigbuild export targets; empty = derive from installed rustup targets. */
    exportTargets: string[];
  };
  oob: {
    /** Provider: interactsh (default) | collaborator | dnslog. */
    provider: "interactsh" | "collaborator" | "dnslog";
    /** Non-secret facts passed through as VF_OOB_* env to exploit scripts. */
    server: string;
    /** Collaborator polling host. */
    pollHost: string;
    /** Dnslog domain. */
    domain: string;
    /** Dnslog poll URL template ({marker} or {host} hole). */
    pollUrl: string;
  };
}

/** Defaults mirror the upstream corpus layout: engine configs and payloads
 * never contain templates. Merge with the config file's sync.* keys. */
export const DEFAULT_SYNC_EXCLUDED_DIRS = [".git", ".github", "node_modules", "profiles", "helpers"];

const DEFAULT_CONFIG: VulnforgeTemplatesConfig = {
  db: {
    filename: "templates.db",
    sealFile: "templates-lock.json",
  },
  tools: {
    nucleiPath: "",
    yamllintPath: "",
  },
  sync: {
    corpusDir: "",
    includeDirs: [],
    excludeDirs: DEFAULT_SYNC_EXCLUDED_DIRS,
    includeFiles: [],
    excludeFiles: [],
    includePatterns: [],
    excludePatterns: [],
  },
  rs: {
    scriptsDir: "rust-scripts",
    exportTargets: [],
  },
  oob: {
    provider: "interactsh",
    server: "",
    pollHost: "",
    domain: "",
    pollUrl: "",
  },
};

export function parseConfig(text: string): VulnforgeTemplatesConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid .vulnforge.json: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid .vulnforge.json: expected an object");
  }
  const config = structuredClone(DEFAULT_CONFIG);
  const db = (parsed as { db?: unknown }).db;
  if (typeof db === "object" && db !== null) {
    const filename = (db as { filename?: unknown }).filename;
    const sealFile = (db as { sealFile?: unknown }).sealFile;
    if (typeof filename === "string" && filename.length > 0) config.db.filename = filename;
    if (typeof sealFile === "string" && sealFile.length > 0) config.db.sealFile = sealFile;
  }
  const tools = (parsed as { tools?: unknown }).tools;
  if (typeof tools === "object" && tools !== null) {
    const nucleiPath = (tools as { nucleiPath?: unknown }).nucleiPath;
    const yamllintPath = (tools as { yamllintPath?: unknown }).yamllintPath;
    if (typeof nucleiPath === "string") config.tools.nucleiPath = nucleiPath;
    if (typeof yamllintPath === "string") config.tools.yamllintPath = yamllintPath;
  }
  const sync = (parsed as { sync?: unknown }).sync;
  if (typeof sync === "object" && sync !== null) {
    // String-list contract via zod at the boundary — no cast.
    const StringList = z.array(z.string()).optional();
    const strList = (value: unknown): string[] | undefined => StringList.parse(value);
    const corpusDir = (sync as { corpusDir?: unknown }).corpusDir;
    if (typeof corpusDir === "string") config.sync.corpusDir = corpusDir;
    const includeDirs = strList((sync as { includeDirs?: unknown }).includeDirs);
    if (includeDirs !== undefined) config.sync.includeDirs = includeDirs;
    const excludeDirs = strList((sync as { excludeDirs?: unknown }).excludeDirs);
    if (excludeDirs !== undefined) config.sync.excludeDirs = excludeDirs;
    const includeFiles = strList((sync as { includeFiles?: unknown }).includeFiles);
    if (includeFiles !== undefined) config.sync.includeFiles = includeFiles;
    const excludeFiles = strList((sync as { excludeFiles?: unknown }).excludeFiles);
    if (excludeFiles !== undefined) config.sync.excludeFiles = excludeFiles;
    const includePatterns = strList((sync as { includePatterns?: unknown }).includePatterns);
    if (includePatterns !== undefined) config.sync.includePatterns = includePatterns;
    const excludePatterns = strList((sync as { excludePatterns?: unknown }).excludePatterns);
    if (excludePatterns !== undefined) config.sync.excludePatterns = excludePatterns;
  }
  // Validate pattern syntax at the boundary — bad regex fails config parse.
  for (const source of [...config.sync.includePatterns, ...config.sync.excludePatterns]) {
    try {
      void new RegExp(source, "i");
    } catch (error) {
      throw new Error(`invalid .vulnforge.json: bad sync pattern /${source}/: ${(error as Error).message}`);
    }
  }
  const rs = (parsed as { rs?: unknown }).rs;
  if (typeof rs === "object" && rs !== null) {
    const scriptsDir = (rs as { scriptsDir?: unknown }).scriptsDir;
    if (scriptsDir !== undefined) {
      if (typeof scriptsDir !== "string" || scriptsDir.length === 0) {
        throw new Error("invalid .vulnforge.json: rs.scriptsDir must be a non-empty string");
      }
      config.rs.scriptsDir = scriptsDir;
    }
    const exportTargets = z
      .array(z.string())
      .optional()
      .parse((rs as { exportTargets?: unknown }).exportTargets);
    if (exportTargets !== undefined) {
      for (const target of exportTargets) {
        if (!/^[a-z0-9_-]+-[a-z0-9_-]+-[a-z0-9_-]+$/.test(target)) {
          throw new Error(`invalid .vulnforge.json: bad rs export target "${target}" (expected a rust triple)`);
        }
      }
      config.rs.exportTargets = exportTargets;
    }
  }
  const oob = (parsed as { oob?: unknown }).oob;
  if (typeof oob === "object" && oob !== null) {
    const provider = (oob as { provider?: unknown }).provider;
    if (provider !== undefined) {
      if (provider !== "interactsh" && provider !== "collaborator" && provider !== "dnslog") {
        throw new Error(`invalid .vulnforge.json: oob.provider must be "interactsh" | "collaborator" | "dnslog"`);
      }
      config.oob.provider = provider;
    }
    for (const key of ["server", "pollHost", "domain", "pollUrl"] as const) {
      const value = (oob as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        throw new Error(`invalid .vulnforge.json: oob.${key} must be a string`);
      }
      config.oob[key] = value;
    }
  }
  return config;
}

/**
 * Walk up from `start` looking for `.vulnforge.json` — nearest wins. Inside
 * git repos the walk is unbounded. Leaving a git repository (a nested corpus
 * clone such as upstream nuclei-templates has its own .git) is allowed once,
 * but only the IMMEDIATE parent chain is then searched: the workspace config
 * is always the direct parent of the corpus git root. Markers further up
 * (home dir, drive root) are treated as planted — a planted config's
 * tools.nucleiPath would be an arbitrary executable.
 */
export function findTemplatesRoot(start: string): string {
  const visited: string[] = [];
  let dir = start;
  let levelsAboveGitRoot = Number.POSITIVE_INFINITY;
  for (;;) {
    if (levelsAboveGitRoot !== Number.POSITIVE_INFINITY && levelsAboveGitRoot > 1) {
      throw new Error(
        [
          `no .vulnforge.json found from ${start} within the enclosing workspace.`,
          `Stopped above the git root at ${dir} — markers further up are not trusted.`,
          "Create .vulnforge.json in the workspace root (the direct parent of the corpus git root).",
        ].join("\n"),
      );
    }
    if (existsSync(join(dir, ".vulnforge.json"))) {
      return dir;
    }
    visited.push(dir);
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        [
          `no .vulnforge.json found from ${start} upward (searched ${visited.length} directory level(s)).`,
          "Create .vulnforge.json in your templates repo root, e.g.:",
          '{ "db": { "filename": "templates.db", "sealFile": "templates-lock.json" } }',
          "or run the tool from a directory inside the workspace that already has one.",
        ].join("\n"),
      );
    }
    if (existsSync(join(dir, ".git")) && !existsSync(join(parent, ".git"))) {
      levelsAboveGitRoot = 1;
    } else if (levelsAboveGitRoot !== Number.POSITIVE_INFINITY) {
      levelsAboveGitRoot += 1;
    }
    dir = parent;
  }
}

export function loadConfig(root: string): VulnforgeTemplatesConfig {
  const marker = join(root, ".vulnforge.json");
  if (!existsSync(marker)) {
    throw new Error(`no .vulnforge.json in ${root}`);
  }
  return parseConfig(readFileSync(marker, "utf8"));
}

export interface TemplatesRepo {
  root: string;
  config: VulnforgeTemplatesConfig;
  dbPath: string;
  sealPath: string;
  /** Workspace dir holding exploit rs scripts (config rs.scriptsDir under root). */
  rsRoot: string;
}

export function openTemplatesRepo(start: string): TemplatesRepo {
  const root = findTemplatesRoot(start);
  const config = loadConfig(root);
  return {
    root,
    config,
    dbPath: join(root, config.db.filename),
    sealPath: join(root, config.db.sealFile),
    rsRoot: join(root, config.rs.scriptsDir),
  };
}
