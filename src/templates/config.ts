import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";

export interface VulnforgeTemplatesConfig {
  db: {
    filename: string;
    sealFile: string;
  };
  tools: {
    nucleiPath: string;
    yamllintPath: string;
  };
}

const DEFAULT_CONFIG: VulnforgeTemplatesConfig = {
  db: {
    filename: "templates.db",
    sealFile: "templates-lock.json",
  },
  tools: {
    nucleiPath: "",
    yamllintPath: "",
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
