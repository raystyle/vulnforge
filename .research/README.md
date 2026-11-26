# .research/ — 产物知识库

每个 feature 一个**自洽目录**：计划、研究、证据、结果、交付全部归属 feature 目录内，不跨目录平铺。进 git；`evidence/` 只留关键文件，超大日志先裁剪。

## 目录结构（规范）

```
.research/
└── <feature>/
    ├── notes.md            # 研究笔记：先例发现、坑、结论（/precedent 产出）
    ├── plan-snapshot.md    # Plan Mode 人工批准后的计划快照（本目录归档版）
    ├── <专题研究>.md        # 深入研究（引擎研究、语料分析等，随需增补）
    ├── evidence/           # 验证证据：测试 verbose 日志、先红后绿记录、输出截图
    ├── result.md           # 结果：跑了什么、退出码、测试数、审查结论、回路记录
    └── ship.md             # 交付记录：验证戳内容、commit、遗留项
```

## 流程绑定

- **Plan 归属 feature**：`plansDirectory`（`.claude/settings.json`）指向 `.research/`；Plan Mode 写出的原始计划由 `/adr` 流程在批准后拷贝为该 feature 的 `plan-snapshot.md`——不建立跨 feature 的 `plans/` 汇集目录
- **/precedent 优先检索本库**：接手新需求先查 `.research/<feature>/notes.md`，防重复研究
- **Miss→Rule 晋级**：feature 过程中的教训先记 `notes.md`；≥2 次重复的教训晋级 REVIEW.md/rules（经用户确认）
- **ship 后闭链**：ship.md 落盘 = feature 收口；遗留项回填 ADR-00x 进度表

## 既有 feature

| feature                       | 状态              | 五件套                                |
| ----------------------------- | ----------------- | ------------------------------------- |
| [nuclei-rules](nuclei-rules/) | 已交付（ADR-003） | ✅ 全（+引擎研究、语料分析 2 份专题） |
