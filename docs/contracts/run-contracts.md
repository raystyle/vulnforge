# 执行契约（run / mock / lint / scaffold）

契约定义源码：`src/nuclei/run.ts`、`mock.ts`、`lint.ts`、`scaffold.ts`。逐项列出全部导出契约。

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

### 1.1 端口-适配器（ScanPort，进程内 mock 替代外部 CLI）

| 符号                                            | 形态      | 说明                                                                                                                                                                       |
| ----------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScanPort`                                      | interface | `{ mode: "real"\|"mock"; scan(tplPath, url, options): Promise<RunResult> }`——扫描器端口，两个可注入适配器                                                                  |
| `createRealScanPort(nucleiPath?)`               | 函数      | 真实 nuclei 适配器（spawn 路径）                                                                                                                                           |
| `createMockScanPort(findings: MockFinding[])`   | 函数      | **进程内 mock 适配器**：findings 注入 → 直接生成 nuclei 兼容 JSONL → 走生产 `parseJsonlHits`（测的是真实结果管线，非平行 fake）——零进程开销、零外部依赖，替代外部 CLI 方案 |
| `MockFinding`                                   | interface | `{ templateId, name?, matchedAt?, type? }`                                                                                                                                 |
| `parseJsonlHits(rawOutput): NucleiHit[]`        | 函数      | JSONL → 命中（template-id 必填行）                                                                                                                                         |
| `runTemplateAgainst(tplPath, url, {scanPort?})` | 函数      | 显式端口注入；缺省真实 nuclei                                                                                                                                              |

Mock 语义（契约）：空 findings = 0 hit（benign 反证绿）；注入 findings 即对任意 URL 命中（weak-matcher 反证红）——两个方向都过生产解析链。

## 2. mock.ts — 可编程靶机

### 2.1 `MockRoute`（品牌契约，边界校验）

| 符号                                 | 形态            | 说明                                                                                                   |
| ------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------ |
| `HttpMethodSchema` / `HttpMethod`    | zod 枚举 + type | `GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS/*`——方法即契约，非法值解析期拒绝                               |
| `MockRouteSchema` / `MockRoute`      | zod + type      | `method: HttpMethod` + `path`（`*`、`/*` 后缀或 `/` 开头，refine）+ `status: 100-599` + `body/headers` |
| `MockRouteInput`                     | type            | zod 输入侧（status/body/headers 可选）                                                                 |
| `mockRoute(raw: unknown): MockRoute` | 函数            | 运行时构造器：Pi 工具边界的非类型 payload 经 parse 打契约                                              |

| 字段      | 契约                            | 说明                             |
| --------- | ------------------------------- | -------------------------------- |
| `method`  | `HttpMethod`（枚举）            | 匹配请求方法（`"*"` 通配）       |
| `path`    | `string`（refine）              | 精确 / `prefix/*` / `*` 三种匹配 |
| `status`  | `100-599` 整数（可选）          | 默认 200                         |
| `body`    | `string`（可选）                | 响应体                           |
| `headers` | `Record<string,string>`（可选） | 响应头                           |

预期语义：**mock 接受预期请求 → 返回预期数据 → 客户端（nuclei/scanPort）解析返回数据给出预期结果**——route 即"预期请求→预期数据"的契约化声明。

### 2.1.1 mock-client 控制通道契约（品牌化）

| 符号                                  | 契约                            | 说明                                                                                       |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `ControlEventSchema` / `ControlEvent` | zod discriminatedUnion("event") | child→parent：ready(url+`MockPort` brand)/closed/error(message)；控制线消息经 parse 打契约 |
| `ControlOpSchema` / `ControlOp`       | zod discriminatedUnion("op")    | parent→child：start(routes 经 `MockRouteSchema` 二次校验)/close；写 stdin 前解析           |
| `MockTargetPhase`                     | 字面量联合                      | spawning/ready/closing/closed/failed——生命周期状态穷尽                                     |
| `SpawnedMockTarget`                   | interface                       | url + branded port + `phase` + close()                                                     |

`mockPort` 为品牌数字（正整数 brand `"MockPort"`）；坏端口、坏方法、坏路由在跨进程边界即拒绝（实测验证）。

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

## 5. sync-machine.ts — 批量同步状态机（XState，事件驱动）

**纪律**：所有批量/多步工具逻辑默认且仅用事件驱动状态机——转换只由事件触发（SCAN_DONE/FILE_DONE/BATCH_COMPLETE/PAUSE/RESUME/ABORT），禁止 `always` 自循环、禁止命令式隐藏状态。事件穷尽在**编译期**强制：`assertSyncEventHandled` 的 switch 以 `never` 兜底，新增事件变体未处理即 tsc 失败。

### 5.1 `SyncEvent`（判别联合，6 事件）

| 事件             | 载荷                               | 语义                                          |
| ---------------- | ---------------------------------- | --------------------------------------------- |
| `SCAN_DONE`      | `files: string[]`                  | 文件收集完成，进入 indexing                   |
| `FILE_DONE`      | `path + outcome: BatchItemOutcome` | 单文件处理完毕（indexed/failed + lintErrors） |
| `BATCH_COMPLETE` | —                                  | 全部文件完成，进入 sealing                    |
| `PAUSE`          | —                                  | 断点：cursor+结果快照落 sync_jobs 表          |
| `RESUME`         | —                                  | 从快照 cursor 续跑（scanning 态接住）         |
| `ABORT`          | `reason: string`                   | 终止，快照标 aborted                          |

### 5.2 状态图

```
scanning ──SCAN_DONE→ indexing ──BATCH_COMPLETE→ sealing(final)
              RESUME↻    FILE_DONE↻（自循环计数）
                         PAUSE→ sealing（快照）
                         ABORT→ aborted(final)
```

### 5.3 契约符号

| 符号                                            | 形态           | 说明                                                                                                       |
| ----------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| `syncMachine`                                   | XState machine | `setup({types:{context,events,input}})` 严格类型化                                                         |
| `SyncMachineContext`                            | interface      | jobId/root/db/files/cursor/results/sealedSha16?                                                            |
| `SyncMachineInput`                              | interface      | createActor 输入（context 初始化源）                                                                       |
| `SyncJobSnapshot`                               | interface      | phase/cursor/total/indexed/failed/sealedSha16?——落 `sync_jobs` 表（job_id 主键，snapshot_json 列）         |
| `BatchItemOutcome`                              | interface      | path/status("indexed"\|"failed")/error?/lintErrors                                                         |
| `BatchRunResult`                                | interface      | SyncResult + lintFindings[]{path,errors,warnings}                                                          |
| `runBatchSync(db, root, {jobId?, resumeFrom?})` | 函数           | driver：逐文件 parse→lint→upsert，每文件发 FILE_DONE；末尾 BATCH_COMPLETE 触发 seal                        |
| `loadJobSnapshot(db, jobId)`                    | 函数           | 读断点快照                                                                                                 |
| `lintTemplateFile(source, fileName)`            | 函数           | yaml lint + doc lint 合一，返回 {yamlFindings, docFindings, error?}                                        |
| `assertSyncEventHandled(event)`                 | 函数           | **编译期穷尽守卫**：switch 全 case + never 兜底                                                            |
| `collectFiles(root, filter?, extensions?)`      | 函数           | 配置驱动文件收集；extensions 可配（默认 `.yaml`/`.yml`，rs 域用 `.rs`）；`collectYamlFiles` 为向后兼容别名 |
| `DEFAULT_SYNC_FILTER`                           | const          | 默认同步过滤（空 corpusDir + 上游默认排除目录）                                                            |
| `SYNC_EVENT_TYPES`                              | ReadonlySet    | 已处理事件类型集（运行时镜像）                                                                             |

### 5.4 mock 生命周期状态机（事件驱动，无豁免）

| 符号                                 | 形态   | 说明                                                                                                                          |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `MockLifecycleMachine`               | XState | spawning→(SPAWN)→ready→(CLOSE_REQUESTED)→closing→(CLOSED)→closed；spawning→(CHILD_ERROR)→failed；全事件驱动，转换只由事件触发 |
| `trackMockLifecycle(url, port)`      | 函数   | 驱动器：phase()（穷尽联合）/spawn()/controlEvent(evt)——控制通道事件映射为生命周期事件                                         |
| `assertLifecycleEventHandled(event)` | 函数   | 编译期穷尽守卫（switch 全 case + never 兜底），新生命周期事件未处理 = tsc 失败                                                |

规则：**所有工具（含单步）默认事件驱动状态机，无豁免**（pi-extension.md）。单步工具以最小状态机表达，保证生命周期可观测、可断点、可恢复。

### 5.5 文件收集（config 驱动）

| 符号                              | 形态      | 说明                                                                                                                         |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `SyncFilter`                      | interface | corpusDir + include/exclude Dirs/Files/Patterns（正则已编译 RegExp）                                                         |
| `syncFilterFromConfig(config)`    | 函数      | `.vulnforge.json` sync 段 → SyncFilter（模式串编译为忽略大小写 RegExp）                                                      |
| `collectYamlFiles(root, filter?)` | 函数      | 按 filter 收集语料相对路径：corpusDir 起步 → 目录任意深度排除 → includeDirs 顶层过滤 → 文件名 include/exclude → 正则路径过滤 |

### 5.5 断点续跑语义

driver 的 `resumeFrom`（显式）或快照 phase=indexing 的 cursor（隐式）决定起始偏移；状态机内 `files` 是**剩余切片**（total=切片长度，非全量）；PAUSE/BATCH_COMPLETE 都先进 sealing 落 seal+done 快照。

## 6. edit.ts — 契约化编辑

编辑走 YAML parse → 变更 → 序列化回写 → 自动 lint；拒绝不落盘（EditError 即拒绝信号）。

| 符号                                                             | 形态                   | 说明                                                                                   |
| ---------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `EditPatchSchema`                                                | zod discriminatedUnion | 三种补丁：info / matcher / path                                                        |
| `EditPatch`                                                      | type                   | 判别联合推断                                                                           |
| `InfoPatchSchema` / `InfoPatch`                                  | zod + type             | name/author/severity(枚举)/description/tags/reference?                                 |
| `MatcherPatchSchema` / `MatcherPatch`                            | zod + type             | index + words/regex/part/condition/status                                              |
| `validateEditPatch(raw): EditPatch`                              | 函数                   | Pi 工具边界：EditPatchSchema.parse                                                     |
| `EditError`                                                      | class                  | 拒绝信号（越界 index/无 http 块/坏 severity 等）                                       |
| `EditOutcome`                                                    | interface              | updatedYaml / applied[] / lintFindings[] / lintErrors                                  |
| `applyEdit(absolutePath, relativePath, raw): EditOutcome`        | 函数                   | patch 模式：asRecord 视图 mutate → stringify（PLAIN、lineWidth 0）→ lint 全文档 → 回写 |
| `applyContent(absolutePath, relativePath, content): EditOutcome` | 函数                   | content 模式：yaml lint + id + name 契约门通过才写                                     |

**自动 lint 暴露**：两模式返回都含 lintFindings（yaml 语法/风格 + 结构/弱 matcher 全套），error 计入 lintErrors；Pi 工具层据此 isError。

## 6.9 scaffold-contract.ts — 品牌（ScaffoldId / EngineMode / RemoteTarget）

| 符号                                                        | 契约                 | 说明                                             |
| ----------------------------------------------------------- | -------------------- | ------------------------------------------------ |
| `ScaffoldIdSchema` / `ScaffoldId` / `scaffoldId(raw)`       | zod + brand + 构造器 | kebab-case 品牌 id，构造器在边界打契约           |
| `VulnTypeSchema` / `VulnType`                               | zod 枚举             | detect/rce/sqli/lfi/panel                        |
| `SeveritySchema` / `ScaffoldSeverity`                       | zod 枚举             | info..critical                                   |
| `ScaffoldInputSchema`                                       | zod object           | vf_nuclei_new 工具 payload 契约（含 cveId 格式） |
| `EngineModeSchema` / `EngineMode`                           | zod 枚举             | real / mock                                      |
| `RemoteTargetSchema` / `RemoteTarget` / `remoteTarget(raw)` | zod + brand + 构造器 | http(s) 远程目标品牌                             |

## 7. yamllint.ts — 内置 TS YAML lint（替代 Python yamllint 依赖）

### 5.1 `YamlLintFinding`

| 字段      | 类型                   | 说明                                               |
| --------- | ---------------------- | -------------------------------------------------- |
| `level`   | `"error" \| "warning"` | 语法/flow-style/空行超限 = error；风格类 = warning |
| `rule`    | `string`               | 规则 id（下）                                      |
| `message` | `string`               | 含文件名与行号                                     |
| `line`    | `number`               | 行号（1 起）                                       |

### 5.2 `lintYaml(source, fileName): YamlLintFinding[]`

规则全集（对齐上游 .yamllint 实际启用的规则）：

| 规则                   | 级别    | 说明                                                           |
| ---------------------- | ------- | -------------------------------------------------------------- |
| `yaml/syntax`          | error   | 解析错误，带行列（parseDocument errors，取前 5 条）            |
| `yaml/flow-style`      | error   | flow 映射 `{}` / 序列 `[]` 禁用（上游 braces/brackets forbid） |
| `yaml/empty-lines`     | error   | 连续空行 > 5                                                   |
| `yaml/trailing-spaces` | warning | 行尾空格                                                       |
| `yaml/comment-spacing` | warning | 注释前多于一个空格                                             |

实现要点：`parseDocument` + 遍历 `items` 树读 `flow` 标志（普通 `parse()` 丢失该信息——实测教训）；纯 TS 跨三平台，消除 Python/uv 运行时依赖。

## 6. 错误信封契约（errors.ts / tool-machine.ts）

### 6.1 错误信封（智能体自纠偏）

一切工具失败原子暴露为三行信封：`vf-error code=<稳定码>` / detail（offending 输入 + 解析后实际值）/ `hint: <下一步>`。错误码封闭集：

| 符号                                    | 形态  | 说明                                                                                                                                                                                                  |
| --------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VF_ERROR_CODES`                        | const | 封闭枚举（11 码）：CONFIG_NOT_FOUND / CONFIG_INVALID / PATH_ESCAPE / PATH_NOT_FOUND / PARAM_CONFLICT / NO_FIX_COMMANDS / TEMPLATE_INVALID / EDIT_REJECTED / ENGINE_UNAVAILABLE / CANCELLED / INTERNAL |
| `VfErrorCode`                           | type  | 上述联合的元素类型                                                                                                                                                                                    |
| `vfError(code, detail, hint): Error`    | 函数  | 构造信封 Error（name=VfError，message 三行）                                                                                                                                                          |
| `wrapAsVfError(error, classify): Error` | 函数  | 边界错误包装：classify(message) → {code, hint}；已是信封的透传                                                                                                                                        |

### 6.2 工具执行最小状态机

| 符号                              | 形态      | 说明                                                                                           |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `ToolExecutionMachine`            | XState    | idle → START → executing → SUCCEED \| FAIL → done / failed；全部 9 个工具的 execute 经此状态机 |
| `assertToolExecutionEventHandled` | 函数      | 编译期穷尽守卫（switch 全 case + never 兜底），新事件未处理 = tsc 失败                         |
| `withToolMachine(label, execute)` | 函数      | 签名保持包装器（恒等返回类型 + Parameters 传播）：工具 execute 包装入口                        |
| `ToolMachineObservation`          | interface | `{ phase: "idle" \| "executing" \| "done" \| "failed"; error?: string }`——观察回调载荷         |
