# dev-system — result（累计）

## 2026-11-26 体系闭环（system-lint）

- 起因：三平台 Round 4b 全绿后，用户指出体系资产（rule/skill/hook/文档/研究/lint/测试）存在脱节，要求"动一处进化全局"的约束闭环。
- 先例结论（见 notes.md）：manypkg 检查注册表模式 + syncpack 单一事实源方向 + knip 可达性 + pm-skills 自研校验器。
- 实现：`tools/system-lint.mjs`，11 项检查（gate-docs-alignment / tools-md-surface / adr-index-alignment / research-feature-alignment / hook-watchlist-alignment / machines-wired / machine-rule-echoed / skill-shape / hook-shape / claude-md-current / test-tool-alignment），进 `npm run check`（第六项门）。
- **先红**：首跑 18 findings ——真实暴露的脱节：4 处文档未提新检查门、verify skill 门清单过期（只列 3 项）、README 工程纪律无状态机条款、CLAUDE.md 状态节 mojibake + 工具面清单过期（缺 edit/stats/sync）、engine-probe 与 mock-lifecycle 机器未接线（probeEngine 已写但 resolveScanPortForRun 仍用裸布尔判断）。
- **后绿**：修复 = 文档 4 处同步 + mock-client 接入 trackMockLifecycle（lifecycle 机器现在驱动 SpawnedMockTarget.phase）+ resolveScanPortForRun 经 probeEngine 判定 + CLAUDE.md 状态节重写。
- 命令：`node tools/system-lint.mjs` → `system-lint: all 11 checks pass`，退出码 0。
