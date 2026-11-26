---

name: work-state
description: VulnForge 工作状态（2026-11-26）：首功能交付 + 体系闭环/受控双语规范落地；三平台七项门全绿（Round 6）
metadata:
node_type: memory
type: project
originSessionId: d8cd2140-8dfa-43c0-8e0b-a189c6c104d9
modified: 2026-11-26T12:43:40.747Z
---

# VulnForge 工作状态（2026-11-26 深夜）

**首功能（nuclei 模板一条龙）已交付**（ADR-003）：模板仓 `vulnforge-workspace`（上游 nuclei-templates + 封版 templates.db 14475 行），9 工具 + 2 命令。

**开发体系闭环轨迹**（ADR-002，详见 `.research/dev-system/`）：

- Round 1-3：体系骨架三平台基线全绿（ADR-002 Git 流程节记录）
- Round 4/4b（ae9a378）：修复 e2e 硬编码 D:/ 路径 + macOS hook node 缺失（with-node.sh 包装）
- Round 5（d3a1a79）：system-lint 11 项检查进第六门；engine-probe/mock-lifecycle 状态机接线
- Round 6（e4e23d0 + 3387d0e）：受控双语规范（docs-style.md + docs-terminology/docs-sentence-length/code-naming，14 项检查）；ToolExecutionMachine 接入全部 9 个工具（无豁免闭环）
- 三平台七项检查门全绿（Windows 99+9 / ubuntu 96+12 / mac 96+12，共 108）

**How to apply:**

- 改检查门/工具面/资产结构 → system-lint 强制同步派生文档；红时修派生物，不删检查
- 历史轨迹边界（用户决定）：ADR、PR（commit）、memory、plan 四处可留轨迹；rules/skills/README/CLAUDE.md/research 结果文档自包含
- 遗留：implement/ship skills、CI、nuclei feature 的 reviewer/security-reviewer 独立审查、单步工具逐台精化
- 实战教训（勿回退）：execFile Windows 死锁→spawnCollect；WAL seal/verify 先 checkpoint；泛型包装器用恒等返回类型保 ctx 推断；`./` 前缀在可达性解析要剥
- ADR 纪律见 [[feedback-adr-scope]]：起草→用户确认→写入
