# dev-system — result（累计）

## 2026-11-26 体系闭环（system-lint）

- 起因：三平台 Round 4b 全绿后，用户指出体系资产（rule/skill/hook/文档/研究/lint/测试）存在脱节，要求"动一处进化全局"的约束闭环。
- 先例结论（见 notes.md）：manypkg 检查注册表模式 + syncpack 单一事实源方向 + knip 可达性 + pm-skills 自研校验器。
- 实现：`tools/system-lint.mjs`，11 项检查（gate-docs-alignment / tools-md-surface / adr-index-alignment / research-feature-alignment / hook-watchlist-alignment / machines-wired / machine-rule-echoed / skill-shape / hook-shape / claude-md-current / test-tool-alignment），进 `npm run check`（第六项门）。
- **先红**：首跑 18 findings。真实脱节：4 处文档未提新检查门；verify skill 门清单过期（只列 3 项）；README 工程纪律无状态机条款；CLAUDE.md 状态节 mojibake；工具面清单过期（缺 edit/stats/sync）；engine-probe 与 mock-lifecycle 状态机未接线。
- **后绿**：修复 = 文档 4 处同步 + mock-client 接入 trackMockLifecycle（lifecycle 状态机现在驱动 SpawnedMockTarget.phase）+ resolveScanPortForRun 经 probeEngine 判定 + CLAUDE.md 状态节重写。
- 命令：`node tools/system-lint.mjs` → `system-lint: all 11 checks pass`，退出码 0。

## 2026-11-26 三平台 Round 5（d3a1a79）

| 平台         | system-lint | vitest                       | 全门      |
| ------------ | ----------- | ---------------------------- | --------- |
| Windows 主机 | 11/11       | 92 passed / 9 skipped (101)  | ✅ exit 0 |
| lan-ubuntu   | 11/11       | 89 passed / 12 skipped (101) | ✅ exit 0 |
| lan-mac      | 11/11       | 89 passed / 12 skipped (101) | ✅ exit 0 |

- 三平台确认 system-lint 处于 contracts-lint 与 vitest 之间、纯文本+fs 无平台分支；mock-client 生命周期状态机接线与 probeEngine 接线在三平台编译并通过（状态机测试在 89 passing 内）
- vitest 差异为环境性：Windows 有 workspace（e2e 9 项跑）+ nuclei；两 peer 无 workspace/nuclei（对应 SKIP，显式非静默）
- linux 报告：无新增 Linux-only 问题，EOL 统一 LF，node_modules 无需变更；mac 报告：树干净无残留
