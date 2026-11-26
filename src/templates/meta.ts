import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { parse } from "yaml";
import { z } from "zod";

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

/** Upstream StringSlice: YAML accepts a bare string or a list — normalize to string[]. */
const StringSlice = z.union([z.string(), z.array(z.string())]).transform((value) =>
  Array.isArray(value)
    ? value.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
);

export const CveIdSchema = z.string().regex(/^CVE-\d{4}-\d{4,}$/, "cve-id must look like CVE-2026-1234");

export const CweIdSchema = z.string().regex(/^CWE-\d+$/, "cwe-id must look like CWE-89");

/** All upstream protocol blocks (pkg/templates/templates.go), including deprecated aliases. */
export const ProtocolSchema = z.enum([
  "http",
  "dns",
  "file",
  "network",
  "tcp",
  "headless",
  "ssl",
  "websocket",
  "whois",
  "code",
  "javascript",
  "workflows",
  "requests",
]);
export type Protocol = Exclude<z.infer<typeof ProtocolSchema>, "requests" | "tcp"> | "http";

const ClassificationSchema = z
  .object({
    "cve-id": StringSlice.optional(),
    "cwe-id": StringSlice.optional(),
    "cvss-metrics": z.string().optional(),
    "cvss-score": z.number().min(0).max(10).optional(),
    "epss-score": z.number().min(0).max(1).optional(),
    "epss-percentile": z.number().min(0).max(1).optional(),
    cpe: z.string().optional(),
  })
  .optional();

const TagsSchema = StringSlice.optional().default([]);

const ReferenceSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .default([]);

export const TemplateInfoSchema = z.object({
  name: z
    .string()
    .min(1)
    .refine((value) => value === value.trim(), "name must not have leading/trailing spaces"),
  author: StringSlice,
  severity: SeveritySchema,
  description: z.string().min(1),
  impact: z.string().optional(),
  remediation: z.string().optional(),
  tags: TagsSchema,
  reference: ReferenceSchema,
  classification: ClassificationSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Upstream id pattern (loose); repo naming discipline lives in lint, not parse. */
export const TemplateDocSchema = z.object({
  id: z
    .string()
    .regex(/^([a-zA-Z0-9]+[-_])*[a-zA-Z0-9]+$/, "id must match the upstream nuclei id pattern")
    .brand<"TemplateId">(),
  info: TemplateInfoSchema,
});

/** Detect the protocol of a raw template document by which protocol block it carries. */
export function detectProtocol(raw: Record<string, unknown>): Protocol {
  const preferred: Array<{ keys: string[]; protocol: Protocol }> = [
    { keys: ["http", "requests"], protocol: "http" },
    { keys: ["dns"], protocol: "dns" },
    { keys: ["file"], protocol: "file" },
    { keys: ["network", "tcp"], protocol: "network" },
    { keys: ["headless"], protocol: "headless" },
    { keys: ["ssl"], protocol: "ssl" },
    { keys: ["websocket"], protocol: "websocket" },
    { keys: ["whois"], protocol: "whois" },
    { keys: ["code"], protocol: "code" },
    { keys: ["javascript"], protocol: "javascript" },
    { keys: ["workflows"], protocol: "workflows" },
  ];
  for (const candidate of preferred) {
    if (candidate.keys.some((key) => key in raw)) return candidate.protocol;
  }
  return "http";
}

export type TemplateDoc = z.infer<typeof TemplateDocSchema>;
export type TemplateId = z.infer<typeof TemplateDocSchema>["id"];

const TemplateIdPlainSchema = TemplateDocSchema.shape.id;

/** Runtime-checked constructor: plain string → branded TemplateId. */
export function templateId(raw: string): TemplateId {
  // zod parse validates; the brand tag itself only exists at the type level.
  return TemplateIdPlainSchema.parse(raw) as TemplateId; // brand-allow: constructor exit
}

const SeverityDecode = SeveritySchema.catch("info");
const StorageProtocolSchema = z
  .enum(["http", "dns", "file", "network", "headless", "ssl", "websocket", "whois", "code", "javascript", "workflows"])
  .catch("http");
type StorageProtocol = z.infer<typeof StorageProtocolSchema>;

export const tplMeta = sqliteTable(
  "tpl_meta",
  {
    rowid: integer("rowid").primaryKey(),
    id: text("id").notNull(),
    name: text("name").notNull().default(""),
    author: text("author").notNull().default(""),
    severity: text("severity").notNull().default("info"),
    description: text("description").notNull().default(""),
    tags: text("tags").notNull().default(""),
    cve: text("cve").notNull().default(""),
    cwe: text("cwe").notNull().default(""),
    protocol: text("protocol").notNull().default("http"),
    affectedProduct: text("affected_product").notNull().default(""),
    relativePath: text("relative_path").notNull().default(""),
    duplicateKey: text("duplicate_key").notNull().default(""),
    identityProduct: text("identity_product").notNull().default(""),
    identityVulnClass: text("identity_vuln_class").notNull().default(""),
    identitySurface: text("identity_surface").notNull().default(""),
    identityEntryPoints: text("identity_entry_points").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(""),
  },
  (table) => [
    index("idx_tpl_severity").on(table.severity),
    index("idx_tpl_cve").on(table.cve),
    index("idx_tpl_protocol").on(table.protocol),
    index("idx_tpl_duplicate_key").on(table.duplicateKey),
  ],
);

export type TplMetaRow = typeof tplMeta.$inferSelect;
export type TplMetaInsert = typeof tplMeta.$inferInsert;

export interface SealRecord {
  version: number;
  dbSha256: string;
  templateCount: number;
  sealedAt: string;
}

const DDL = `
CREATE TABLE IF NOT EXISTS tpl_meta (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'info',
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  cve TEXT NOT NULL DEFAULT '',
  cwe TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL DEFAULT 'http',
  affected_product TEXT NOT NULL DEFAULT '',
  relative_path TEXT NOT NULL DEFAULT '',
  duplicate_key TEXT NOT NULL DEFAULT '',
  identity_product TEXT NOT NULL DEFAULT '',
  identity_vuln_class TEXT NOT NULL DEFAULT '',
  identity_surface TEXT NOT NULL DEFAULT '',
  identity_entry_points TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tpl_severity ON tpl_meta(severity);
CREATE INDEX IF NOT EXISTS idx_tpl_cve ON tpl_meta(cve);
CREATE INDEX IF NOT EXISTS idx_tpl_protocol ON tpl_meta(protocol);
CREATE INDEX IF NOT EXISTS idx_tpl_duplicate_key ON tpl_meta(duplicate_key);
CREATE VIRTUAL TABLE IF NOT EXISTS tpl_fts USING fts5(
  id, tags, cve, affected_product, name, description,
  tokenize='unicode61'
);
`;

const _PROTOCOL_KEYS: readonly string[] = ProtocolSchema.options;

/** Contract row: storage row re-typed through the parse boundary. */
export interface TplMetaContract {
  rowid: number;
  id: TemplateId;
  name: string;
  author: string;
  severity: Severity;
  description: string;
  tags: string;
  cve: string;
  cwe: string;
  protocol: StorageProtocol;
  affectedProduct: string;
  relativePath: string;
  duplicateKey: string;
  identityProduct: string;
  identityVulnClass: string;
  identitySurface: string;
  identityEntryPoints: string;
  updatedAt: string;
}

/** Typed row decoder — no String() coercion; contract fields map 1:1 to storage. */
function decodeTplRow(row: Record<string, unknown>): TplMetaContract {
  const text = (key: string): string => {
    const value = row[key];
    return typeof value === "string" ? value : "";
  };
  const severity = SeverityDecode.parse(text("severity"));
  const protocol = StorageProtocolSchema.parse(text("protocol"));
  return {
    rowid: typeof row.rowid === "number" ? row.rowid : Number(row.rowid ?? 0),
    id: templateId(text("id")),
    name: text("name"),
    author: text("author"),
    severity,
    description: text("description"),
    tags: text("tags"),
    cve: text("cve"),
    cwe: text("cwe"),
    protocol,
    affectedProduct: text("affected_product"),
    relativePath: text("relative_path"),
    duplicateKey: text("duplicate_key"),
    identityProduct: text("identity_product"),
    identityVulnClass: text("identity_vuln_class"),
    identitySurface: text("identity_surface"),
    identityEntryPoints: text("identity_entry_points"),
    updatedAt: text("updated_at"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function parseTemplateFile(path: string): { meta: Omit<TplMetaContract, "rowid"> } | { parseError: string } {
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { parseError: `YAML parse failed: ${(error as Error).message}` };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { parseError: "template file is not a YAML mapping" };
  }
  const parsed = TemplateDocSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
    return { parseError: `schema validation failed: ${issues}` };
  }
  const doc = parsed.data;
  const classification = doc.info.classification ?? {};
  const record = isRecord(raw) ? raw : {};
  const protocol = detectProtocol(record);
  const cves = classification["cve-id"] ?? [];
  const cwes = classification["cwe-id"] ?? [];
  const cve = cves.join(",");
  const affectedProductRaw = doc.info.metadata?.affected_product;
  const affectedProduct = typeof affectedProductRaw === "string" ? affectedProductRaw : "";
  return {
    meta: {
      id: doc.id,
      name: doc.info.name,
      author: doc.info.author.join(","),
      severity: doc.info.severity,
      description: doc.info.description,
      tags: doc.info.tags.join(","),
      cve,
      cwe: cwes.join(","),
      protocol,
      affectedProduct,
      relativePath: "",
      duplicateKey: cve || doc.info.name.toLowerCase(),
      identityProduct: affectedProduct,
      identityVulnClass: doc.info.tags.join(","),
      identitySurface: protocol,
      identityEntryPoints: "",
      updatedAt: new Date().toISOString(),
    },
  };
}

export class TemplateDb {
  private readonly client: DatabaseSync;
  private readonly dbPath: string;
  private readonly db;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.client = new DatabaseSync(dbPath);
    this.client.exec("PRAGMA journal_mode=WAL");
    this.client.exec(DDL);
    this.db = drizzle((sqlText, params, method) => {
      const statement = this.client.prepare(sqlText);
      if (method === "run") {
        statement.run(...params);
        return Promise.resolve({ rows: [] });
      }
      if (method === "get") {
        const row = statement.get(...params);
        return Promise.resolve({ rows: row === undefined ? [] : [row] });
      }
      return Promise.resolve({ rows: statement.all(...params) as unknown[] });
    });
  }

  close(): void {
    this.client.close();
  }

  async upsert(meta: Omit<TplMetaContract, "rowid">, relativePath: string): Promise<void> {
    const full = { ...meta, relativePath };
    this.client.exec("BEGIN");
    try {
      await this.db
        .insert(tplMeta)
        .values(full)
        .onConflictDoUpdate({
          target: tplMeta.id,
          set: {
            name: full.name,
            author: full.author,
            severity: full.severity,
            description: full.description,
            tags: full.tags,
            cve: full.cve,
            cwe: full.cwe,
            protocol: full.protocol,
            affectedProduct: full.affectedProduct,
            relativePath: full.relativePath,
            duplicateKey: full.duplicateKey,
            identityProduct: full.identityProduct,
            identityVulnClass: full.identityVulnClass,
            identitySurface: full.identitySurface,
            identityEntryPoints: full.identityEntryPoints,
            updatedAt: full.updatedAt,
          },
        });
      this.client.prepare("DELETE FROM tpl_fts WHERE rowid = (SELECT rowid FROM tpl_meta WHERE id = ?)").run(full.id);
      const row = this.client.prepare("SELECT rowid FROM tpl_meta WHERE id = ?").get(full.id) as
        | { rowid: number }
        | undefined;
      if (row === undefined) throw new Error(`upsert lost row for ${full.id}`);
      this.client
        .prepare(
          "INSERT INTO tpl_fts (rowid, id, tags, cve, affected_product, name, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(row.rowid, full.id, full.tags, full.cve, full.affectedProduct, full.name, full.description);
      this.client.exec("COMMIT");
    } catch (error) {
      this.client.exec("ROLLBACK");
      throw error;
    }
  }

  count(): number {
    return (this.client.prepare("SELECT COUNT(*) AS n FROM tpl_meta").get() as { n: number }).n;
  }

  search(
    query: string,
    filters: { severity?: Severity; cve?: string; protocol?: Protocol } = {},
  ): Array<TplMetaContract & { snippet: string }> {
    const conditions: string[] = [];
    const params: string[] = [];
    if (query.length > 0) {
      conditions.push("m.rowid IN (SELECT rowid FROM tpl_fts WHERE tpl_fts MATCH ?)");
      params.push(query);
    }
    if (filters.severity) {
      conditions.push("m.severity = ?");
      params.push(filters.severity);
    }
    if (filters.cve) {
      conditions.push("m.cve = ?");
      params.push(filters.cve);
    }
    if (filters.protocol) {
      conditions.push("m.protocol = ?");
      params.push(filters.protocol);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const statement = this.client.prepare(
      `SELECT m.*, snippet(tpl_fts, 5, '[', ']', '...', 12) AS snippet,
         bm25(tpl_fts, 10.0, 8.0, 6.0, 5.0, 3.0, 1.0) AS rank
       FROM tpl_meta m JOIN tpl_fts ON m.rowid = tpl_fts.rowid
       ${where}
       ORDER BY rank
       LIMIT 50`,
    );
    const rows = statement.all(...params);
    return rows
      .filter(isRecord)
      .map((row) => ({ ...decodeTplRow(row), snippet: typeof row.snippet === "string" ? row.snippet : "" }));
  }

  findDuplicates(): Array<{ duplicateKey: string; ids: string[] }> {
    const rows = this.client
      .prepare(
        "SELECT duplicate_key, GROUP_CONCAT(id) AS ids FROM tpl_meta WHERE duplicate_key != '' GROUP BY duplicate_key HAVING COUNT(*) > 1",
      )
      .all() as Array<{ duplicate_key: string; ids: string }>;
    return rows.map((row) => ({ duplicateKey: row.duplicate_key, ids: row.ids.split(",") }));
  }

  seal(): SealRecord {
    this.client.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return {
      version: 1,
      dbSha256: sha256File(this.dbPath),
      templateCount: this.count(),
      sealedAt: new Date().toISOString(),
    };
  }

  verifySeal(record: SealRecord): { ok: boolean; reason?: string } {
    if (!existsSync(this.dbPath)) {
      return { ok: false, reason: "db file missing — run vf_template_sync to rebuild incrementally" };
    }
    this.client.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const actual = sha256File(this.dbPath);
    if (actual !== record.dbSha256) {
      return { ok: false, reason: "db hash differs from seal record (incremental drift or tampering)" };
    }
    return { ok: true };
  }

  listAll(): Array<{ id: string; relativePath: string; severity: Severity; tags: string; cve: string }> {
    const rows = this.client
      .prepare("SELECT id, relative_path, severity, tags, cve FROM tpl_meta ORDER BY relative_path")
      .all();
    return rows.filter(isRecord).map((row) => {
      const decoded = decodeTplRow(row);
      return {
        id: decoded.id,
        relativePath: decoded.relativePath,
        severity: decoded.severity,
        tags: decoded.tags,
        cve: decoded.cve,
      };
    });
  }

  listAllPaths(): Array<{ id: string; relativePath: string }> {
    const rows = this.client.prepare("SELECT id, relative_path FROM tpl_meta").all();
    return rows.filter(isRecord).map((row) => {
      const decoded = decodeTplRow(row);
      return { id: decoded.id, relativePath: decoded.relativePath };
    });
  }

  stats(): Record<string, number> {
    const rows = this.client.prepare("SELECT severity, COUNT(*) AS n FROM tpl_meta GROUP BY severity").all();
    const result: Record<string, number> = { total: this.count() };
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const severity = typeof row.severity === "string" ? row.severity : "unknown";
      result[severity] = typeof row.n === "number" ? row.n : 0;
    }
    return result;
  }

  remove(id: string): void {
    this.client.exec("BEGIN");
    try {
      this.client.prepare("DELETE FROM tpl_fts WHERE rowid = (SELECT rowid FROM tpl_meta WHERE id = ?)").run(id);
      this.client.prepare("DELETE FROM tpl_meta WHERE id = ?").run(id);
      this.client.exec("COMMIT");
    } catch (error) {
      this.client.exec("ROLLBACK");
      throw error;
    }
  }
}

export interface SyncResult {
  synced: string[];
  failed: Array<{ path: string; error: string }>;
  removed: string[];
}

export async function syncFromFiles(db: TemplateDb, root: string): Promise<SyncResult> {
  const result: SyncResult = { synced: [], failed: [], removed: [] };
  const seen = new Set<string>();
  const files: Array<{ rel: string; parsed: ReturnType<typeof parseTemplateFile> }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
      const rel = relative(root, full).replaceAll("\\", "/");
      seen.add(rel);
      files.push({ rel, parsed: parseTemplateFile(full) });
    }
  };
  walk(root);
  for (const { rel, parsed } of files) {
    if ("parseError" in parsed) {
      result.failed.push({ path: rel, error: parsed.parseError });
      continue;
    }
    try {
      await db.upsert(parsed.meta, rel);
      result.synced.push(rel);
    } catch (error) {
      result.failed.push({ path: rel, error: (error as Error).message });
    }
  }
  walk(root);
  const rows = db.listAllPaths();
  for (const { id, relativePath } of rows) {
    if (!seen.has(relativePath)) {
      db.remove(id);
      result.removed.push(relativePath);
    }
  }
  return result;
}
