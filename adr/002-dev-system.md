# ADR-002 | Claude Code 开发体系

- 日期：2026-11-26
- 状态：实施中（主体已落地；git init 前置项未完成）

## 需求

用 Claude Code 开发 VulnForge，建立完整的开发体系，含七个子需求：

1. **四资产分工**：CLAUDE.md（每会话事实，<200 行）/.claude/rules/（路径域规则）/.claude/skills/（过程知识）/.claude/memory/（会话状态+学习指针，仓内化经 settings.local.json）
2. **开发主闭环**：Research → Plan（人工批准）→ Implement（TDD+worktree）→ Verify → 独立审查 → Ship；失败回路 ≤3 轮；产物链落 `.research/<feature>/`（进 git）
3. **Verify 证据**：check 门退出码 0 + 测试数非零 + 新测试先红后绿 + verbose 落盘 evidence/；SKIP 显式报告；断言基于退出码绝不 grep 计数
4. **独立审查**：reviewer + security-reviewer 代理（新上下文）；规则正本 `REVIEW.md` 从 main 读取，三档分级（Always blocking / Report even though / Never report）
5. **Pi 扩展标准流程**：包形态（peer `"*"` + dev 钉版本 + legacy-peer-deps + node ≥22.19）；检查门 `npm run check` = biome + tsc + vitest + pi 加载检查；测试四层（pure/smoke/runtime/load）；调试三循环
6. **编码规范与安全**：TS strict/NodeNext/ES2022；Biome 2 空格行宽 120；依赖 KISS/YAGNI；产品侧安全五红线（危险命令 askFirst 拦截、不可信输入、密钥环境变量、审计日志、VM/容器测试）
7. **Skill 编写规范（agentskills.io 标准）**：目录 = frontmatter name；description 含 Use when；脚本自包含（uv/PEP 723、Bun 版本化 import）、禁交互、stdout JSON；SKILL.md < 500 行细节下沉 references/；渐进式披露

另含 Git 流程（SemVer 0.y.z + Keep a Changelog、main 直提 + feat/fix 短命分支、Conventional Commits、worktree 隔离、不用 Changesets）与 ADR 管理纪律（用户确认后写入）。

## 进度状态

| 子需求        | 状态                    | 剩余                                                                     |
| ------------- | ----------------------- | ------------------------------------------------------------------------ |
| 1 四资产      | ✅ 完成                 | —                                                                        |
| 2 主闭环约定  | ✅ 完成（约定层）       | implement/ship skills 未建                                               |
| 3 Verify 证据 | ✅ 完成                 | —                                                                        |
| 4 独立审查    | ✅ 完成                 | main 分支待 git init（现降级读工作区）                                   |
| 5 Pi 标准流程 | ✅ 完成（骨架验证通过） | runtime 测试层、真实模型验收脚本                                         |
| 6 编码+安全   | ✅ 完成                 | 产品侧五红线随功能逐条实现                                               |
| 7 Skill 规范  | ✅ 完成                 | 现有 3 skill 补 compatibility 字段                                       |
| Git 流程      | ✅ 规则就绪             | **git init + 首次提交（用户指示放最后）**                                |
| hooks 闸门    | ❌ 未建                 | Stop hook（证据检查）、PreToolUse hook（危险命令拦截）——均待 git init 后 |
| CI            | ❌ 未建                 | main + PR 跑 `npm run check`——待建远程仓后                               |

### 主闭环环节验收

| 环节      | 机制                                                   | 现状                                                 |
| --------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Research  | `/precedent` skill（.research 优先 → gh-mcp → clone）  | ✅ 就绪                                              |
| Plan      | Plan Mode 人工批准 → `.research/<feature>/plan.md`     | ✅ 约定就绪（Claude Code 原生功能）                  |
| Implement | TDD 一次一测 + worktree 隔离                           | ⚠️ 约定就绪；implement skill 未建（git init 后）     |
| Verify    | `/verify` skill：四门退出码 + 先红后绿 + evidence 落盘 | ✅ 就绪                                              |
| 独立审查  | reviewer + security-reviewer（规则从 main 读）         | ✅ 就绪（main 分支待 git init 才存在，降级读工作区） |
| Ship      | commit 验证戳（observe）                               | ⚠️ 约定就绪；ship skill 未建（git init 后）          |
| 知识沉淀  | `.research/` 进 git + Miss→Rule 晋级 REVIEW.md         | ✅ 约定就绪                                          |
| 回路      | 失败 ≤3 轮超限人工                                     | ✅ 约定就绪（verify skill 内置）                     |
| 强制闸门  | Stop hook（证据检查）+ PreToolUse hook（危险命令）     | ❌ 待 git init 后建                                  |

## 最终产物

| 产物       | 路径                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 四资产全套 | `CLAUDE.md`、`.claude/README.md`、`.claude/rules/`（4 文件：pi-extension / adr-docs / skill-authoring）、`.claude/skills/`（3 skill）、`.claude/memory/`、`.claude/settings.json` + `settings.local.json` |
| 审查体系   | `REVIEW.md`、`.claude/agents/reviewer.md`、`.claude/agents/security-reviewer.md`                                                                                                                          |
| 产物库约定 | `.research/README.md`                                                                                                                                                                                     |
| 代码骨架   | `src/index.ts`（/vf-debug 命令）、`src/safety.ts`（危险命令匹配）                                                                                                                                         |
| 测试       | `tests/safety.pure.test.ts`、`tests/index.smoke.test.ts`（5 用例）                                                                                                                                        |
| 检查门     | `npm run check` 四合一（`package.json` + `scripts/pi-load-check.mjs`）                                                                                                                                    |
| 变更记录   | `CHANGELOG.md`                                                                                                                                                                                            |
| ADR 体系   | `adr/` 独立目录（README 索引 + 单文件四节格式）                                                                                                                                                           |

## 是否满足需求

**主体满足，Git 流程与 hooks 子需求未完成**（git init 待用户指令；implement/ship skills 与 hooks 依赖 git init）。

验证证据（2026-11-26）：`npm run check` 退出码 0——biome 30 文件无违规 / tsc 无错误 / vitest 5/5 / pi load passed；测试先红后绿实证两个死模式（`"format "` 尾随空格 trim 后永不匹配、`"wget -qO-"` 大写 toLowerCase 后永不匹配）被纯层测试当场抓获修复。

待 git init 后补齐剩余项方可整体判定满足。
