# dev-system — ship

## 交付事实

- `tools/system-lint.mjs`（14 项资产关联检查）为 `npm run check` 第七项门；先例依据与验证结论见 notes.md / result.md
- `.claude/rules/docs-style.md` 受控双语规范（术语表 / 句长 / 代码命名形），system-lint 机械执法
- `src/templates/tool-machine.ts` 最小状态机接入全部 9 个工具（无豁免规则闭环）
- 三平台验证全绿（Windows / lan-ubuntu / lan-mac，Round 6）

## 遗留项

- 语义级一致（叙述是否过时）不在 system-lint 范围，留 REVIEW.md 独立审查
- 术语表增删需用户确认（规则正本 docs-style.md）
- CI 未建（远程仓就绪，随时可加 main + PR 跑 `npm run check`）
