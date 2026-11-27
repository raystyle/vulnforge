# dev-system — 同类项目 Claude Code 开发体系配置研究（2026-11-27，用户令：重点 loop 与 graph）

检索路径：gh-mcp（LoopForge 6.0k★ / maestro-flow 579★ / claude-code-showcase 6.1k★ / super-ralph / superpowers 系）+ 本地官方文档（agent-sdk/agent-loop.md）。四个体系实读完毕。

## 四体系分类学

| 体系                                        | 形态                                   | loop 实现                                                                                                                                                          | graph 实现                                                                                                                                                                                                           | 适用                                     |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Tencent/LoopForge**                       | 自托管平台（Go + Docker 沙箱 + MySQL） | **LOOP** = 节点图工作流（Agent/Script/Human-gate/Sub-LOOP/Preview 五种节点）；引擎按依赖完成度调度；失败边回退到指定步骤；暂停/恢复/重跑单节点                     | LOOP 即 graph：节点声明 artifacts + dependencies，引擎拓扑调度；分支 ready 即并行执行                                                                                                                                | 团队级交付（PR 全生命周期 + 审批门）     |
| **maestro-flow**                            | CLI + MCP + SQLite（TS，~80k 行）      | **Ralph v2**：意图分类到 40+ 命令链 + decision 节点动态决策（继续/回退/插修复循环）；**Odyssey** 长周期自主循环（数小时，checkpoint 自适应）；无 YAML——意图即路由  | **MaestroGraph 知识图谱**（SQLite + tree-sitter）：Spec/Knowhow 分层 + canonical ID + Run ledger 候选 + reconciliation receipt + 人工裁决后 promotion（"证据围栏知识编译器"）；搜索 BM25F + family/source cap 防集中 | 全生命周期编排 + 知识自增强              |
| **super-ralph**（Ralph + Superpowers 融合） | bash 基建 + skills 插件                | bash 主循环（限速/熔断/会话续接/双条件退出检测）+ 每轮注入方法论 system prompt；**RALPH_STATUS 结构化块**（STATUS/EXIT_SIGNAL/METHODOLOGY/SKILL_USED）驱动退出决策 | 无图——任务分类 → 技能链（FEATURE→brainstorm→plan→TDD；BUG→debugging→TDD）                                                                                                                                            | 单人长时自主（"endurance + discipline"） |
| **claude-code-showcase**                    | 纯 .claude/ 资产示范                   | 无自主循环——GitHub Actions 定时任务（月度 docs-sync/周度质量/双周依赖审计）做"维护 loop"                                                                           | 无图——**skill-eval hook**（UserPromptSubmit 上关键词/路径/意图模式匹配 + 置信度打分 → 建议激活 skill）                                                                                                               | 项目配置参考范本                         |

## loop 实现谱系（三条路线）

1. **引擎节点图型**（LoopForge）：loop = 声明式 DAG，节点有类型（agent/script/gate）、依赖、失败策略。人力在环（Human-gate 节点），可从任意节点重跑。**重**：需平台托管（Docker 沙箱 + 持久化）。
2. **意图路由 + 决策节点型**（maestro Ralph/Odyssey）：自然语言意图 → 命令链（40+ 种），链中 decision 节点按实际执行结果动态调整（回退/插修复循环）。**中**：CLI + 状态文件（.workflow/state.json + session status.json 持久化，`-c` 断点续跑）。
3. **bash 循环 + 结构化状态块型**（Ralph/super-ralph）：宿主循环套 `claude -p`，每轮读 fix_plan、分类任务、注入方法论 prompt、解析 RALPH_STATUS 决定继续/退出。**轻**：零平台，纯脚本 + 退出检测（双条件门：完成指标 + EXIT_SIGNAL）。

我们已有的对应物：**/goal + ScheduleWakeup**（动态自定步）与 **CronCreate 定时循环**就是路线 3 的官方内建形态；herdr 驱动的三平台 peer 轮是跨机变体。差距不在"有没有 loop"而在：① loop 的**退出判定**我们靠 goal 条件语义（弱结构化），super-ralph 的 RALPH_STATUS 块是更强的machine-readable 契约；② loop 的**断点持久化**（session status.json 断点续跑）我们靠会话续接天然获得。

## graph 实现谱系（两种正交用法）

1. **工作流图**（LoopForge LOOP）：节点 = 执行单元。价值 = 可视化编排 + 依赖并行 + 节点级重试/回退。
2. **知识图谱**（maestro MaestroGraph）：节点 = 知识条目（Spec/Knowhow），边 = 演进关系（supersede/conflict/related）。价值 = 知识防集中（family cap）、证据围栏（搜索曝光 ≠ 正确性 ≠ 写入权）、演进链保留（deprecated 不参与检索但可追溯）。

关键设计思想（maestro 知识系统，与我们体系最同构）：

- **四种事实分离**：搜索到（exposure）/ 使用过（consumed）/ 认为正确（validated）/ 允许写入（promotion eligibility）——自动发现关系但人裁决写入
- **receipt + freshness fence**：任何写入前有对账凭证，语料变了凭证即失效（fail closed）
- **Run ledger 候选机制**：Run 结束只暂存知识候选（propose/reaffirm/supersede/contest），不直接改知识库——与我们的"self-reflection 晋级 ≥2 次才入 rule"同思想，但更机械（candidate ID = 内容哈希，跨 Run 聚合 corroboration）
- **防正反馈**：曝光计数只影响一个 relevance-floored exploration slot，不进基础分——避免"越常命中越靠前"

## 对 VulnForge 开发体系的映射（我们已有 vs 可吸收）

| 体系能力             | 我们已有                                                   | 吸收候选（按价值排序）                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| loop：结构化退出状态 | /goal 条件 + 自省 skill（数据驱动但会话级）                | **结构化状态块**：长跑任务每轮输出 machine-readable 状态（STATUS/EXIT_SIGNAL/TESTS_STATUS），goal 判定从语义升级为契约                                                     |
| loop：断点续跑       | Claude 会话天然续接                                        | 不需要（平台已给）                                                                                                                                                         |
| loop：多 agent 编排  | herdr 子代理 + reviewer 代理 + peer 会话                   | LoopForge 的**角色定义**（prompt/executor/model/rules/skills/工具面按角色打包）——我们 reviewer.md 已是雏形，可补 roles/ 目录模式                                           |
| graph：工作流 DAG    | 无（人驱动阶段推进）                                       | 暂不需要——我们的 Research→Plan→Implement→Verify→Review 主闭环是纪律（rules/skills），不是引擎；上 DAG 会与人裁定节奏冲突（ADR 需用户确认才落笔是红线）                     |
| graph：知识图谱      | auto-memory（MEMORY.md 索引 + 文件）+ self-reflection 晋级 | **候选 corroboration**：自省的"未晋级教训候选"可仿 maestro——候选带内容哈希 ID，跨会话聚合，≥2 会话 corroborate 才晋级（现在靠人工记"≥2 次重复"，可机械化进 notes.md 结构） |
| 知识防集中           | 无                                                         | 搜索/注入不加权曝光——我们的 memory 无排名问题，暂不需要                                                                                                                    |
| 定时维护             | 无（showcase 的 GitHub Actions 定时巡检）                  | **可选**：月度 docs-sync 型定时任务（对齐文档与代码漂移）——system-lint 已静态执法，增量价值低，记候选不实施                                                                |
| skill 自动建议       | 无（语义匹配靠 description）                               | **skill-eval hook**（UserPromptSubmit 关键词/路径匹配 + 置信度）——我们 skill 数量少（6 个），语义触发够用；skill 超过 ~15 个时再上                                         |

## 结论

1. **loop**：我们的 /goal + ScheduleWakeup + self-reflection 已覆盖路线 3 的核心；最值得吸收的是**结构化状态块**（loop 退出判定从 goal 语义升级为machine-readable 契约，如 `TESTS_STATUS: PASSING | EXIT_SIGNAL: true`）——可进 self-reflection skill 的验证节，先记候选
2. **graph**：工作流 DAG 与我们"人裁定红线"冲突，不做；**知识图谱**的最小可吸收面是自省候选的 corroboration 机械化（跨会话 ≥2 次重复晋级——现在是人工规则）——进 self-reflection skill 的候选表结构化即可，不需要 SQLite/图引擎
3. **整体定位**：同类项目往"平台化"走（LoopForge 需 Docker 平台 + maestro 80k 行 CLI）是因为它们的循环/知识要**跨人共享**；我们是单人开发 + 三平台 peer，纪律型体系（rules/skills/hooks + lint 执法）成本最低——先例反而验证了我们的选型
4. 四体系共同铁律（我们已全有）：方法论进 skill 不散进 prompt、验证证据先于完成声明（verify skill 的先红后绿同 super-ralph 的 verification gate）、独立审查新上下文（reviewer 代理同 LoopForge 独立 review 节点）
