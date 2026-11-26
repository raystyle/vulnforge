# 执行契约（run / mock / lint / scaffold）

契约定义源码：`src/templates/run.ts`、`mock.ts`、`lint.ts`、`scaffold.ts`。逐项列出全部导出契约。

## 1. run.ts — nuclei 执行

### 1.1 `NucleiHit`

| 字段         | 类型                      | 说明                                           |
| ------------ | ------------------------- | ---------------------------------------------- |
| `templateId` | `string`                  | 命中模板 id（JSONL `template-id`，缺失行跳过） |
| `infoName`   | `string`                  | `info.name`                                    |
| `matchedAt`  | `string`                  | 命中 URL                                       |
| `type`       | `string`                  | 协议类型                                       |
| `raw`        | `Record<string, unknown>` | 原始 JSONL 行                                  |

### 1.2 `RunResult`

| 字段        | 类型          | 说明                                            |
| ----------- | ------------- | ----------------------------------------------- |
| `exitCode`  | `number`      | 进程退出码；**124 = 超时**                      |
| `hits`      | `NucleiHit[]` | 解析后的命中（逐行 JSON.parse，非 JSON 行跳过） |
| `rawOutput` | `string`      | stdout 原文（16MB 截断）                        |
| `stderr`    | `string`      | stderr（8000 字符截断）                         |

### 1.3 `RunOptions`

| 字段         | 类型                    | 默认       | 说明                                        |
| ------------ | ----------------------- | ---------- | ------------------------------------------- |
| `nucleiPath` | `string \| undefined`   | `"nuclei"` | 显式二进制路径，缺省走 PATH                 |
| `timeoutMs`  | `number \| undefined`   | `120_000`  | 超时先 SIGTERM 后 200ms SIGKILL             |
| `nucleiArgs` | `string[] \| undefined` | `[]`       | 注入标准参数前的额外参数（mock CLI 包装用） |

### 1.4 `NucleiAvailability`

| 字段        | 类型                  | 说明                                 |
| ----------- | --------------------- | ------------------------------------ |
| `available` | `boolean`             | 可运行                               |
| `path`      | `string \| undefined` | 探测用的路径                         |
| `version`   | `string \| undefined` | `Nuclei Engine Version: vX.Y.Z` 提取 |
| `reason`    | `string \| undefined` | 不可用原因 + 安装指引                |

### 1.5 `BenignVerdict` 与函数

- `runTemplateAgainst(tplPath, url, options?): Promise<RunResult>`——参数序 `[...nucleiArgs] -t <tpl> -u <url> -jsonl -no-color -silent -duc`
- `verifyNoFalsePositive(tplPath, benignUrl, options?): Promise<BenignVerdict>`——`BenignVerdict = { weakMatcher: boolean; hits: NucleiHit[] }`；**weakMatcher = 有任何 hit**（上游 honeypot 判据）
- `checkNuclei(options?): Promise<NucleiAvailability>`——`-version` 探测

**执行纪律**：内部 `spawnCollect` 用 **spawn 流式收集——不用 execFile**（Windows 上 execFile 对 Go 二进制 pipe 死锁：nuclei 190ms 退出但回调永不触发，实测教训）；`shell:false`、参数数组化、`windowsHide:true`。

## 2. mock.ts — 可编程靶机

### 2.1 `MockRoute`

| 字段      | 类型                            | 说明                             |
| --------- | ------------------------------- | -------------------------------- |
| `method`  | `string`                        | 匹配请求方法（`"*"` 通配）       |
| `path`    | `string`                        | 精确 / `prefix/*` / `*` 三种匹配 |
| `status`  | `number`（可选）                | 默认 200                         |
| `body`    | `string`（可选）                | 响应体                           |
| `headers` | `Record<string,string>`（可选） | 响应头                           |

### 2.2 `MockTarget`

| 字段      | 类型                  | 说明                                  |
| --------- | --------------------- | ------------------------------------- |
| `url`     | `string`              | `http://127.0.0.1:<port>`（随机端口） |
| `port`    | `number`              | 实际监听端口                          |
| `close()` | `() => Promise<void>` | 释放端口（未匹配路由响应 404）        |

- `startMockTarget(routes, host?): Promise<MockTarget>`——默认绑定 `127.0.0.1`（仅本地，安全边界）
- `benignProfile(): MockRoute[]`——nginx 1.24.0 欢迎页，通用无害响应，专供反证

## 3. lint.ts — 模板静态检查

### 3.1 `LintFinding`

| 字段      | 类型                             | 说明            |
| --------- | -------------------------------- | --------------- |
| `level`   | `"error" \| "warning" \| "info"` | 级别            |
| `rule`    | `string`                         | 规则 id（见下） |
| `message` | `string`                         | 人读说明        |

规则全集：`structure/missing-id`、`structure/id-case`、`structure/id-format`、`structure/id-length`、`structure/missing-name`、`structure/missing-author`、`structure/author-format`、`structure/missing-severity`、`structure/severity-enum`、`structure/missing-description`、`structure/missing-tags`、`matcher/weak-word`、`matcher/missing`、`matcher/single-layer`、`matcher/no-proof-marker`。

### 3.2 `TemplateInfo`

lint 的输入视图（宽松结构）：`id?`、`info?{name,author,severity,description,tags?,classification?{cve_id,cwe_id}}`、`http?[{matchers?[{type,words?,regex?,dsl?,condition?}], matchers_condition?}]`、`network?/dns?/ssl?/file?`。

### 3.3 检查器

- `checkStructure(doc: TemplateInfo): LintFinding[]`——必填字段、id kebab/小写/≤5 词、severity 枚举、author 逗号格式
- `checkWeakMatchers(doc): LintFinding[]`——弱词黑名单（error/admin/login/dashboard/unauthorized/forbidden/not found/welcome/403/404/500/success/failed 精确匹配）+ 单层提示（warning）+ 无 `{{randstr}}` proof 提示（info）
- `lintDocument(doc): LintFinding[]`——前两者合一

## 4. scaffold.ts — 骨架生成

### 4.1 `VulnType` / `VULN_TYPES`

`"detect" | "rce" | "sqli" | "lfi" | "panel"` 五类；`VULN_TYPES` 为 readonly 数组（Pi 工具参数枚举源）。

### 4.2 `ScaffoldInput`

| 字段          | 类型                  | 说明                       |
| ------------- | --------------------- | -------------------------- |
| `vulnType`    | `VulnType`            | 骨架类型                   |
| `name`        | `string`              | 人读名（id 从此派生）      |
| `author`      | `string`              |                            |
| `severity`    | `Severity` 枚举       |                            |
| `description` | `string`              |                            |
| `tags`        | `string`              | 逗号分隔                   |
| `cveId`       | `string \| undefined` | 有则生成 classification 段 |

### 4.3 函数

- `templateIdFromName(name: string): string`——id 派生：小写、`_`/空格→`-`、连续分隔折叠、去首尾 `-`
- `skeletonFor(input: ScaffoldInput): string`——完整 yaml 骨架（五类 matcher 结构各异，均含 proof 标记思想）
- `targetDirectory(input: ScaffoldInput): string`——cve→`http/cves`；panel/detect→`http/exposures`；其余→`http/vulnerabilities`

## 5. mock-nuclei CLI（scripts/mock-nuclei.py）

测**调用方**的假 nuclei（uv 自包含，PEP 723）：`MOCK_NUCLEI_FINDINGS` 注入 findings JSON、`-version`/`-jsonl`/`-severity`/`-tags` 兼容、`MOCK_NUCLEI_DELAY`/`MOCK_NUCLEI_EXIT` 控制行为。与 mock 靶机分工：**靶机+真 nuclei 验证模板本身；mock CLI 确定性测试我们的工具代码**。
