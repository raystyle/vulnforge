# dev-system — 开发体系闭环研究笔记

研究主题：如何让 CLAUDE.md / rules / skills / hooks / 开发文档 / lint / 测试 / 研究文档 / 参考资源环环相扣，形成"动一处进化全局"的约束闭环。

## 先例（2026-11-26，gh-mcp 验证）

| 先例                                                          | 规模   | 机制                                                                                                                                | 采纳点                                                                                          |
| ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Thinkmill/manypkg](https://github.com/Thinkmill/manypkg)     | 1.0k★  | check 注册表：每条检查一个命名模块（`validate()` 返回类型化错误、`print()` 人类输出、可选 `fix()`），CLI 聚合跑全部，任一违规即失败 | system-lint 的结构：检查 = 小而命名的独立单元，新增关联 = 新增检查项                            |
| [JamieMason/syncpack](https://github.com/JamieMason/syncpack) | 2.1k★  | 单关注面（依赖版本）跨全部 package.json：从众数推导事实源，其余文件必须对齐；lint 与 fix 两种模式                                   | 单一事实源方向性：**事实从源头推导，派生物对齐源**，绝不反向                                    |
| [webpro-nl/knip](https://github.com/webpro-nl/knip)           | 12.7k★ | 从入口点（entry）可达性分析找未使用文件/导出/依赖                                                                                   | 状态机模块必须从工具面（src/index.ts）可达——窄域可达性检查                                      |
| product-on-purpose/pm-skills                                  | -      | 自研 git-grep 校验器（`check-count-consistency`、`validate-docs-frontmatter`）扫文档子树、自动跳过生成内容、进 CI                   | 自研定制校验器优于通用插件：我们的关联（门清单↔四文档、ADR↔索引、研究五件套）没有现成 lint 覆盖 |
| mocha → `@eslint/markdown`                                    | -      | markdown 结构 lint（标题/链接）插件化                                                                                               | 文档结构检查（重复段落/标题唯一性）纳入机械检查                                                 |

## 先例的坑

- manypkg 检查不可配置优先级 → 我们：检查分级沿用 REVIEW.md 思想（blocking / ratchet-floor 两档），ratchet 只升不降
- 通用插件（eslint-plugin-check-file、ls-lint）只管命名/结构，管不了**语义关联**（"README 工程纪律必须提状态机"）→ 语义关联必须自研正则/文本检查
- pm-skills 的校验器最初没跳过生成子树 → 误报淹没真问题；我们：无生成内容，但排除区（.reference/、node_modules/）要显式

## 结论（实测表明/先例显示）

1. "动一处进化全局"的实现机制 = **单一事实源 + 派生物机械对齐检查**：改正本 → lint 红 → 强制全局传播。事实源清单：`package.json scripts.check` = 检查门正本；`src/index.ts` = 工具面正本；`.ad_records/NNN-*.md` 文件 = ADR 正本（索引是派生）；`.research/<feature>/` 目录 = feature 正本（README 表是派生）。
2. 未完成的纪律（如状态机全工具覆盖）用 **ratchet 棘轮**：覆盖率底线常量，低于即 blocking，完成一项升一格——进化单向性。
3. lint 管机械关联；语义级一致（叙述是否过时）由 REVIEW.md 独立审查 + hook 观察提示兜底。
4. 检查器本身也要可测试：先跑出当前脱节清单（红），修复后（绿）——红绿即证据。

## 受控双语规范先例（2026-11-26，web + gh-mcp 验证）

| 先例/标准                                                                                                                   | 性质                 | 机制                                                                             | 采纳点                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [ASD-STE100 Issue 9](https://www.asd-ste100.org)（[Wikipedia](https://en.wikipedia.org/wiki/Simplified_Technical_English)） | 国际行业标准（航空） | ~65 条写作规则 + ~900 词受控词典；一词一义一词性；主动语态；一句一指令；指令句短 | 四原则骨架（一概念一术语/短句/一句一动作/可追溯）；受控词典 → 我们以术语表+代码标识符三态对齐替代 900 词表 |
| [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/)                                     | 业界风格指南         | "Use one term consistently to represent one concept"；术语控制跨注释与文档       | 一概念一术语的英文侧正本；Sentence case                                                                    |
| [ruanyf/document-style-guide](https://github.com/ruanyf/document-style-guide)（+ 中文文案排版指北、W3C 中文排版需求）       | 中文社区规范         | 标题层级、全半角标点、中英之间加空格、数值                                       | 中文排版细则来源                                                                                           |
| [errata-ai/vale](https://github.com/errata-ai/vale)                                                                         | 工具先例             | 语法感知 prose linter，可扩展 style 包，CI 集成                                  | 证明 prose lint 可自动化；我们的自定义关联仍自研（pm-skills 结论），Vale 列为未来通用英文检查备选          |

- 坑：STE 词典维护成本高（434 页 Issue 9）；我们不做通用受控英语，只锁**本项目领域术语**（状态机/检查门/模板仓/靶机/契约/封版）
- 坑：术语检查必须豁免"引用违例形式"的规则文档自身（docs-style.md 禁用列）与物理计算机语境（跨计算机/新计算机）——正则 + 例外表实现
- 实测表明：术语 lint 首跑即抓出 9 个中文文档 20 处近义词指代存量违例，修正后防回退

## 会话反哺闭环实证（2026-11-26 本会话数据）

- intent-trace 对本会话分析：117 文件 / 521 次修改 / 61 个独立用户 prompt，其中 19 个是修正/精炼型——修正模式密度 31%
- 实测表明：修正模式与本会话沉淀的规则一一对应——先例优先（→ /precedent skill）、SKILL 自包含去噪（→ skill-authoring.md）、ADR 独立目录（→ adr-docs.md）、运行时纪律（→ pi-extension.md）、术语铁律（→ docs-style.md）、轨迹边界（→ .claude/README.md 判据）——闭环验证成立
- 用法：`npm run intent-trace -- .claude/sessions/<id>.jsonl --limit N --file <substr>`

## 自省增量（13:37 后，审查与修复阶段）

- 规模：561-521=40 个新文件事件、29 次审查修复后修改（config.ts 7 连居首=findUp 信任边界 5 轮推演）、4 条用户指令、0 中断
- 修正模式：审查闭环形态（review→全修→单代理化→.review/ 归档）无返工——两代理 9 项发现一次全修通过三平台
- 实测表明：卡壳（同文件同意图 ≥3 连发）在本阶段只有 1 段（config.ts 信任边界推演），根因不是类型级联而是**安全语义设计**（planted config 与合法 workspace 文件系统同构）——属必要推演，非低效
- intent-trace.ts 自身 4 连改：正则控制字面量被 biome unsafe 修复反复破坏——教训候选：**工具脚本避免字面控制字符**（用 RegExp 构造），已在代码注释固化

## 改进动作与验证指标（按 /self-exam 流程裁定）

| 修正模式                              | 改进动作                      | 落点                          | 验证指标（下次自省对照）              |
| ------------------------------------- | ----------------------------- | ----------------------------- | ------------------------------------- |
| 术语近义词指状态机                    | lint 检查项                   | system-lint docs-terminology  | 违例数恒 0（已生效：修后多轮全绿）    |
| SKILL 带 ADR 噪音                     | rule                          | skill-authoring.md 自包含纪律 | 新 skill 无 ADR 编号/来源署名         |
| 研究顺序（reference→gh-mcp→web）      | rule/skill                    | /precedent 增检索顺序         | 我未按序检索即被纠正次数 = 0          |
| 历史轨迹散落                          | 边界 rule                     | .claude/README.md 轨迹边界    | rules/skills/README 出现轨迹段数 = 0  |
| 类型错误级联（38 段，最长 8 连发）    | **候选，待用户确认**          | pi-extension.md               | 确认后：同类卡壳最长连发 ≤3           |
| 工具脚本字面控制字符被 biome 反复破坏 | rule 候选（已在代码注释固化） | pi-extension.md 或 docs-style | 字面控制字符相关的 biome 修复轮次 = 0 |
| 会话归档缺增量                        | 代码修复                      | appendTail 字节偏移           | 重归档 mtime 不变（测试断言已覆盖）   |

## 全量对话自省（2026-11-26 会话全量数据）

- 规模：121 条用户指令 / 21 次中断 / 117 文件 521 次修改 / 61 个编辑关联 prompt
- 修正模式：流程纪律类 21 条、架构边界类 9 条、术语概念类 8 条——全部已晋级为规则/skill/lint（先例优先、ADR 边界、术语铁律、轨迹边界、tools 边界、状态机无豁免）
- 卡壳信号：同文件同意图连续编辑 ≥3 次的运行 38 段（最长 8 连发）——集中在类型错误级联（修一个 tsc 错 → 冒下一个）与格式循环
- 中断分布：04:00-07:00 区间 12 次（首功能攻坚期：路径/SQLite/同步），10:00 后 9 次多为新需求插入而非返工
- **未晋级教训候选**：类型错误级联——逐个修同文件类型错误产生 3-8 连发编辑；应先跑完整 tsc 收集全量错误清单、按文件分组一次改完（候选规则，待用户确认后进 pi-extension.md）

## 单步工具最小状态机

- `ToolExecutionMachine`（idle → START → executing → SUCCEED|FAIL → done|failed）+ `withToolMachine` 签名保持包装器：全部 9 个工具 execute 过状态机
- 坑：泛型包装器在 registerTool 上下文推断中丢失 ctx 类型 → 用 `<F extends fn>` 恒等返回类型 + `Parameters<F>` 传播（tsc 干净）
- 实测表明：7 项 pure 测试（转换路径 / 守卫拒绝未知事件 / 观察回调 / 包装器签名保持）三平台通过
