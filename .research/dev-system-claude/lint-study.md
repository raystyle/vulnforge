# dev-system-claude — 全局 lint 增强：双向链接式资产一致性（2026-11-27，用户令）

**裁定**：强制全局 lint + 完善 + 增强——按"双向链接"思想：资产 A 引用资产 B 时，lint 同时校验 B 存在、B 的索引回指 A、A 的描述与 B 的实际状态一致。单向链接查"断链"，双向链接查"断链 + 索引缺行 + 内容漂移"三类脱节。

## 检索结论（gh-mcp + 本地）

- markdownlint / markdown-link-checker 生态只查**正向断链**（目标存在性），无双向概念
- Foam/Obsidian 的 backlink 是**索引/导航**（IDE 内聚合反向引用），非强制 lint；search 只在 GitHub code search 命中过零星自实现
- **系统性双向资产图 lint 无现成大件先例**——本仓 system-lint 的 alignment 系列（research 五件套、ADR 索引、工具面↔docs/tools.md）已经是该模式的部分实现：正查（目录存在→README 有行）+ 反查（README 链接→目录存在）。本次是把它**泛化到全部资产轴并补正反两向的第三维（内容一致性）**

## 既有覆盖 vs 缺口

| 资产轴                                          | 正向（引用→目标存在）                             | 反向（索引回指）                 | 内容一致                                                     |
| ----------------------------------------------- | ------------------------------------------------- | -------------------------------- | ------------------------------------------------------------ |
| research feature ↔ README                       | ✅ 五件套存在                                     | ✅ 表有行/链有目录               | ❌ 状态列 vs ship.md 存在性（研究"研究中"但 ship 已落=漂移） |
| ADR ↔ 索引                                      | ✅                                                | ✅                               | ❌ 索引行状态 vs 文内状态节（实施中/已完成漂移）             |
| 工具面 ↔ docs/tools.md                          | ✅                                                | ✅                               | ✅（test-tool-alignment 三方）                               |
| **memory ↔ MEMORY.md 索引**                     | ❌ 文件存在无断链检查                             | ❌ 索引行无对应文件/文件无索引行 | —                                                            |
| **skills/hooks/agents ↔ .claude/README 资产表** | ❌ 目录文件无登记                                 | ❌ 表列出的资产不存在            | —                                                            |
| **rules ↔ 触发路径真实存在**                    | ❌ rust-lib.md 声称管 vf-rust-lib/** 但无机械核对 | —                                | —                                                            |
| CLAUDE.md 当前状态                              | ✅（claude-md-current）                           | —                                | —                                                            |

## 新增检查设计（四项，进 system-lint）

1. **memory-index-alignment**（双向）：`.claude/memory/*.md` 每个记忆文件 ↔ MEMORY.md 索引行——文件无行 = 索引缺行；行无文件 = 断链指针
2. **claude-assets-alignment**（双向）：`.claude/rules|skills|hooks|agents` 实际文件 ↔ `.claude/README.md` 资产表登记——资产存在无提及 = 未登记；表提及无资产 = 幽灵条目
3. **adr-status-alignment**（内容一致）：每条 ADR 文内 `状态：X` ↔ `.ad_records/README.md` 索引行状态——两处不一致即漂移
4. **research-status-alignment**（内容一致）：`.research/README.md` 特性表状态词（研究中/进行中/已收口/已交付）↔ 该 feature 目录的 ship.md 存在性——ship 在而状态"研究中"= 收口未回填

执法哲学不变：**修派生物不改检查**——报的是哪处脱节就补哪处文档，检查本体只增不减。
