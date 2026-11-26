---

name: precedent
description: 先例搜索流程：新需求/写实现前，用 gh-mcp 搜索同类实现并研究先例的错误与 bug，深入分析可 clone 到 .reference/。当接到新需求、设计新模块、或需要确认某功能的业界做法时使用。
---

# precedent — 先例搜索流程

## 步骤

1. **先查本地产物**：优先检索 `.research/`（既有研究结论，防重复研究）与 `.reference/` 已归档先例。
2. **明确要搜什么**：把需求拆成可搜索的关键词（技术名 + 场景），如 `pi extension tool registration`、`gh-mcp search_code`。
3. **gh-mcp 搜索**（reference 无果后）：
   - `search_repositories`：找同类项目（看 star 数与活跃度判断成熟度）
   - `search_code`：找具体实现片段
   - `get_file_contents`：读关键文件（README、AGENTS.md/CLAUDE.md、package.json、测试、CI 配置）
4. **web 搜索**（gh-mcp 仍无果的最后手段）：官方文档、标准、博客——只补 gh-mcp 覆盖不到的时效性/权威性内容。
5. **重点研究三件事**：
   - 先例**如何完成**需求（架构、目录、API 用法）
   - 先例**犯过什么错**（issue、CHANGELOG、AGENTS.md 里的战史规则）
   - 先例**出过什么 bug**（教训如何固化为 lint/测试/规则）
6. **需要深入分析时**：`git clone --depth 1 <repo>` 到 `.reference/<repo-name>/`，随后用本地工具分析。
7. **产出**：研究结论汇总给用户；教训提炼为 ADR 候选条款或 rules 候选规则，经用户确认后固化。

## 纪律

- `.reference/` 是参考资料区，不进 git（.gitignore 排除）
- clone 用 `--depth 1`，避免整仓历史
- 研究结论拿不准是否算用户需求时，先问用户再记录（ADR 只记用户决定）
- 本仓已有参考：`.reference/claude-doc/`（官方文档）、`.reference/claude-src/`（Claude Code 源码）、`.reference/pi-super/`、`.reference/pi-extensions/`（Pi 扩展先例）
