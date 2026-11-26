# nuclei 规则（模板）开发机制 — 研究笔记

研究日期：2026-11-26。来源：projectdiscovery/nuclei-templates 上游仓库（TEMPLATE-CREATION-GUIDE.md、TEMPLATE-REVIEW-GUIDE.md、.github/workflows/tests.yml、.github/scripts/weak-matcher-checks.sh、.yamllint）。

## 上游质量体系全链（CI 视角）

| 环节     | 工具/机制                                                                                                     | 要点                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Lint     | `yamllint`（.yamllint 配置）                                                                                  | 禁 flow style（braces/brackets forbid）、注释规则、空行 ≤5；只管 .yaml 不管 .yml |
| 语法验证 | `nuclei -duc -validate -lfa -ud . -w workflows/ -et .github/ -ept code -et helpers/payloads/`                 | 官方 CLI 即验证器；排除 code/helpers/payloads 特殊目录                           |
| 误报检查 | **honeypot 反证**：变更模板跑 `honey.scanme.sh`，**有 hit 即 weak matcher** → 自动打 false-positive 标签+评论 | 确定性 FP 检查，无需人工判断                                                     |
| 签名检查 | check-signing-key.py                                                                                          | code/javascript 模板必须带 PD 签名密钥                                           |
| 人工评审 | TEMPLATE-REVIEW-GUIDE.md                                                                                      | 元数据完整性、matcher 质量、CVSS 对齐、reference 有效性                          |

## 模板开发要点（CREATION-GUIDE 蒸馏）

- 结构：`id`（≤3-4 词）/`info`（name 格式 "Vendor Product - Vulnerability"、author 含发现者、severity 按 CVSS、description、reference、classification CVE/CWE、tags、metadata shodan/fofa-query）
- **matcher 质量是核心**：弱 matcher（"error"/"admin"/"login" 等通用词）是误报之源；要求多层验证——①应用识别 ②版本确认 ③漏洞证明（exploitation proof，理想是 `{{randstr}}` 标记回显）
- 测试三步：对漏洞实例 `-debug`、对补丁版本必须不触发、对相似应用必须不触发
- 命名：CVE-YYYY-NNNN.yaml 或 app-name-vuln-type.yaml；目录按 cves/YYYY/、exposures/、misconfiguration/
- `verified: true` 只在自己实测过后标

## 评审标准（REVIEW-GUIDE 蒸馏）

- 质量目标：FP <2%、漏洞实例检出 95%+、必填元数据 100%
- 弱 matcher 反模式：通用响应词、仅版本号不验证漏洞存在
- 强 matcher 模式：`matchers-condition: and` 多层、exploitation proof 带 randstr、panel 类用唯一资源签名

## 可固化为工具的自动化点

1. **静态 lint**：yamllint + `nuclei -validate` + 结构/元数据检查（必填字段、命名规范、author 格式）——纯本地零网络
2. **weak-matcher 静态检查**：弱词黑名单 + matcher 结构分析（是否多层、是否有 exploitation proof）——上游 honeypot 动态法的本地补充
3. **动态验证**：`nuclei -t <tpl> -u <target> -debug` 对 VM/容器靶机采集证据（对接五红线：测试目标在 VM/容器）
4. **误报反证**：对无害目标/honeypot 跑必须 0 hit（上游同款判据）
5. **模板管理**：目录规范、重复检测（按 id/检测逻辑搜已有）、统计清单

## 与 VulnForge 的接口

- Pi 扩展工具承载上述自动化点，模型负责研究漏洞、写 matcher、判断质量——工具保证快速/自动/稳定
- nuclei 二进制依赖：需检测/引导安装（go install 或 release 二进制）
- 上游仓库可 clone 到 .reference 做模板范例库与命名参考

## 元数据建模（品牌类型契约，用户决定 + 先例验证）

- **zod 4 品牌类型**：TemplateId（kebab 规则 brand）、CveId（CVE-\d{4}-\d{4,}）、Severity/Protocol 字面量枚举——校验前置边界（YAML safeParse / DB 行 decodeTplRow 构造器），内部免检
- **先例**：phonetastic-server `docs/zod-domain-types-design.md`（读边界 Schema.parse 模式、branded.ts 集中管理、判别联合消灭非法状态）；axross zod-schema skill（Zod 4 纪律：codec/brand/校验边界）
- **存储层**：zod 契约 + drizzle-orm（sqlite-proxy 包 node:sqlite，免原生编译）；FTS5 bm25 权重按先例（id 10/tags 8/cve 6/product 5/name 3/desc 1）
- **db 生命周期**：封版（版本+sha256 记录进仓）→ 增量运维（增量 upsert，不重建）；WAL 模式，seal/verify 都先 wal_checkpoint(TRUNCATE)（哈希对齐已刷盘状态——测试实证：WAL 未刷盘会导致漏检漂移）

## 上游 nuclei 类型结构（dev 分支实测，类型设计依据）

**Template**（`pkg/templates/templates.go`）：

- `id`：pattern `^([a-zA-Z0-9]+[-_])*[a-zA-Z0-9]+$`（上游允许大写/下划线，比我们的 kebab 宽——模板仓自律用 kebab，解析 schema 对齐上游 pattern，lint 层再收严）
- 协议块（互斥多选一）：`http`（别名 `requests`，deprecated）/ `dns` / `file` / `network`（别名 `tcp`）/ `headless` / `ssl` / `websocket` / `whois` / `code` / `javascript` / `workflows`
- 顶层还有：`flow`（JS 执行流）、`variables`、`constants`、`self-contained`、`stop-at-first-match`

**Info**（`pkg/model/model.go`）——比我初版 schema 丰富，全字段：

- `name`（required）、`author`（required，**StringSlice：字符串或数组均可**）、`tags`（StringSlice）、`description`、`impact`、`remediation`（三者可含 {{placeholders}}）
- `reference`（**RawStringSlice：字符串或数组**）、`severity`（Holder）、`metadata`（map）、`classification`

**Classification**：`cve-id`（StringSlice！可多个）、`cwe-id`（StringSlice）、`cvss-metrics`、`cvss-score`、`epss-score`、`epss-percentile`、`cpe`

**类型设计修正**（对齐上游实际）：

- author/tags/reference/cve-id/cwe-id 都是 **StringSlice（string | string[]）**——zod 用 `z.union([z.string(), z.array(z.string())]).transform(归一数组)`，不能按纯 string 校验
- 协议是 **11 种**（含 whois/code/javascript/workflow），不止我初版的 7 种
- id pattern 对齐上游正则（解析宽松），命名规范留给 lint
- severity 由 Holder 处理（unknown 等）——我们保持 5 值枚举（模板仓纪律）

**业界类型实践**（用户提供 + 验证）：strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`；边界 zod 运行时校验 + 品牌类型；判别联合建模协议块（互斥）；interface 公共 API、type 组合。

- **本地 mock 靶机是插件要解决的核心问题**：`vf-template run` 内置 mock 靶机（可编程 HTTP 响应），使动态验证完全本地化、确定性、可纳入单测——替代"必须有真实靶机才能测模板"的依赖
- **一条龙闭环**：编写（骨架生成 + 范例检索）→ lint → mock 靶机验证 → 元数据入库 → 搜索查重，全链工具化
- **SQLite 元数据库**：建库管理、分析、搜索所有规则元数据。参照先例 `D:\repos\vulnforge\.reference\数据库建模与业务逻辑.md`（poc-scanner 引擎内嵌 SQLite 的实测建模）：
  - `tpl_meta` 主表 ≈ 先例 `poc_meta`（pocname/relative_path/source/description/level/protocol/tags/cve/affected_product）
  - `tpl_fts` FTS5 全文索引 ≈ 先例 `poc_fts`（bm25 加权列：模板 id 最重 10、tags 8、cve 6、affected_product 5、description 最轻 1；snippet 高亮）
  - 两套查重语义：同键查重（duplicate_key + 质量分排序）、身份查重（产品+漏洞类+暴露面+入口点四元组，参照先例 identity 四元组）
  - **文件是唯一真源**：模板 yaml 在盘，SQLite 只是索引——先落文件、再同步索引（先例 5.5 一致性要点）
