# 模板契约完整参考（meta.ts）

契约定义源码：`src/templates/meta.ts`。本文档逐项列出全部 schema、类型、表、函数——与代码 1:1，不一致以代码为准。

## 0. 总数据流

```
nuclei 模板 yaml（唯一真源）
  ① parseTemplateFile：YAML.parse → TemplateDocSchema.safeParse（品牌化边界）
TplMetaContract（契约行）
  ② TemplateDb.upsert（事务：drizzle onConflictDoUpdate + FTS 删旧插新）
SQLite tpl_meta + tpl_fts（WAL 模式）
  ③ SELECT raw row → decodeTplRow（zod 解码重新契约化，非强转）
TplMetaContract（读边界）
```

原则：**文件是真源，SQLite 只是索引**——先落文件、再同步索引；删除文件后同步会清对应行。

---

## 1. 基础类型与品牌

### 1.1 `SeveritySchema` / `Severity`

```ts
export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;
```

| 值         | 语义（上游 CVSS 对齐） |
| ---------- | ---------------------- |
| `info`     | 信息暴露（0.1-3.9）    |
| `low`      | 轻微信息泄漏           |
| `medium`   | 中危（4.0-6.9）        |
| `high`     | 高危（7.0-8.9）        |
| `critical` | 严重/RCE（9.0-10.0）   |

### 1.2 `CveIdSchema`

`z.string().regex(/^CVE-\d{4}-\d{4,}$/)`——形如 `CVE-2026-1234`。

### 1.3 `CweIdSchema`

`z.string().regex(/^CWE-\d+$/)`——形如 `CWE-89`。

### 1.4 `ProtocolSchema` / `Protocol`

```ts
z.enum([
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
```

13 个值含上游**废弃别名**（`tcp`=network 旧名、`requests`=http 旧名）。导出类型：

```ts
export type Protocol = Exclude<z.infer<typeof ProtocolSchema>, "requests" | "tcp"> | "http";
```

| 值           | 上游 yaml 键              | 说明                   |
| ------------ | ------------------------- | ---------------------- |
| `http`       | `http` / `requests`(废弃) | HTTP 请求模板          |
| `dns`        | `dns`                     | DNS 查询               |
| `file`       | `file`                    | 本地文件匹配           |
| `network`    | `network` / `tcp`(废弃)   | 原始 TCP               |
| `headless`   | `headless`                | 浏览器驱动             |
| `ssl`        | `ssl`                     | 证书检查               |
| `websocket`  | `websocket`               | WS                     |
| `whois`      | `whois`                   | WHOIS                  |
| `code`       | `code`                    | 本地代码片段（需签名） |
| `javascript` | `javascript`              | JS 协议                |
| `workflows`  | `workflows`               | 工作流编排             |

### 1.5 `StorageProtocolSchema` / `StorageProtocol`（存储行解码用）

```ts
z.enum([
  "http",
  "dns",
  "file",
  "network",
  "headless",
  "ssl",
  "websocket",
  "whois",
  "code",
  "javascript",
  "workflows",
]).catch("http");
```

比 `ProtocolSchema` 少 `tcp`/`requests`（入库前已归一为 `network`/`http`）；**decode 失败 catch 到 `"http"`**（库内脏数据兜底）。

### 1.6 `SeverityDecode`

`SeveritySchema.catch("info")`——DB 行 severity 解码失败兜底 `info`。

### 1.7 `StringSlice`（上游 stringslice.StringSlice 对齐）

```ts
z.union([z.string(), z.array(z.string())]).transform((value) =>
  Array.isArray(value)
    ? value.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
);
```

YAML 接受裸字符串或数组，**统一归一为 `string[]`**：裸字符串按 `,` 切分；全部 `trim()`；去空项。适用于 author/tags/cve-id/cwe-id/reference。

---

## 2. `TemplateDocSchema`（YAML 文档契约，品牌化边界）

```ts
z.object({
  id: string + /^([a-zA-Z0-9]+[-_])*[a-zA-Z0-9]+$/ + brand<"TemplateId">(),
  info: TemplateInfoSchema,
});
```

导出类型：`TemplateDoc`、`TemplateId`（品牌字符串）。

构造器：`templateId(raw: string): TemplateId`——zod parse 校验后打品牌（`// brand-allow: constructor exit`，brand-lint 豁免点）。

**注意**：id 用上游宽松 pattern（允许大写/下划线），仓库 kebab 命名纪律在 `lint.ts` 收严——解析不拒收，lint 报警。

### 2.1 `TemplateInfoSchema` 字段全表

| 字段             | 契约                                      | 默认 | 说明                                      |
| ---------------- | ----------------------------------------- | ---- | ----------------------------------------- |
| `name`           | `string.min(1)` + 拒绝首尾空格（refine）  | 必填 | 人读名，建议 "Vendor Product - Vuln Type" |
| `author`         | StringSlice（归一 `string[]`）            | 必填 | 模板作者 + 漏洞发现者，逗号分隔           |
| `severity`       | SeveritySchema 枚举                       | 必填 | 见 1.1                                    |
| `description`    | `string.min(1)`                           | 必填 | 漏洞描述（可含上游 {{placeholder}}）      |
| `impact`         | `string.optional()`                       | —    | 影响说明                                  |
| `remediation`    | `string.optional()`                       | —    | 修复建议                                  |
| `tags`           | StringSlice，default `[]`                 | `[]` | 小写逗号分隔标签                          |
| `reference`      | `union([string, string[]])`，default `[]` | `[]` | 参考链接                                  |
| `classification` | 见 2.2                                    | —    | 漏洞分类                                  |
| `metadata`       | `record<string, unknown>.optional()`      | —    | 附加元数据（`affected_product` 被提取）   |

### 2.2 `ClassificationSchema` 字段全表

| 字段              | 契约                                                                                               | 说明                               |
| ----------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `cve-id`          | StringSlice（逐项须过 CveIdSchema 的正则说明；StringSlice 不逐项校验 pattern，pattern 文档化于此） | CVE 编号，可多个                   |
| `cwe-id`          | StringSlice                                                                                        | CWE 编号，可多个                   |
| `cvss-metrics`    | `string.optional()`                                                                                | 如 `CVSS:3.1/AV:N/...`             |
| `cvss-score`      | `number.min(0).max(10).optional()`                                                                 |                                    |
| `epss-score`      | `number.min(0).max(1).optional()`                                                                  |                                    |
| `epss-percentile` | `number.min(0).max(1).optional()`                                                                  |                                    |
| `cpe`             | `string.optional()`                                                                                | 如 `cpe:/a:vendor:product:version` |

### 2.3 `detectProtocol(raw: Record<string, unknown>): Protocol`

按文档顶层键判别协议，优先级序：http/requests→`http`、dns、file、network/tcp→`network`、headless、ssl、websocket、whois、code、javascript、workflows；无任何协议键默认 `http`。

---

## 3. `TplMetaContract`（契约行——写读共用）

| 字段                  | 类型                      | 存储列                       | 生成规则（parseTemplateFile）                  |
| --------------------- | ------------------------- | ---------------------------- | ---------------------------------------------- |
| `rowid`               | `number`                  | `rowid INTEGER PRIMARY KEY`  | DB 自增（decode 时从行取）                     |
| `id`                  | **`TemplateId`**（brand） | `id TEXT NOT NULL UNIQUE`    | `doc.id`                                       |
| `name`                | `string`                  | `name TEXT`                  | `doc.info.name`                                |
| `author`              | `string`                  | `author TEXT`                | `doc.info.author.join(",")`                    |
| `severity`            | `Severity`                | `severity TEXT`              | `doc.info.severity`                            |
| `description`         | `string`                  | `description TEXT`           | `doc.info.description`                         |
| `tags`                | `string`                  | `tags TEXT`                  | `doc.info.tags.join(",")`                      |
| `cve`                 | `string`                  | `cve TEXT`                   | `classification["cve-id"].join(",")`           |
| `cwe`                 | `string`                  | `cwe TEXT`                   | `classification["cwe-id"].join(",")`           |
| `protocol`            | `StorageProtocol`         | `protocol TEXT`              | `detectProtocol(raw)`                          |
| `affectedProduct`     | `string`                  | `affected_product TEXT`      | `metadata.affected_product`（非 string 则 ""） |
| `relativePath`        | `string`                  | `relative_path TEXT`         | 模板仓内正斜杠相对路径（sync 时注入）          |
| `duplicateKey`        | `string`                  | `duplicate_key TEXT`         | `cve` 或 `name.toLowerCase()`                  |
| `identityProduct`     | `string`                  | `identity_product TEXT`      | = affectedProduct                              |
| `identityVulnClass`   | `string`                  | `identity_vuln_class TEXT`   | = tags.join(",")                               |
| `identitySurface`     | `string`                  | `identity_surface TEXT`      | = protocol                                     |
| `identityEntryPoints` | `string`                  | `identity_entry_points TEXT` | 预留 ""                                        |
| `updatedAt`           | `string`                  | `updated_at TEXT`            | ISO 时间戳，每次 upsert 刷新                   |

派生类型：`TplMetaRow`（drizzle `$inferSelect`，存储层）、`TplMetaInsert`（`$inferInsert`）；drizzle 表对象 `tplMeta`（sqliteTable 定义，第 3/4 节的代码形态）。

**identity 四元组**（product/vulnClass/surface/entryPoints）：先例 poc-scanner 的身份查重模型，当前 product/​vulnClass/surface 为元数据直映射，entryPoints 预留。

---

## 4. SQLite 存储全貌

- **驱动**：`node:sqlite` `DatabaseSync` + `drizzle-orm/sqlite-proxy` 适配（零原生编译）
- **PRAGMA**：`journal_mode=WAL`（构造时）
- **DDL**（`CREATE IF NOT EXISTS`，幂等）：
  - `tpl_meta`：18 列（上表）+ 4 索引：`idx_tpl_severity`、`idx_tpl_cve`、`idx_tpl_protocol`、`idx_tpl_duplicate_key`
  - `tpl_fts`：FTS5 虚表，列序 `id, tags, cve, affected_product, name, description`，`tokenize='unicode61'`

### 4.1 FTS 查询语义（`search`）

- bm25 权重（列序对应）：`id 10.0, tags 8.0, cve 6.0, affected_product 5.0, name 3.0, description 1.0`——模板 id 最重、描述最轻
- snippet：`snippet(tpl_fts, 5, '[', ']', '...', 12)`——第 5 列（description）高亮 `[词]`、省略号、12 词窗
- 过滤：`severity = ?` / `cve = ?` / `protocol = ?`（可与 FTS MATCH 组合 AND）
- 排序 bm25 升序（越相关越小），LIMIT 50

### 4.2 查重（`findDuplicates`）

`duplicate_key` 分组 `COUNT(*) > 1`，`GROUP_CONCAT(id)` 汇总同键模板 id 列表。

---

## 5. `SealRecord`（封版）

| 字段            | 类型     | 说明                                                                                               |
| --------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `version`       | `number` | 封版版本号（当前恒 1）                                                                             |
| `dbSha256`      | `string` | 主库文件 SHA-256——**计算前必 `PRAGMA wal_checkpoint(TRUNCATE)`**（WAL 未刷盘会漏检漂移，实测教训） |
| `templateCount` | `number` | 封版时 `COUNT(*)`                                                                                  |
| `sealedAt`      | `string` | ISO 时间                                                                                           |

生命周期：记录写 `templates-lock.json`（进 git）；`templates.db` 实体不进 git；增量运维（增量 upsert，不重建）；`verifySeal` 打开时校验（同样先 checkpoint）。

---

## 6. 函数与方法全表

| 签名                                                                                         | 说明                                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `templateId(raw: string): TemplateId`                                                        | 品牌构造器（parse + brand）                                                                |
| `detectProtocol(raw): Protocol`                                                              | 见 2.3                                                                                     |
| `sha256File(path: string): string`                                                           | 文件 SHA-256 hex                                                                           |
| `parseTemplateFile(path): { meta: Omit<TplMetaContract,"rowid"> } \| { parseError: string }` | YAML → 契约行；三段失败：YAML parse / 非 mapping / schema（逐 issue `path: message` 串联） |
| `class TemplateDb`：`constructor(dbPath)`                                                    | 打开 + WAL + DDL                                                                           |
| `close(): void`                                                                              | 关连接                                                                                     |
| `upsert(meta, relativePath): Promise<void>`                                                  | 事务：主表 onConflictDoUpdate(id) + FTS 删旧插新；失败 ROLLBACK                            |
| `count(): number`                                                                            | 主表行数                                                                                   |
| `search(query, {severity?, cve?, protocol?}): Array<TplMetaContract & {snippet}>`            | FTS + 过滤                                                                                 |
| `findDuplicates(): Array<{duplicateKey, ids[]}>`                                             | 同键查重                                                                                   |
| `listAll(): Array<{id, relativePath, severity, tags, cve}>`                                  | 按 relativePath 序全量                                                                     |
| `listAllPaths(): Array<{id, relativePath}>`                                                  | sync 清理用                                                                                |
| `remove(id): void`                                                                           | 事务删主表 + FTS                                                                           |
| `stats(): Record<string, number>`                                                            | `{total, 按severity计数}`                                                                  |
| `seal(): SealRecord`                                                                         | 见 5                                                                                       |
| `verifySeal(record): {ok, reason?}`                                                          | 哈希校验（先 checkpoint）                                                                  |
| `syncFromFiles(db, root): Promise<SyncResult>`                                               | 遍历 yaml → parse → upsert；消失文件 remove                                                |

### 6.1 `SyncResult`

| 字段      | 类型                   | 说明                     |
| --------- | ---------------------- | ------------------------ |
| `synced`  | `string[]`             | 成功同步的相对路径       |
| `failed`  | `Array<{path, error}>` | 解析/写库失败及原因      |
| `removed` | `string[]`             | 文件已删、索引清除的路径 |

内部纪律：walk 只收 `.yaml`/`.yml`；先全收集再逐个 upsert（异步安全）；`.git` 等目录自然跳过（无 yaml）。
