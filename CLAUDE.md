# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**VulnForge — 基于 Pi Agent 的漏洞挖掘与 PoC/Exploit 锻造套件**。

以 [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) 扩展包（`pi-package`）形式实现。主开发机 Windows（`D:\repos\vulnforge`），**三平台运行**：Windows 本机 + Linux/Mac 兄弟工作台（lan-ubuntu、lan-mac 的 `~/repos/vulnforge`，herdr `peer-linux`/`peer-mac`）做双向同步验证。项目本身用 Claude Code 开发。

## 项目内 Claude 配置分工

职责表与"什么放哪"判据见 **`.claude/README.md`**（必读）：

- **CLAUDE.md**（本文件）：每会话必备事实——定位、红线、导航
- **`.claude/rules/`**：路径域规则（`pi-extension.md` 管 src/tests；`adr-docs.md` 管 adr/docs；`skill-authoring.md` 管 skills）
- **`.claude/skills/`**：过程知识（`/precedent` 先例搜索；`/adr` ADR 登记；`/verify` 验证）
- **`.claude/memory/`**：项目记忆（Claude 自维护，经 `settings.local.json` 的 `autoMemoryDirectory` 指向仓内）

## 纪律红线（每个会话都要遵守）

- **ADR 只记用户决定**：每条 ADR 必须经用户确认后写入 `.ad_records/`；Claude 只起草，不擅自落笔。参考资料不记为需求。
- **新需求先搜先例**：gh-mcp 搜同类实现 → 研究先例的错误与 bug → 再设计；深入分析可 clone 到 `.reference/`（流程见 `/precedent` skill）。
- **品牌契约默认必用**：领域值（ID/枚举语义/路径/版本）一律 zod + `.brand<>()`；校验前置边界，内部免检；裸 `string` 传领域值、`as` 逃避检查、`String()` 强转契约字段是违规。
- **安全约束（Pi 无沙箱）**：扩展代码与用户同权限——危险命令（网络/删除/进程）必须拦截确认；敏感操作写独立日志审计；开发测试在 VM/容器中跑目标服务。
- **语言约定**：文档中文；代码标识符、注释、commit message 英文。
- **资产自包含**：CLAUDE.md / rules / skills / REVIEW.md 不写来源署名、ADR 编号、历史轨迹——面向无上下文的读者，直接可执行。

## 开发流程导航

- **主闭环**：Research → Plan（人工批准）→ Implement（TDD+worktree）→ Verify → 独立审查 → Ship；失败回路 ≤3 轮。产物链落 `.research/<feature>/`（进 git）。
- **审查**：规则正本根目录 `REVIEW.md`（三档分级，从 main 读取）；审查代理 `.claude/agents/reviewer.md` + `security-reviewer.md`（新上下文、未参与编写）
- **决策跟踪**：`.ad_records/`（需求/进度状态/最终产物/是否满足四节，索引见 `.ad_records/README.md`）
- Pi 扩展开发规则、检查门 `npm run check`、四层测试、调试循环 → **`.claude/rules/pi-extension.md`**（改 src/tests 时自动载入）
- 参考资料区：`.reference/`——只读，不进 git

## 当前状态

- 首功能（nuclei 模板一条龙）实现中：**当前任务 = 针对 projectdiscovery/nuclei-templates 上游做规则工作**（工作区 D:
  eposulnforge-workspace）：模板仓 `D:\repos\vulnforge-workspace`、Pi 工具面（lint/run/sync/search/new/env_check/env_install）
- 跨平台验证工作台：lan-ubuntu、lan-mac（herdr `peer-linux`/`peer-mac`）
- 云端仓 github.com/raystyle/vulnforge（已建，main 推送中）
