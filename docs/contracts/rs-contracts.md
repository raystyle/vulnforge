# rs 契约（exploit rs 域）

契约定义：`src/templates/rs/contracts.ts`、`src/templates/rs/db.ts`。物化库 = 一漏洞一 exploit rs（脚本名 = 漏洞标识）。

## 品牌契约

| 符号                       | 形态     | 说明                                                                                                            |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `ScriptNameSchema`         | zod 品牌 | 漏洞标识形（CVE-2026-1234 / thinkphp-5-rce），禁路径分隔符                                                      |
| `ScriptName`               | type     | 品牌字符串                                                                                                      |
| `scriptName(raw)`          | 函数     | 品牌构造器（边界专用）                                                                                          |
| `RsSourceSchema`           | zod 枚举 | project / global / bundled（三源合并，先到先得）                                                                |
| `RsSource`                 | type     | 枚举元素                                                                                                        |
| `RsTripleSchema`           | zod 品牌 | rust triple 形（zigbuild 目标）                                                                                 |
| `RsTriple`                 | type     | 品牌字符串                                                                                                      |
| `SEMVER_RE`                | const    | 版本正则                                                                                                        |
| `RsMetaSchema`             | zod      | 元数据行：name/description/descriptionEn/version(semver)/keywords/args/codes/file/source/faces/dangerous/sha256 |
| `RsMeta`                   | type     | 解析后元数据                                                                                                    |
| `AgentResultSchema`        | zod      | 脚本级信封：success + (action 或 error) + next_suggestion                                                       |
| `AgentResult`              | type     | 解析后信封                                                                                                      |
| `parseAgentResult(output)` | 函数     | 从脚本 stdout 提取最后一行 JSON 并过契约                                                                        |

## RsDb（rs.db / rs-lock.json）

| 符号                                           | 形态      | 说明                                                  |
| ---------------------------------------------- | --------- | ----------------------------------------------------- |
| `RsSealRecord`                                 | interface | version/dbSha256/scriptCount/sealedAt                 |
| `decodeRsRow(row)`                             | 函数      | 存储行 → RsMeta（zod 边界，绝不裸信任）               |
| `RsDb`                                         | class     | rs_meta + rs_fts（bm25 10/8/3/3）                     |
| `RsDb.upsert(meta)`                            | 方法      | 名字冲突即更新（一漏洞一行）+ fts 重插                |
| `RsDb.remove(name)` / `count()` / `findByName` | 方法      | 行管理                                                |
| `RsDb.search(query, {source?, dangerous?})`    | 方法      | bm25 检索 + 过滤，限 50                               |
| `RsDb.findByVulnerability(vulnId)`             | 方法      | 跨域锚：按漏洞标识精确 + 模糊匹配                     |
| `RsDb.listNames()`                             | 方法      | 全部脚本名                                            |
| `RsDb.seal()` / `verifySeal` / `loadSeal`      | 方法      | **真落盘** rs-lock.json（对照 tpl 的 vapor 模式修正） |
