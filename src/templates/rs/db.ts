import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { type RsMeta, RsMetaSchema, type ScriptName } from "./contracts.ts";

/**
 * Materialized exploit-rs metadata index: rs_meta + rs_fts (bm25 weights
 * name 10 / keywords 8 / description 3 / description_en 3). One row per
 * script name (= vulnerability identifier). seal() PERSISTS the record to
 * the lock file (the tpl seal is computed-but-vapor; rs does it right).
 */
export interface RsSealRecord {
  version: number;
  dbSha256: string;
  scriptCount: number;
  sealedAt: string;
}

const DDL = `
CREATE TABLE IF NOT EXISTS rs_meta (
  rowid INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0.0',
  keywords TEXT NOT NULL DEFAULT '',
  args TEXT NOT NULL DEFAULT '',
  codes TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'project',
  faces TEXT NOT NULL DEFAULT '',
  dangerous INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_rs_source ON rs_meta(source);
CREATE VIRTUAL TABLE IF NOT EXISTS rs_fts USING fts5(
  name, keywords, description, description_en,
  tokenize='unicode61'
);
`;

interface RsRow {
  rowid: number;
  name: string;
  description: string;
  description_en: string;
  version: string;
  keywords: string;
  args: string;
  codes: string;
  file: string;
  source: string;
  faces: string;
  dangerous: number;
  sha256: string;
  updated_at: string;
}

/** Row decode through the zod contract — never trust the storage row. */
export function decodeRsRow(row: unknown): RsMeta {
  const record = row as Record<string, unknown>;
  const parsed = RsMetaSchema.safeParse({
    name: record["name"],
    description: record["description"],
    descriptionEn: record["description_en"],
    version: record["version"],
    keywords: String(record["keywords"] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    args: record["args"],
    codes: record["codes"],
    file: record["file"],
    source: record["source"],
    faces: String(record["faces"] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    dangerous: record["dangerous"] === 1 || record["dangerous"] === true,
    sha256: record["sha256"],
  });
  if (!parsed.success) {
    throw new Error(`rs_meta row failed contract decode: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return parsed.data;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export class RsDb {
  private readonly client: DatabaseSync;
  private readonly dbPath: string;
  private readonly lockPath: string;

  constructor(dbPath: string, lockPath: string) {
    this.dbPath = dbPath;
    this.lockPath = lockPath;
    this.client = new DatabaseSync(dbPath);
    this.client.exec("PRAGMA journal_mode=WAL");
    this.client.exec(DDL);
  }

  close(): void {
    this.client.close();
  }

  upsert(meta: RsMeta): void {
    this.client.exec("BEGIN");
    try {
      this.client
        .prepare(
          `INSERT INTO rs_meta (name, description, description_en, version, keywords, args, codes, file, source, faces, dangerous, sha256, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             description=excluded.description, description_en=excluded.description_en,
             version=excluded.version, keywords=excluded.keywords, args=excluded.args,
             codes=excluded.codes, file=excluded.file, source=excluded.source,
             faces=excluded.faces, dangerous=excluded.dangerous, sha256=excluded.sha256,
             updated_at=excluded.updated_at`,
        )
        .run(
          meta.name,
          meta.description,
          meta.descriptionEn,
          meta.version,
          meta.keywords.join(","),
          meta.args,
          meta.codes,
          meta.file,
          meta.source,
          meta.faces.join(","),
          meta.dangerous ? 1 : 0,
          meta.sha256,
          new Date().toISOString(),
        );
      this.client.prepare("DELETE FROM rs_fts WHERE rowid = (SELECT rowid FROM rs_meta WHERE name = ?)").run(meta.name);
      const row = this.client.prepare("SELECT rowid FROM rs_meta WHERE name = ?").get(meta.name) as
        | { rowid: number }
        | undefined;
      if (row === undefined) throw new Error(`upsert lost row for ${meta.name}`);
      this.client
        .prepare("INSERT INTO rs_fts (rowid, name, keywords, description, description_en) VALUES (?, ?, ?, ?, ?)")
        .run(row.rowid, meta.name, meta.keywords.join(" "), meta.description, meta.descriptionEn);
      this.client.exec("COMMIT");
    } catch (error) {
      this.client.exec("ROLLBACK");
      throw error;
    }
  }

  remove(name: string): void {
    this.client.prepare("DELETE FROM rs_fts WHERE rowid = (SELECT rowid FROM rs_meta WHERE name = ?)").run(name);
    this.client.prepare("DELETE FROM rs_meta WHERE name = ?").run(name);
  }

  count(): number {
    return (this.client.prepare("SELECT COUNT(*) AS n FROM rs_meta").get() as { n: number }).n;
  }

  search(query: string, filters: { source?: string; dangerous?: boolean } = {}): Array<RsMeta & { snippet: string }> {
    const conditions: string[] = [];
    const params: string[] = [];
    if (query.length > 0) {
      conditions.push("m.rowid IN (SELECT rowid FROM rs_fts WHERE rs_fts MATCH ?)");
      params.push(query);
    }
    if (filters.source !== undefined) {
      conditions.push("m.source = ?");
      params.push(filters.source);
    }
    if (filters.dangerous !== undefined) {
      conditions.push("m.dangerous = ?");
      params.push(filters.dangerous ? "1" : "0");
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.client
      .prepare(
        `SELECT m.*, snippet(rs_fts, 2, '[', ']', '...', 12) AS snippet,
           bm25(rs_fts, 10.0, 8.0, 3.0, 3.0) AS rank
         FROM rs_meta m JOIN rs_fts ON m.rowid = rs_fts.rowid
         ${where}
         ORDER BY rank
         LIMIT 50`,
      )
      .all(...params) as unknown as Array<RsRow & { snippet: string }>;
    return rows.map((row) => ({ ...decodeRsRow(row), snippet: row.snippet }));
  }

  findByName(name: string): RsMeta | undefined {
    const row = this.client.prepare("SELECT * FROM rs_meta WHERE name = ?").get(name);
    if (row === undefined) return undefined;
    return decodeRsRow(row);
  }

  /** Cross-domain anchor: scripts whose name matches a vulnerability id. */
  findByVulnerability(vulnId: string): Array<RsMeta> {
    const rows = this.client.prepare("SELECT * FROM rs_meta WHERE name = ? OR name LIKE ?").all(vulnId, `%${vulnId}%`);
    return (rows as unknown[]).map((row) => decodeRsRow(row));
  }

  /** Group-by an analysis dimension (whitelisted column + branded count).
   * The column is one of the analysis faces — never user input raw. */
  groupBy(dimension: "source" | "faces" | "dangerous" | "version" | "keywords"): Array<{ key: string; count: number }> {
    const rows = this.client
      .prepare(`SELECT ${dimension} AS key, COUNT(*) AS n FROM rs_meta GROUP BY ${dimension} ORDER BY n DESC`)
      .all() as unknown as Array<{ key: string | number; n: number }>;
    return rows.map((row) => ({ key: String(row.key), count: row.n })); // brand-allow: SQL integer display, not a contract field decode
  }

  listNames(): ScriptName[] {
    const rows = this.client.prepare("SELECT name FROM rs_meta ORDER BY name").all();
    return (rows as Array<{ name: string }>).map(
      (row) => decodeRsRow({ ...row, description: "x", sha256: "ab".repeat(32) }).name,
    );
  }

  seal(): RsSealRecord {
    this.client.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const record: RsSealRecord = {
      version: 1,
      dbSha256: sha256File(this.dbPath),
      scriptCount: this.count(),
      sealedAt: new Date().toISOString(),
    };
    writeFileSync(this.lockPath, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }

  verifySeal(record: RsSealRecord): { ok: boolean; reason?: string } {
    if (!existsSync(this.dbPath)) {
      return { ok: false, reason: "rs db file missing — run the rs sync to rebuild" };
    }
    this.client.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const actual = sha256File(this.dbPath);
    if (actual !== record.dbSha256) {
      return { ok: false, reason: "rs db hash differs from seal record" };
    }
    return { ok: true };
  }

  loadSeal(): RsSealRecord | undefined {
    if (!existsSync(this.lockPath)) return undefined;
    const raw = JSON.parse(readFileSync(this.lockPath, "utf8")) as Partial<RsSealRecord>;
    if (typeof raw.dbSha256 !== "string" || typeof raw.scriptCount !== "number" || typeof raw.sealedAt !== "string") {
      return undefined;
    }
    return { version: raw.version ?? 1, dbSha256: raw.dbSha256, scriptCount: raw.scriptCount, sealedAt: raw.sealedAt };
  }
}
