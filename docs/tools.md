# VulnForge Pi 工具与命令清单

扩展入口 `src/index.ts` 注册的全部工具面。Pi 会话中模型按需调用；本文档为完整参考，代码为准（由 contracts-lint 的工具清单检查防漂移）。

## 工具（registerTool）

| 工具               | 用途一句话                                             | 写操作                | 确认         |
| ------------------ | ------------------------------------------------------ | --------------------- | ------------ |
| `vf_env_check`     | 环境体检：三平台工具链 + 中国镜像 + 模板仓 + mock 端口 | 否（只读探测）        | —            |
| `vf_env_install`   | 修复一项环境缺失：跑 fix 命令 → 复检回告               | 是（安装软件/改配置） | confirm      |
| `vf_nuclei_new`    | 生成模板骨架写入模板仓                                 | 是（新文件）          | —            |
| `vf_nuclei_lint`   | 模板静态检查：YAML+结构/元数据/弱 matcher              | 否                    | —            |
| `vf_nuclei_edit`   | 契约化编辑（patch 或 content），编辑后自动 lint        | 是（改文件）          | —            |
| `vf_nuclei_run`    | 双模式验证：本地 mock 靶机 + 无害反证 / 远程目标扫描   | 否（远程需确认）      | 远程 confirm |
| `vf_nuclei_sync`   | 状态机批量同步 + lint 聚合 + 封版（断点可续）          | 是（写 db）           | —            |
| `vf_nuclei_search` | 元数据 FTS 全文检索                                    | 否                    | —            |
| `vf_nuclei_stats`  | 元数据分析：维度分组/年份直方图/查重                   | 否                    | —            |

## 命令（registerCommand）

| 命令        | 用途                                       |
| ----------- | ------------------------------------------ |
| `/vf`       | 状态总览：模板仓位置、索引统计、安全模式数 |
| `/vf-debug` | 内部状态：危险命令模式表与匹配自检         |

## 配置自动发现

所有 `vf_nuclei_*` 工具的定位规则：从会话工作目录向上查找**最近的 `.vulnforge.json`**，一次取齐 root / db / seal / sync 过滤。

- 嵌套 git clone 不阻断——语料目录（如 `nuclei-templates/`，自带上游 `.git`）内任意深度调用都能找到工作区配置
- 多层 `.vulnforge.json` 并存时就近优先
- 缺配置 = 诊断错误（起点 + 层数 + 内联最小配置示例），绝不静默

配置字段全量契约见 `docs/contracts/config-contracts.md`（db 文件名/封版记录、nuclei/yamllint 路径空值自动发现、sync 过滤 8 键含正则边界校验）。

## 逐项参考

### vf_env_check

- **参数**：无
- **行为**：检测 pi（版本对齐 `EXPECTED_PI_VERSION`）/ winget(win) / node / fnm / bun / uv / go（GO111MODULE+GOPROXY 镜像）/ rust（cargo+rsproxy 镜像）/ msvc(win) / zig / nuclei / yamllint / templates repo / mock target；托管根（ohmyenv）下的工具单独分组不算系统缺失
- **返回**：逐项 OK/MISSING + fix 指引；任一缺失则 isError
- **何时用**：环境验收、装完后复检、跨平台验证前置

### vf_env_install

- **参数**：`name: string`（项名，如 `fnm`、`rust`）
- **行为**：checkEnvironment → 取该项 fix 命令（平台命令矩阵）→ **confirm 后**经平台 shell 执行（win `cmd /d /s /c`，posix `bash -lc`）→ 复检并回告新状态
- **返回**：执行的命令、退出码、输出尾部、复检结果
- **何时用**：vf_env_check 报 MISSING 且用户同意安装

### vf_nuclei_new

- **参数**：`vulnType`（detect/rce/sqli/lfi/panel）、`name`、`author`、`severity`、`description`、`tags`、`cveId?`
- **行为**：生成五类骨架之一（matcher 带 proof 标记思想），按 cve/exposure/vulnerability 归目录写入模板仓；id 由 name 派生（kebab 折叠）
- **返回**：写入路径 + 完整骨架内容
- **何时用**：开始写新模板的第一步；之后模型编辑 matcher 与元数据

### vf_nuclei_lint

- **参数**：`path`（相对模板仓根）
- **行为**：三层检查——内置 TS yamllint（语法行列号/flow-style/空行/尾空格/注释间距）→ parseTemplateFile（zod 契约）→ lintDocument（结构/元数据/弱 matcher）；三层结果合报
- **返回**：逐条 `[level] rule (line N): message`；任何 error 则 isError
- **何时用**：模板编辑后、提交前

### vf_nuclei_edit

- **参数**：`path`；`patch?`（三选一判别：`{kind:"info", patch:{name?/author?/severity?/description?/tags?/reference?}}`、`{kind:"matcher", requestIndex?, matcherIndex, patch:{words?/regex?/part?/condition?/status?}}`、`{kind:"path", requestIndex?, paths[]}`）；`content?`（全文替换）——**patch 与 content 二选一**
- **行为**：YAML parse → 按补丁变更 → 重新序列化回写 → **自动 lint**（yaml 语法/风格 + 结构/弱 matcher），错误和警告随返回暴露；content 模式先过契约门（合法 yaml + 有 id + 有 name）才落盘，拒绝即不写
- **返回**：applied 字段清单、lint error 数、逐条 findings；有 error 则 isError
- **何时用**：模型改模板的规范路径——不绕过契约链直接手写文件

### vf_nuclei_run

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

### vf_nuclei_sync

- **参数**：`resumeFrom?`（整数，跳过前 N 个文件——从任务快照续跑断点）
- **行为**：状态机驱动批量同步（扫描 → 逐文件 parse/lint/upsert → 封版）；断点快照（cursor）落 `sync_jobs` 表，中断后可 resume
- **返回**：synced/failed 数量、lint 聚合（有错误的文件数/检查总数）、封版摘要（版本/哈希前 16 位/计数）
- **何时用**：新增或修改模板后、search 前提；大批量中断后用 resumeFrom 续跑

### vf_nuclei_search

- **参数**：`query`（FTS 语法）；`severity?`、`protocol?` 过滤
- **行为**：bm25 加权检索（id 10 / tags 8 / cve 6 / product 5 / name 3 / desc 1）+ snippet 高亮
- **返回**：命中列表（id/severity/相对路径/摘要），最多 50 条
- **何时用**：写新模板前查重、找同类范例

### vf_nuclei_stats

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
