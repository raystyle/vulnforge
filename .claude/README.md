# .claude/ — 项目内 Claude 配置分工总纲

> 依据 Claude Code 官方机制（memory.md / skills.md / hooks.md）与 hvperv-harness 先例，四件核心资产各司其职：

| 资产                       | 职责                                                                                                                                             | 写入者         | 载入时机            | 本仓内容                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **`../CLAUDE.md`**（仓根） | 项目常驻上下文：定位 + 红线 + 资产导航，只放"每个会话都要知道的事实"                                                                             | 人（用户定稿） | 每会话首载          | 项目定位 / 开发流程导航 / 纪律红线                                                                                                |
| **`rules/*.md`**           | 路径域规则：只在对应对径的文件被触及时才载入（省上下文）                                                                                         | 人             | 匹配 `paths` 时     | `pi-extension.md`（`src/**`/`tests/**`：Pi 扩展开发规则）/ `adr-docs.md` / `skill-authoring.md` / `docs-style.md`（受控双语规范） |
| **`skills/<名>/`**         | 多步骤**过程**知识：按需载入（用户 `/` 调用或语义匹配），不常驻                                                                                  | 人             | 调用时              | `precedent/` / `adr/` / `verify/`                                                                                                 |
| **`memory/`**              | 会话性状态 + 学习指针（可含历史轨迹）                                                                                                            | Claude（auto） | 每会话（首 200 行） | MEMORY.md 索引 + 各记忆文件                                                                                                       |
| **`sessions/`**            | 会话归档：SessionEnd hook 镜像 transcript 到 `.claude/sessions/<id>.jsonl`（实体不进 git），INDEX.md 索引进 git；`claude --resume <path>` 可恢复 | hook（auto）   | 会话结束            | 会话记录（可含轨迹）                                                                                                              |
| **`plans/`**               | Plan Mode 落盘区（plansDirectory）；批准后归档 `.research/<feature>/plan-snapshot.md`                                                            | Claude         | 生成时              | 历史计划（可含轨迹）                                                                                                              |

辅助资产：

| 资产                | 职责                                                            | 写入者 | 本仓内容                                                 |
| ------------------- | --------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| **`settings.json`** | 权限 allowlist + hooks 配置                                     | 人     | pi/npm/vitest/git 常规操作 allowlist                     |
| **hooks/**          | **确定性强制**：必须拦的动作，CLAUDE.md 只是约定、hook 才是闸门 | 人     | guard-dangerous.mjs / verify-evidence.mjs / with-node.sh |

## 判据（什么放哪）

- 每个会话都要的**事实** → CLAUDE.md；只对某类文件要的**规则** → rules（paths 域）
- **过程性**知识（步骤/流程）→ skill；**跨会话工作状态** → memory；**强制不可违反** → hook
- 决策/需求固化 → `.ad_records/`，memory 只留指针
- **历史轨迹边界**：ADR、PR（commit）、memory、plan 允许轨迹；rules/skills/CLAUDE.md/README/研究文档自包含无轨迹
