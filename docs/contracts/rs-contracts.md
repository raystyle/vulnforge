# rs 契约（exploit rs 域）

契约定义：`src/nuclei/rs/contracts.ts`、`src/nuclei/rs/db.ts`。物化库 = 一漏洞一 exploit rs（脚本名 = 漏洞标识）。

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

**信封取舍规则（用户裁定，两域严格分工）**：

| 面                    | 字段              | 语义                                       | 内容边界                                                       |
| --------------------- | ----------------- | ------------------------------------------ | -------------------------------------------------------------- |
| 工具级（vf-error）    | `hint:`           | **纠偏指引**——调错工具/参数时怎么改        | 工具用法（正确的参数组合、替代工具、安装指引）；不含攻击链信息 |
| 脚本级（AgentResult） | `next_suggestion` | **下一步建议**——本次执行结果之后的域内行动 | 攻击链指针（下一步打什么、用什么脚本、验证什么）；不含工具用法 |

判定规则：写的内容是"怎么调工具"→ hint；是"接下来做什么"→ next_suggestion。脚本信封不出现工具用法，工具错误不出现攻击链。

## 运行时小部件（runtime.rs / payload.rs，供 rs 脚本使用）

| 符号                                   | 形态   | 说明                                                                                   |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `SerializedKind`                       | enum   | 序列化家族指纹：JavaNative/Nrbf/ViewState/JsonTyped/Unknown                            |
| `serialized_kind(data)`                | 函数   | 二进制魔数识别（AC ED 00 05 / NRBF 头 / /w 或 FF 01 / ）                               |
| `serialized_kind_b64(text)`            | 函数   | base64 标记快筛（rO0AB / AAEAAAD）                                                     |
| `NATIVE_JAVA_CHAINS`                   | const  | ysoserial-rs 原生链集（24 链）                                                         |
| `JavaPayload`                          | struct | 链+命令绑定；is_native 判定；generate 原生 pending/运行时路由                          |
| `DOTNET_FORMATTERS`                    | const  | ysonet 格式器词表                                                                      |
| `DotnetPayload`                        | struct | 格式器+gadget+命令；generate 路由运行时工具                                            |
| `WebshellKind`                         | enum   | PhpGet/PhpPost/Jsp/Aspx——template() 模板面 + drive_query() 驱动面（webshell 专库种子） |
| `b64_encode / url_encode / hex_encode` | 函数   | payload 变形原语（RFC 4648 向量测试）                                                  |
| `ShellPayload` / `DataPayload`         | struct | Newtype 防 payload 串门；as_b64/as_url/as_hex 三传输                                   |

## 无特征 webshell 专库（webshell.rs）

| 符号                                                     | 形态   | 说明                                                                                        |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `ChannelConfig` / `DerivedChannel`                       | struct | 通道凭证（key/pass/header 门）与派生束（md5_key/md5/pass/header）；密钥只在生成期           |
| `derive_md5_key(key)` / `derive_md5_pass(pass, md5_key)` | 函数   | godzilla 三段派生链（md5(key)[0..16] → md5(pass+md5Key) 大写）                              |
| `stream_cipher(data, md5_key)`                           | 函数   | XOR 流密（第一批依赖零；AES 形态后续 ADR）                                                  |
| `wrap_command(command, md5_key)`                         | 函数   | 请求包装：cipher → base64（报文=密文）                                                      |
| `unwrap_response(sandwich, md5, md5_key)`                | 函数   | 响应三明治解包：md5[0..16]+b64(cipher)+md5[16]，标记不匹配即拒绝（完整性门）                |
| `php_channel_template(derived)`                          | 函数   | 植入模板：header 门 + 密文参数 + 三明治回显——无 shell 语法特征串（one-liner 降为 fallback） |
| `drive_request(url, command, derived)`                   | 函数   | 操作面：构造门 header + 密文 body（WAF 视角=普通 POST + 密文）                              |
| `b64_decode(input)`                                      | 函数   | 依赖零 base64 解码                                                                          |
| `DriveRequest`                                           | struct | 驱动请求元数据                                                                              |

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

## 脚本解析（script-parse.ts）

| 符号                    | 形态      | 说明                                                                                                |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `ParsedRsScript`        | interface | meta（name/description/descriptionEn/version/args/keywords/codes）+ cargoDeps + lintIssues + sha256 |
| `parseRsScript(source)` | 函数      | `//!` 头连续 run（容许裸 `//!` 行）+ ```cargo 依赖块解析 + advisory lint（metadata/args/envelope）  |
| `sourceRank(source)`    | 函数      | 三源合并排序：project(0) > global(1) > bundled(2)                                                   |

## 骨架与编辑（scaffold.ts / edit.ts）

| 符号                           | 形态         | 说明                                                        |
| ------------------------------ | ------------ | ----------------------------------------------------------- |
| `RS_EXPLOIT_TYPES`             | const        | rce / sqli / auth-bypass / info-disclosure 四类利用骨架     |
| `RsExploitType`                | type         | 上述枚举元素                                                |
| `RsScaffoldInput`              | interface    | vulnType + vulnId + description                             |
| `scriptNameFromVulnId(vulnId)` | 函数         | 漏洞标识 → 脚本名（CVE 形保大写，别名折小写）               |
| `rsTargetDirectory(vulnType)`  | 函数         | 按利用类型分目录                                            |
| `rsSkeletonFor(input)`         | 函数         | shebang + `//!` 头 + ```cargo 块 + AgentResult fn main 骨架 |
| `RsPatchSchema`                | zod 判别联合 | metadata（//! 行 patch）/ body（全文替换）                  |
| `RsPatch`                      | type         | 判别结果                                                    |
| `RsEditError`                  | class        | 非法编辑拒绝（不落盘）                                      |
| `validateRsPatch(raw)`         | 函数         | 边界构造器                                                  |
| `RsEditOutcome`                | interface    | applied[] + lintIssues[]                                    |
| `applyRsEdit(filePath, patch)` | 函数         | 契约链编辑：改后过 //! 头契约，丢 name 拒绝写               |

## 检索与同步（search.ts / sync.ts）

| 符号                                      | 形态      | 说明                                              |
| ----------------------------------------- | --------- | ------------------------------------------------- |
| `RsSearchHit` / `RsSearchOutcome`         | interface | 命中 + exploitFor + engine                        |
| `rsSearch(db, query, filters?)`           | 函数      | FTS 检索封装                                      |
| `rsExploitFor(db, vulnId)`                | 函数      | 跨域锚：漏洞标识 → exploit rs                     |
| `openRsDb(root)`                          | 函数      | workspace 根下开 rs.db/rs-lock.json               |
| `renderRsSearch(outcome, limit?)`         | 函数      | 工具结果文本渲染                                  |
| `RsSyncOptions`                           | interface | scriptsDir + source?                              |
| `RsSyncResult`                            | interface | synced/failed/lintFindings/seal                   |
| `runRsSync(root, dbPath, lockPath, opts)` | 函数      | 批量入库（.rs 收集 + 头契约校验 + upsert + seal） |
| `rsRelativePath(root, scriptsDir, abs)`   | 函数      | rs 域相对路径                                     |

## 执行（execute-machine.ts / executor.ts）

| 符号                                 | 形态      | 说明                                                                                                                                                   |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RsExecuteMachine`                   | XState    | exploit_rs_execute 域状态机：linting → spawning → parsing → done/failed；失败带 lintFindings/exitCode/reason 上下文                                    |
| `RsExecuteContext`                   | interface | label/lintFindings/exitCode?/output?/reason?/result?                                                                                                   |
| `RsExecuteEvent`                     | type      | LINT_OK/LINT_FAIL/SPAWN_DONE/PARSE_DONE/PARSE_FAIL                                                                                                     |
| `assertRsExecuteEventHandled(event)` | 函数      | 编译期穷尽守卫（switch 全 case + never 兜底）                                                                                                          |
| `RsRunOptions`                       | interface | scriptPath/args/timeoutSecs?/rustScriptPath?/env?                                                                                                      |
| `RsRunOutcome`                       | interface | phase(done                                                                                                                                             | failed)/result?/context/wallMs |
| `runRsScript(options)`               | 函数      | 执行器：//! 头 lint（advisory，无 name 硬拒）→ spawn rust-script（流收集+超时 kill 兜底+VF_TIMEOUT_SECS 透传）→ AgentResult 单行解析；全流程过域状态机 |
| `oobEnvFor(oob)`                     | 函数      | workspace `oob` 配置段 → VF_OOB_* 环境变量映射（事实字段；token/biid 密钥只经用户环境，永不入配置文件）                                                |
