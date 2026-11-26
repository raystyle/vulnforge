---

name: feedback-adr-scope
description: ADR 每一条都必须由用户决定；未经用户确认不得写入任何 ADR 条目
metadata:
node_type: memory
type: feedback
originSessionId: d8cd2140-8dfa-43c0-8e0b-a189c6c104d9
modified: 2026-11-26T02:41:51.645Z
---

ADR（.ad_records/）的每一条都必须是用户的决定；写任何条目前必须先问用户。

**Why:** 两次教训：①初版把用户粘贴的开发指南推断成需求（自行编号 ADR-001~005），用户指正"ADR-001~005 是你写的，首先这个就是犯错了"；②重写时未询问就自行把用户的三个请求登记为 ADR-001~003 并标记完成，用户再次指正"你没有问过我，所有ADR都要是我决定"。

**How to apply:** 维护 .ad_records/ 时，条目的有无、内容、状态一律由用户决定。我只能起草候选内容供用户确认，未经确认不写入文件。用户粘贴的参考资料（如开发指南）只能沉淀到 CLAUDE.md 或 ADR 的"背景"小节，不得编成需求条目。拿不准就问，先问后写。
