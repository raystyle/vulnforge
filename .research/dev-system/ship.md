# dev-system — ship

- 2026-11-26 体系闭环交付：`tools/system-lint.mjs`（11 项资产关联检查）进 `npm run check` 第六门；先红（18 findings，含 2 台死状态机真脱节）后绿记录见 result.md；manypkg/syncpack/knip 先例依据见 notes.md。
- 三平台注意：system-lint 只读文本与目录结构，无平台差异分支；三平台 Round 5 验证时与 vitest 一并跑。

## 遗留项

- 单步工具（lint/edit/search/stats/new/env_check/env_install）尚未各配最小状态机（idle→executing→done/failed）——当前 ratchet 底线 3 台（sync/engine-probe/mock-lifecycle）全接线；补一台升一格底线。
- machine-rule-echoed 只查 README 提及状态机纪律；CLAUDE.md 红线节的状态机表述未纳入检查（正文语义级一致留给 REVIEW 独立审查）。
