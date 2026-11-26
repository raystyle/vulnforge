# VulnForge Pi 工具与命令清单

扩展入口 `src/index.ts` 注册的全部工具面。Pi 会话中模型按需调用；本文档为完整参考，代码为准（由 contracts-lint 的工具清单检查防漂移）。

## 错误信封（智能体自纠偏契约）

一切工具失败都原子暴露为三行信封（`src/templates/errors.ts`）：

```
vf-error code=<稳定错误码>
<detail： offending 输入 + 解析后的实际值>
hint: <下一步怎么改>
```

| 错误码               | 触发                                                             | hint 方向                           |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| `CONFIG_NOT_FOUND`   | 向上找不到 `.vulnforge.json`                                     | 内联最小配置示例（不指向仓库 docs） |
| `CONFIG_INVALID`     | 配置 JSON/正则非法                                               | 修 JSON 或跑 vf_init                |
| `PATH_ESCAPE`        | 路径逃逸模板仓根                                                 | 给出仓根 + 相对路径示例             |
| `PATH_NOT_FOUND`     | 模板文件不存在                                                   | 检查路径拼写                        |
| `PARAM_CONFLICT`     | 参数互斥冲突（target/routes、patch/content、engine=mock+target） | 列出收到的字段 + 正确组合示例       |
| `NO_FIX_COMMANDS`    | vf_init install 项名无对应命令                                   | 指回 check 输出的合法项名           |
| `TEMPLATE_INVALID`   | 模板 YAML/契约失败                                               | lint 规则名                         |
| `EDIT_REJECTED`      | 编辑补丁越界/结构不符                                            | 调整索引或用 content 模式           |
| `ENGINE_UNAVAILABLE` | real 引擎缺失                                                    | 安装指引 + engine=mock 备选         |
| `CANCELLED`          | 用户在 confirm 门拒绝                                            | 重试需用户同意                      |
| `INTERNAL`           | 未分类                                                           | 报 bug 附原始调用                   |

错误码枚举是封闭集（`VF_ERROR_CODES`）；智能体按 code 分支纠偏，无需解析散文。zod 拒绝（枚举合法值）、lint findings（`[level] rule: msg`）本身就是原子形态，不再二次包装。

## 工具（registerTool）

| 工具                | 用途一句话                                                | 写操作                | 确认         |
| ------------------- | --------------------------------------------------------- | --------------------- | ------------ |
| `vf_env_check`      | 环境体检：三平台工具链 + 中国镜像 + 模板仓 + mock 端口    | 否（只读探测）        | —            |
| `vf_env_install`    | 修复一项环境缺失：跑 fix 命令 → 复检回告                  | 是（安装软件/改配置） | confirm      |
| `poc_nuclei_new`    | 生成模板骨架写入模板仓                                    | 是（新文件）          | —            |
| `poc_nuclei_lint`   | 模板静态检查：YAML+结构/元数据/弱 matcher                 | 否                    | —            |
| `poc_nuclei_edit`   | 契约化编辑（patch 或 content），编辑后自动 lint           | 是（改文件）          | —            |
| `poc_nuclei_run`    | 双模式验证：本地 mock 靶机 + 无害反证 / 远程目标扫描      | 否（远程需确认）      | 远程 confirm |
| `poc_nuclei_sync`   | 状态机批量同步 + lint 聚合 + 封版（断点可续）             | 是（写 db）           | —            |
| `poc_nuclei_search` | 元数据 FTS 全文检索                                       | 否                    | —            |
| `poc_nuclei_stats`  | 元数据分析：维度分组/年份直方图/查重                      | 否                    | —            |
| `exploit_rs_search` | exploit rs 目录检索：FTS + 漏洞标识跨域定位 exploit       | 否                    | —            |
| `exploit_rs_new`    | 生成 exploit rs 骨架（//! 头 + cargo + Machine 模板）     | 是（新文件）          | —            |
| `exploit_rs_edit`   | 契约化编辑（metadata 行 patch / body 全文），丢 name 拒绝 | 是（改文件）          | —            |

## 命令（registerCommand）

| 命令        | 用途                                       |
| ----------- | ------------------------------------------ |
| `/vf`       | 状态总览：模板仓位置、索引统计、安全模式数 |
| `/vf-debug` | 内部状态：危险命令模式表与匹配自检         |

### exploit_rs_search

- **参数**：`query?`（FTS 语法，bm25 name 10/keywords 8/description 3）；`vulnId?`（漏洞标识——跨域锚：nuclei PoC 命中直连该漏洞的 exploit rs）；`dangerous?`（过滤危险标记脚本）——query 与 vulnId 二选一
- **行为**：检索 rs.db 物化索引（一漏洞一 exploit rs）；vulnId 路径精确 + 模糊匹配漏洞标识
- **返回**：命中列表（name/version/source/args/摘要）；exploitFor 列表（跨域）
- **何时用**：写 exploit 前查同面先例、PoC 命中后直接定位可用 exploit

### exploit_rs_new

- **参数**：`vulnType`（rce/sqli/auth-bypass/info-disclosure）、`vulnId`（漏洞标识 = 脚本名）、`description`、`deliverForm?`（submit 默认 / exec_command / write_file / rev_shell）
- **行为**：生成骨架——shebang + `//!` 元数据头 + cargo 依赖块（vf_rust_lib path 注入位）+ 强制状态机模板（Check→Probe→Craft→Deliver(形态)→Verify）；同名脚本已存在即拒绝（一漏洞一 exploit rs）
- **返回**：写入路径 + 完整骨架
- **何时用**：开写新 exploit 的第一步

### exploit_rs_edit

- **参数**：`path`；`patch`（判别联合：metadata 行 patch——description/description_en/version/args/keywords/codes，或 body 全文替换）
- **行为**：契约链编辑——改后过 `//!` 头契约；丢失 name（漏洞标识）拒绝写、不落盘
- **返回**：applied 字段清单 + lint 提示
- **何时用**：改 exploit 脚本的规范路径

## 配置自动发现

所有 `poc_*` 工具的定位规则：从会话工作目录向上查找**最近的 `.vulnforge.json`**，一次取齐 root / db / seal / sync 过滤。

- 嵌套 git clone 不阻断——语料目录（如 `nuclei-templates/`，自带上游 `.git`）内任意深度调用都能找到工作区配置
- 多层 `.vulnforge.json` 并存时就近优先
- 缺配置 = 诊断错误（起点 + 层数 + 内联最小配置示例），绝不静默

配置字段全量契约见 `docs/contracts/config-contracts.md`（db 文件名/封版记录、nuclei/yamllint 路径空值自动发现、sync 过滤 8 键含正则边界校验）。

## 逐项参考

### vf_init

- **参数**：`action?`（check 默认只读 / install 确认修复）；`name?`（action=install 时的项名）
- **行为**：check = 三平台逐项体检（工具链/镜像/模板仓/mock 端口）+ 修复指引；install = 取 fix 命令 → confirm → 执行 → 复检回告（headless 拒绝）
- **返回**：逐项 OK/MISSING + fix 指引；或执行的命令/退出码/复检结果
- **何时用**：环境验收、装后复检、会话开始

### poc_nuclei_lint

- **参数**：`path`（相对模板仓根）
- **行为**：三层检查——内置 TS yamllint（语法行列号/flow-style/空行/尾空格/注释间距）→ parseTemplateFile（zod 契约）→ lintDocument（结构/元数据/弱 matcher）；三层结果合报
- **返回**：逐条 `[level] rule (line N): message`；任何 error 则 isError
- **何时用**：模板编辑后、提交前

### poc_nuclei_edit

- **参数**：`path`；`patch?`（三选一判别：`{kind:"info", patch:{name?/author?/severity?/description?/tags?/reference?}}`、`{kind:"matcher", requestIndex?, matcherIndex, patch:{words?/regex?/part?/condition?/status?}}`、`{kind:"path", requestIndex?, paths[]}`）；`content?`（全文替换）——**patch 与 content 二选一**
- **行为**：YAML parse → 按补丁变更 → 重新序列化回写 → **自动 lint**（yaml 语法/风格 + 结构/弱 matcher），错误和警告随返回暴露；content 模式先过契约门（合法 yaml + 有 id + 有 name）才落盘，拒绝即不写
- **返回**：applied 字段清单、lint error 数、逐条 findings；有 error 则 isError
- **何时用**：模型改模板的规范路径——不绕过契约链直接手写文件

### poc_nuclei_run

- **参数**：
  - `path`（模板相对路径）
  - 本地模式：`routes?`（`{method, path, status?, body?}[]` 可编程 mock 靶机路由，127.0.0.1）
  - 远程模式：`target?`（真实目标 URL，如 `http://lab-host:8080`）——与 routes 互斥
  - `engine?`（`real` 默认 / `mock` 进程内 scan port）；`expectedHits?`（mock 引擎断言命中集）
- **行为**：
  - 本地模式：**先 benign 无害反证**（有 hit = weak matcher 直接拒），再编程路由跑扫描
  - 远程模式：**confirm 确认后**用真实 nuclei 扫描授权目标（headless 会话拒跑，安全红线）；mock 引擎不可与远程组合
  - engine 解析：real 探测 nuclei（config tools.nucleiPath → PATH），不可用时给安装指引并提示 mock 备选；mock 用注入 expectedHits 的进程内 scan port（断言确定性，无二进制环境可用）
- **返回**：反证结论 / 命中列表 / mock 断言结果
- **何时用**：模板 lint 后的动态验证；本地 mock 优先，远程仅对授权测试环境

### poc_nuclei_sync

- **参数**：`resumeFrom?`（整数，跳过前 N 个文件——从任务快照续跑断点）
- **行为**：状态机驱动批量同步（扫描 → 逐文件 parse/lint/upsert → 封版）；断点快照（cursor）落 `sync_jobs` 表，中断后可 resume
- **返回**：synced/failed 数量、lint 聚合（有错误的文件数/检查总数）、封版摘要（版本/哈希前 16 位/计数）
- **何时用**：新增或修改模板后、search 前提；大批量中断后用 resumeFrom 续跑

### poc_nuclei_search

- **参数**：`query`（FTS 语法）；`severity?`、`protocol?` 过滤
- **行为**：bm25 加权检索（id 10 / tags 8 / cve 6 / product 5 / name 3 / desc 1）+ snippet 高亮
- **返回**：命中列表（id/severity/相对路径/摘要），最多 50 条
- **何时用**：写新模板前查重、找同类范例

### poc_nuclei_stats

- **参数**：`dimension`（severity/protocol/tags/cve/author/affected_product/duplicate_key）；`limit?`（Top-N，默认 15）
- **行为**：对封版索引做只读分析——总量+severity 分布、按维度 group-by（白名单列，zod 契约 `GroupByRow`）、cve 维度输出年份直方图、重复键计数
- **返回**：逐行 `count  key` 文本报告
- **何时用**：规则库摸底、覆盖率分析、写新模板前看同类分布

### /vf

- **行为**：openTemplatesRepo → db.stats（总数+按 severity 计数）+ 安全模式自检；模板仓缺失时显示 not found
- **何时用**：会话开始的状态检查

### /vf-debug

- **行为**：危险命令模式数量 + `rm -rf` 匹配自检
- **何时用**：安全模块调试
