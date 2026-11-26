# ship — nuclei 规则开发一条龙（ADR-003）

交付日期：2026-11-26。

## 验证戳

```
Verified: npm run check（biome + tsc + brand-lint + contracts-lint + vitest 77/77 + pi load）
Evidence: .research/nuclei-rules/evidence/
Review: 三平台独立验证（peer-linux/peer-mac round 1–3 全绿）；代理审查待跑（遗留）
```

## 交付 commit（main 分支，已推送 github.com/raystyle/vulnforge）

| commit | 内容 |
| ------ | ---- |
| a3e6526 | 初始体系：四资产、REVIEW.md、检查门、骨架 |
| 51aaa1d | 工具改名 vf_nuclei_* |
| 89ef606 | .gitattributes LF 归一（三平台 CRLF 修复） |
| 0fb5337 → 0ab4ef3 | 契约对齐上游（description/severity 收容）→ XState 事件驱动 sync 状态机 + 编译期穷尽 |
| 255498b | vf_nuclei_edit + 进程内 mock ScanPort（Python CLI 移除） |
| 5b55b1a / ac12b2e | vf_nuclei_stats 品牌契约 groupBy / workspace 布局 |
| 75e76b6 | 官方语料全量分析报告归档 |
| 1f404c7 | vf_nuclei_run 双模式（远程 confirm 门）+ 可控 spawn mock server + MockRoute 契约 |
| 92eac98 | 抽测脚本（分层 140 样本） |

## 上游语料实测（验收核心证据）

- 全量：14475/14476 入库（99.99%），sync 89s（163 files/sec 含状态机+lint 管线）
- 抽测：140/140 parse 全过；FTS 回查 14/14 命中；lint error 规则分布归档（CVE-YYYY id 51+51 / workflows matcher 误报 16）
- 分析：`upstream-analysis.md`（severity/protocol/目录/CVE 年份/作者/查重 158 组）
- 性能：FTS 3–36ms、groupBy 毫秒级、seal 40ms（对封版 db）

## 遗留项

| 项 | 说明 | 计划 |
| -- | ---- | ---- |
| 代理审查未跑 | reviewer/security-reviewer 一次正式审查（REVIEW.md 规则正本从 main 读） | 下一轮跑，结果补 result.md |
| workflows 契约缺失 | TemplateDocSchema 不解析 workflows 块（subtemplate 引用完整性 lint 是真检查点）；matcher/missing 对 workflow 误报 | 引擎研究行动清单：nuclei-engine-study.md §4 |
| offline-http 协议 | 引擎枚举有 OfflineHTTPProtocol，我们枚举没有（会兜底 http） | 随 workflows 契约一起补 |
| URL 规范化 | 远程 target 参数需 canonicalize IPv4-mapped IPv6（引擎 SSRF 战史） | 安全加固批次 |
| 引擎 SDK 嵌入 | lib/ 库模式替代 CLI spawn（进程内真引擎） | 远期 |
