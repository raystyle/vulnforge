import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
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
  return config;
}

/** Walk up from `start` until a directory containing `.git`, looking for `.vulnforge.json`. */
export function findTemplatesRoot(start: string): string {
  const { root } = parse(start);
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, ".vulnforge.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir || dir === root) {
      throw new Error(`no .vulnforge.json found from ${start} upward (stopped at filesystem root)`);
    }
    if (existsSync(join(parent, ".git"))) {
      throw new Error(`no .vulnforge.json found from ${start} upward (reached enclosing git root)`);
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
}

export function openTemplatesRepo(start: string): TemplatesRepo {
  const root = findTemplatesRoot(start);
  const config = loadConfig(root);
  return {
    root,
    config,
    dbPath: join(root, config.db.filename),
    sealPath: join(root, config.db.sealFile),
  };
}
