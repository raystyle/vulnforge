# .claude/ — 项目内 Claude 配置分工总纲

> 依据 Claude Code 官方机制（memory.md / skills.md / hooks.md）与 hvperv-harness 先例，四件核心资产各司其职：

| 资产                       | 职责                                                                                                                                             | 写入者         | 载入时机            | 本仓内容                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`../CLAUDE.md`**（仓根） | 项目常驻上下文：定位 + 红线 + 资产导航，只放"每个会话都要知道的事实"                                                                             | 人（用户定稿） | 每会话首载          | 项目定位 / 开发流程导航 / 纪律红线                                                                                                                                                      |
| **`rules/*.md`**           | 路径域规则：只在对应对径的文件被触及时才载入（省上下文）                                                                                         | 人             | 匹配 `paths` 时     | `pi-extension.md`（`src/**`/`tests/**`：Pi 扩展开发规则）/ `rust-lib.md`（`vf-rust-lib/**`：Rust 侧物化库规则）/ `adr-docs.md` / `skill-authoring.md` / `docs-style.md`（受控双语规范） |
| **`skills/<名>/`**         | 多步骤**过程**知识：按需载入（用户 `/` 调用或语义匹配），不常驻                                                                                  | 人             | 调用时              | `precedent/` / `adr/` / `verify/` / `self-reflection/`                                                                                                                                  |
| **`memory/`**              | 会话性状态 + 学习指针（可含历史轨迹）                                                                                                            | Claude（auto） | 每会话（首 200 行） | MEMORY.md 索引 + 各记忆文件                                                                                                                                                             |
| **`sessions/`**            | 会话归档：SessionEnd hook 镜像 transcript 到 `.claude/sessions/<id>.jsonl`（实体不进 git），INDEX.md 索引进 git；`claude --resume <path>` 可恢复 | hook（auto）   | 会话结束            | 会话记录（可含轨迹）                                                                                                                                                                    |
| **`plans/`**               | Plan Mode 落盘区（plansDirectory）；批准后归档 `.research/<feature>/plan-snapshot.md`                                                            | Claude         | 生成时              | 历史计划（可含轨迹）                                                                                                                                                                    |

辅助资产：

| 资产                | 职责                                                            | 写入者 | 本仓内容                                                                       |
| ------------------- | --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| **`settings.json`** | 权限 allowlist + hooks 配置                                     | 人     | pi/npm/vitest/git 常规操作 allowlist                                           |
| **hooks/**          | **确定性强制**：必须拦的动作，CLAUDE.md 只是约定、hook 才是闸门 | 人     | guard-dangerous.mjs / verify-evidence.mjs / archive-session.mjs / with-node.sh |
| **agents/**         | 独立审查代理（新上下文，未参与编写）                            | 人     | reviewer.md                                                                    |

## 会话反哺闭环

会话数据是体系进化的原料：

1. **归档**：SessionEnd hook 增量镜像 transcript 到 `.claude/sessions/`（全局 30 天清理后项目仍留底）
2. **分析**：`npm run intent-trace -- <transcript.jsonl>` trace 每个文件的修改意图轨迹（用户 prompt + thinking + 时间线）
3. **提炼**：从分析中识别修正模式（用户纠正/反复返工/纪律违规）
4. **晋级**：按 Miss→Rule 流程沉淀——出现 ≥2 次的模式进 rules/skill/hook；单次重大决定进 ADR；先例与证据进 .research

## tools/ 边界

`tools/` = 辅助项目开发、完善 Claude 开发体系的工具（lint / 校验 / 基准 / 会话归档 / 意图轨迹分析）；`src/` = 插件主体（Pi 扩展产品代码）。开发体系工具的实现与测试都归 tools/（含 *.test.ts，vitest include 已覆盖）。

## 判据（什么放哪）

- 每个会话都要的**事实** → CLAUDE.md；只对某类文件要的**规则** → rules（paths 域）
- **过程性**知识（步骤/流程）→ skill；**跨会话工作状态** → memory；**强制不可违反** → hook
- 决策/需求固化 → `.ad_records/`，memory 只留指针
- **历史轨迹边界**：ADR、PR（commit）、memory、plan 允许轨迹；rules/skills/CLAUDE.md/README/研究文档自包含无轨迹
