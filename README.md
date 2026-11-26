# VulnForge

**基于 Pi Agent 的漏洞挖掘与 PoC/Exploit 锻造套件。** [English](README_EN.md)

VulnForge 是 [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的扩展包（`pi-package`）：把 nuclei 模板的**编写、lint、本地 mock 靶机验证、元数据入库检索**做成一条龙定制工具，让 Agent 快速、自动、稳定地开发和管理漏洞检测规则。

## 功能

- **模板一条龙**：骨架生成（`vf_nuclei_new`）→ lint（结构/元数据/弱 matcher 检查，`vf_nuclei_lint`）→ 本地 mock 靶机验证 + 无害反证（`vf_nuclei_run`）→ SQLite 元数据同步/全文检索/查重（`vf_nuclei_sync` / `vf_nuclei_search`）
- **环境体检与安装**：`vf_env_check` 三平台（Windows/Linux/macOS）检测工具链与中国镜像源配置；`vf_env_install` 按平台命令矩阵安装缺失项（执行前确认，装后复检）
- **品牌契约**：全部领域值经 zod 契约化（`.brand<>()`），`brand-lint` 强制检查入 CI 门禁
- **测试**：真实 nuclei 二进制 + 可编程 mock 靶机端到端验证；mock-nuclei CLI 确定性测试调用方代码

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
