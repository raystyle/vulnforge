---

name: work-state
description: VulnForge 工作状态（2026-11-26 深夜）：首功能已交付+三平台 Round 5 验证中；开发体系闭环（system-lint 第六门）落地 d3a1a79
metadata:
node_type: memory
type: project
originSessionId: d8cd2140-8dfa-43c0-8e0b-a189c6c104d9
modified: 2026-11-26T12:09:00.054Z
---

# VulnForge 工作状态（2026-11-26 深夜）

**首功能（nuclei 模板一条龙）已交付**（ADR-003）：模板仓 `vulnforge-workspace`（上游 nuclei-templates + 封版 templates.db 14475 行），9 工具 + 2 命令。三平台 Round 4b 全绿（ae9a378：跨平台 e2e 门控 + with-node.sh hook 修复）。

**开发体系闭环已落地**（d3a1a79，用户要求"动一处进化全局"）：

- `tools/system-lint.mjs` 第六检查门：11 项资产关联核查（gate 清单↔四文档、工具面↔tools.md↔测试、ADR↔索引、研究五件套、状态机可达性棘轮=3、hook 监视表、skill/hook 形状、CLAUDE.md 状态面）——manypkg 式 check 注册表 + knip 式可达性（先例依据在 `.research/dev-system/notes.md`）
- 真脱节修复：engine-probe 接入 resolveScanPortForRun；mock-lifecycle 驱动 SpawnedMockTarget.phase；verify skill 门清单更新；CLAUDE.md mojibake 状态节重写；docs/tools.md 重复段删除
- Round 5 三平台验证进行中（d3a1a79）：mac 已全绿（system-lint 11/11），linux 报告待回

**How to apply:**

- 改检查门/工具面/资产结构 → system-lint 会强制同步派生文档；红时修派生物，不删检查
- Round 5 linux 报告到达后：result.md 补证据、报告用户三平台闭环完成
- 遗留（ship.md）：单步工具最小状态机逐台补齐（每补一台升 ratchet 底线）；reviewer/security-reviewer 独立审查 nuclei feature 未跑
- 实战教训（勿回退）：execFile Windows 死锁→spawnCollect；WAL seal/verify 先 checkpoint；状态机接线检查=从 src/index.ts + tools/*.mjs 入口可达性遍历（`./` 前缀要剥）
- ADR 纪律见 [[feedback-adr-scope]]：起草→用户确认→写入
