# .research/ — 研究知识库

**定位**：先例、验证、证据、结论——**不含 plan**（计划是执行安排，归 `.claude/plans/` 与 `.ad_records/`）。每个 feature 一个自洽目录；进 git；`evidence/` 只留关键文件。

## 目录结构（规范）

```
.research/
└── <feature>/
    ├── notes.md            # 研究笔记：先例发现、坑、结论（/precedent 产出）
    ├── <专题研究>.md        # 深入研究（引擎研究、语料分析等，随需增补）
    ├── evidence/           # 验证证据：测试 verbose 日志、先红后绿记录、输出截图
    ├── result.md           # 结论：跑了什么、退出码、测试数、审查结论、回路记录
    └── ship.md             # 交付事实：验证戳、commit 清单、遗留项（不含计划性内容）
```

## 与 plan / ADR 的分工对齐

| 文档                                                          | 回答的问题                                                       | 归属   |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| **plan**（`.claude/plans/` → 批准后 `.ad_records/` ADR 引用） | "将要做什么、怎么做、分几步"——执行安排                           | 计划域 |
| **research**（本库）                                          | "先例怎么做、我们验证了什么、证据是什么、结论是什么"——知识与事实 | 研究域 |
| **ADR**（`.ad_records/`）                                     | "用户决定了什么、需求满足没有"——决策与验收                       | 决策域 |

三者对齐规则：

- research 的**结论**（result.md）必须可回溯到需求条目：feature 名 = ADR 编号关联（如 nuclei-rules ↔ ADR-003）
- research **不重复 plan 内容**：实现步骤、批次安排属计划域，research 只记录"研究后发现的事实"（如"execFile 在 Windows 死锁"）
- research **不预设决策**：ADR 是用户决定；research 只提供决策依据（先例、数据、风险），结论措辞以"实测表明/先例显示"开头，不用"应该/决定"
- ship.md 的遗留项**回填** ADR 进度表（ADR 引用 research 证据，research 不引用 ADR 决策）

## 流程绑定

- **/precedent 优先检索本库**：接手新需求先查 `.research/<feature>/notes.md`，防重复研究
- **Miss→Rule 晋级**：教训先记 `notes.md`；≥2 次重复晋级 REVIEW.md/rules（经用户确认）
- **ship 后闭链**：ship.md 落盘 = feature 收口；遗留项回填 ADR 进度表

## 既有 feature

| feature                       | 状态              | 证据链                                                          |
| ----------------------------- | ----------------- | --------------------------------------------------------------- |
| [nuclei-rules](nuclei-rules/) | 已交付（ADR-003） | ✅ notes + 2 份专题 + evidence + result + ship（plan 归计划域） |
| [dev-system](dev-system/)     | 进行中（ADR-002） | notes（先例：manypkg/syncpack/knip）+ result 累计中             |
