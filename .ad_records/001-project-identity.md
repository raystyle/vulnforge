# ADR-001 | 项目定位：VulnForge

- 日期：2026-11-26
- 状态：已完成

## 需求

确定项目名字与意义：**VulnForge — 基于 Pi Agent 的漏洞挖掘与 PoC/Exploit 锻造套件**。以 Pi coding agent 扩展包（`pi-package`）形式实现，运行于 Windows 本机（`D:\repos\vulnforge`），项目本身用 Claude Code 开发。

配套需求：

- 语言约定：文档中文；代码标识符、注释、commit message 英文
- 先例研究是工作方式：新需求先搜先例（gh-mcp → 研究先例错误与 bug → 再设计；深入分析 clone 到 `.reference/`，流程见 `/precedent` skill）
- 产品定位决定安全姿态：扩展代码按攻击者研究目标对待，安全红线见 `.claude/rules/pi-extension.md`

## 进度状态

无剩余待办。

## 最终产物

| 产物                         | 路径                                |
| ---------------------------- | ----------------------------------- |
| 常驻上下文（定位+红线+导航） | `CLAUDE.md`                         |
| 先例搜索流程 skill           | `.claude/skills/precedent/SKILL.md` |
| 安全红线细则                 | `.claude/rules/pi-extension.md`     |

## 是否满足需求

**满足**。CLAUDE.md 概述、语言约定、先例流程均已按定位落地并被后续开发引用；用户在本会话及后续建设中持续沿用未提出异议。
