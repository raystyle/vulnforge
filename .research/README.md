# .research/ — 产物知识库

每个 feature 一个目录，记录完整证据链（research → plan → evidence → result → ship）。进 git；`evidence/` 只留关键文件，超大日志先裁剪。

```
.research/
└── <feature>/
    ├── notes.md       # 研究笔记：先例发现、坑、结论（/precedent 产出）
    ├── plan.md        # 实现计划（Plan Mode 人工批准后的快照）
    ├── evidence/      # 验证证据：测试 verbose 日志、先红后绿记录、输出截图
    ├── result.md      # 结果：跑了什么、退出码、测试数、审查结论、回路记录
    └── ship.md        # 交付记录：验证戳内容、commit、遗留项
```

## 既有目录

（暂无 — 首个 feature 开始时创建）
