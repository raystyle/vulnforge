# plans/ — Claude 原生 Plan Mode 落盘区（plansDirectory）

Claude 生成随机文件名落盘于此；批准后由 `/adr` 流程按 feature 归档：

1. Plan 获批准（ExitPlanMode）
2. 实现启动时确定 feature 名
3. 拷贝为 `.research/<feature>/plan-snapshot.md`（正本），本目录原件可删

进 git（可审查、跨机器同步）；优于默认 `~/.claude/plans`（跨项目混杂、不可追溯）。

已归档：nuclei-rules.md → .research/nuclei-rules/plan-snapshot.md
