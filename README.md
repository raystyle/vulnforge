# VulnForge

**基于 Pi Agent 的漏洞挖掘与 PoC/Exploit 锻造套件。** [English](README_EN.md)

VulnForge 是 [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的扩展包（`pi-package`）：把 nuclei 模板的**编写、lint、本地 mock 靶机验证、元数据入库检索**做成一条龙定制工具，让 Agent 快速、自动、稳定地开发和管理漏洞检测规则。

## 功能

**nuclei 模板一条龙**（工具逐个，全量参考见 docs/tools.md）：

- **骨架生成** — `poc_nuclei_new`：按五类漏洞模式（detect/rce/sqli/lfi/panel）生成模板骨架写入模板仓，id 由名称派生
- **静态检查** — `poc_nuclei_lint`：内置 TS yamllint（语法/风格）+ zod 契约解析 + 结构/元数据/弱 matcher 检查
- **契约化编辑** — `poc_nuclei_edit`：结构化 patch（info/matcher/path）或全文替换，编辑后自动 lint，非法编辑拒绝落盘
- **本地靶机验证** — `poc_nuclei_run`：起可编程 mock HTTP 靶机跑真实 nuclei；先做无害反证（对通用无害页任何命中 = weak matcher，直接拒绝）；支持远程授权目标（confirm 门）
- **元数据同步** — `poc_nuclei_sync`：事件驱动状态机批量入库（配置驱动 include/exclude 目录/文件/正则），断点续跑，封版记录
- **检索查重** — `poc_nuclei_search`：FTS5 全文检索（bm25 权重）+ 同键查重
- **统计分析** — `poc_nuclei_stats`：severity/protocol/tags/cve/author 七维 group-by + CVE 年份直方图 + 重复键报告

**环境体检与安装**：

- `vf_env_check` — 三平台（Windows/Linux/macOS）逐项检测：pi 版本对齐、fnm/bun/uv、go（GOPROXY 镜像）、rust（rsproxy 镜像）、MSVC、zig、nuclei、yamllint、模板仓、mock 端口
- `vf_env_install` — 按平台命令矩阵（winget/brew/apt/官方发行版）安装缺失项，执行前确认、装后复检

**配置自动发现（零硬编码）**：

- 所有模板工具在任意子目录操作时**自动向上查找最近的 `.vulnforge.json`**——从语料深处（如 `nuclei-templates/http/cves/...`）直接调用即可，嵌套 git clone 不阻断（上游语料自带 `.git` 也能找到工作区配置）
- 配置定义 db 文件名/封版记录、nuclei/yamllint 路径（空 = 自动发现）、同步过滤 8 键（语料子目录、include/exclude 目录/文件/正则）
- **缺配置不静默**：报诊断错误（搜索起点 + 层数 + 内联最小配置示例，装好的插件无需翻仓库文档）
- **错误信封（智能体自纠偏）**：一切工具失败原子暴露 `vf-error code=<稳定码>` + detail + hint 三行——按错误码分支纠偏，无需解析散文

```json
{
  "db": { "filename": "templates.db", "sealFile": "templates-lock.json" },
  "tools": { "nucleiPath": "" },
  "sync": { "corpusDir": "nuclei-templates" }
}
```

**工程纪律**：

- **品牌契约**：全部领域值经 zod 契约化（`.brand<>()`），brand-lint 静态扫描强制入检查门
- **事件驱动状态机**：所有工具执行逻辑（含单步请求-响应）一律 XState 状态机表达，转换只由事件触发，编译期穷尽守卫（新事件未处理 = tsc 失败）；状态机必须接线到工具面，死状态机 = lint 违规
- **契约文档**：每个导出契约符号必须在 docs/contracts/ 有文档，contracts-lint 机械核查
- **七项检查门**：biome → tsc → brand-lint → contracts-lint → system-lint → vitest → pi 加载检查
- **体系一致性 lint**：system-lint 核查资产关联（检查门清单↔文档、ADR↔索引、研究目录↔五件套、状态机可达性、工具面↔文档↔测试），任一脱节即失败——动一处、全局强制传播
- **测试分层**：pure / smoke / runtime（真实 nuclei + mock 靶机端到端）/ load 四层；进程内 mock ScanPort 确定性测试调用方代码（零外部依赖）

## 环境要求

**核心必装**：

- Node.js >= 22.19（推荐 [fnm](https://github.com/Schniz/fnm) 管理）
- [Pi coding agent](https://github.com/earendil-works/pi-coding-agent)（版本与扩展对齐，检查项含版本核对）

**模板工作链**：

- nuclei：`go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`
- Go 工具链（官方发行版 + `GOPROXY=https://goproxy.cn,direct`）
- yamllint：`uv tool install yamllint`

**开发工具链**（`vf_env_install` 可按平台自动安装，见下）：

- fnm / [bun](https://bun.sh) / [uv](https://docs.astral.sh/uv/)——运行时策略：bun + uv + node
- Rust（rustup + rsproxy.cn 镜像）/ MSVC Build Tools（Windows）/ Zig（可选跨编译）
- 中国镜像源：npm/bun（npmmirror）、pip/uv（tuna）、cargo（rsproxy）、rustup（rsproxy）、fnm node dist（npmmirror）

**一键体检**：安装扩展后在 Pi 会话里让 Agent 调用 `vf_env_check`——三平台逐项检测并给修复命令，`vf_env_install` 确认后代装。

## 试用（不安装）

```bash
pi -e /path/to/vulnforge
```

## 安装

```bash
pi install /path/to/vulnforge
# 或仅当前项目：
pi install /path/to/vulnforge -l --approve
```

安装后在 Pi TUI 内执行 `/reload` 热重载。

## 开发

```bash
npm install
npm run check   # biome → tsc → brand-lint → vitest → pi 加载检查
```

开发体系（主闭环、审查、决策跟踪）见 `CLAUDE.md`；数据模型契约见 `docs/contracts/`。

## 许可

MIT
