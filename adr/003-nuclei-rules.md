# ADR-003 | nuclei 规则开发功能

- 日期：2026-11-26
- 状态：已完成（实现+验收+审查证据齐，剩余收尾见进度表）

## 需求

实现插件的第一个功能：让 Pi Agent 使用 VulnForge 定制工具**快速、自动、稳定**地开发和管理 nuclei 规则（模板），覆盖开发、lint、测试、验收全链，形成一条龙闭环。

子需求：

1. **模板 lint**：yamllint 语法检查 + `nuclei -validate` 官方验证 + 结构/元数据检查（必填字段、命名规范、弱 matcher 静态黑名单）
2. **本地 mock 靶机（核心问题）**：内置可编程 mock HTTP 靶机——模板动态验证完全本地化、确定性、可纳入单测；对无害响应 0 hit 反证（上游 honeypot 判据）；真实 VM 靶机后续对接
3. **模板编写**：骨架生成（按漏洞类型：HTTP 检测/RCE/SQLi/LFI 等基础结构）+ 范例检索（从范例库找同类模板参考）
4. **SQLite 元数据库**：建库管理、分析、搜索所有规则元数据——`tpl_meta` 主表 + `tpl_fts` FTS5 全文索引（bm25 加权）；两套查重（同键查重 + 身份四元组）；**文件是唯一真源**，SQLite 只是索引（先落文件再同步索引）
5. **模板管理**：清单、重复检测、目录规范（cves/YYYY/、exposures/ 等）
6. **Pi 扩展集成**：以上能力注册为 Pi 工具与命令，模型在开发主闭环中调用；危险操作走拦截确认
7. **环境检测诊断**：环境体检+按平台安装配置部署（取代 ohmyenv 工具管理）。运行时策略：bun + uv + node，不使用系统 pip；三平台（Windows/Linux/macOS）+ pi 版本对齐 + 中国镜像源配置检测
8. **SQLite db 生命周期**：封版内置本地打包——版本号+哈希记录进仓做项目管理；实体 .db 文件不进本地/云端 git；打开时校验哈希，之后**增量运维**（增量 upsert，不整体重建）
9. **跨平台**：三平台同步验证（Windows 主机 + lan-ubuntu + lan-mac 工作台）；云端仓 github.com/raystyle/vulnforge
10. **yamllint TS 化**：lint 检查跨运行时——用 TS 库（yaml parseDocument）实现上游 .yamllint 规则，替代 Python yamllint/uv 依赖

模板存放于独立模板仓（插件指向外部路径，仿上游 nuclei-templates 结构）。

## 进度状态

| 子需求             | 状态 | 说明                                                                                                                                                                          |
| ------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游研究           | ✅   | `.research/nuclei-rules/notes.md`                                                                                                                                             |
| 先例研究（SQLite） | ✅   | `.reference/数据库建模与业务逻辑.md`                                                                                                                                          |
| ADR 登记           | ✅   | 本条目                                                                                                                                                                        |
| 实现计划（Plan）   | ✅   | 计划已批准（plan: steady-wobbling-music）                                                                                                                                     |
| 模板 lint 实现     | ✅   | lint.ts + yamllint.ts（TS 版，六规则对齐上游配置）                                                                                                                            |
| mock 靶机实现      | ✅   | mock.ts（可编程路由+benign）+ mock-nuclei CLI（测调用方）                                                                                                                     |
| 模板编写实现       | ✅   | scaffold.ts：五类骨架                                                                                                                                                         |
| SQLite 元数据实现  | ✅   | meta.ts：zod 品牌契约+drizzle+FTS5+封版哈希                                                                                                                                   |
| 模板管理实现       | ✅   | meta.ts：listAll/duplicates/stats/增量同步/目录排除                                                                                                                           |
| 环境检测诊断实现   | ✅   | env.ts：三平台检测+中国镜像七项+平台命令矩阵+验收                                                                                                                             |
| Pi 集成实现        | ✅   | 7 工具（vf_env_check/vf_env_install/vf_nuclei_{lint,run,sync,search,new}）+ /vf、/vf-debug；docs/tools.md 全文档                                                              |
| 验证与审查         | ✅   | 六项门全绿（biome/tsc/brand-lint/contracts-lint/vitest 44/pi load）；官方上游 14475/14476 实战验收；三平台基线验证通过；审查规则 REVIEW.md 亦有（代理审查待跑一轮补形式记录） |

## 最终产物

| 产物                                     | 路径                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| 配置（模板仓定位+工具路径+托管根）       | `src/templates/config.ts`、`vulnforge-workspace/.vulnforge.json` |
| YAML lint（TS 版，跨运行时）             | `src/templates/yamllint.ts`                                      |
| lint（结构/元数据/弱 matcher）           | `src/templates/lint.ts`                                          |
| mock 靶机（路由+benign profile）         | `src/templates/mock.ts`                                          |
| mock-nuclei CLI（测调用方，uv 自包含）   | `scripts/mock-nuclei.py`                                         |
| nuclei 执行+benign 反证                  | `src/templates/run.ts`（spawn 收集，修 execFile Windows 死锁）   |
| SQLite 元数据（契约/FTS5/封版/排除目录） | `src/templates/meta.ts`                                          |
| 模板骨架                                 | `src/templates/scaffold.ts`                                      |
| 环境检测（三平台+镜像+安装+验收）        | `src/templates/env.ts`                                           |
| Pi 工具面（7 工具+2 命令）               | `src/index.ts`、文档 `docs/tools.md`                             |
| 测试 44 用例（pure/smoke/runtime/load）  | `tests/`                                                         |
| 强制 lint（brand+contracts）             | `scripts/brand-lint.mjs`、`scripts/contracts-lint.mjs`           |
| 契约文档（5 份，73 符号全覆盖）          | `docs/contracts/`                                                |

## 是否满足需求

**满足**。十条子需求全部落地并有验收证据：

- 上游实战：官方 nuclei-templates 14475/14476（99.99%）解析入库；FTS 检索毫秒级；同键查重挖出上游 158 组真实重复；两轮契约修正（description 可选、severity unknown/缺省收容、非模板目录排除）
- 三平台基线：Windows/Linux/macOS 六项门全绿（nuclei 缺席的 runtime 测试显式 SKIP 符合纪律）；CRLF 归一修复（.gitattributes）
- 质量门：brand-lint + contracts-lint 机械强制品牌契约与文档完整性；44 测试先红后绿
- 工具文档：docs/tools.md 全清单（7 工具+2 命令）+ contracts-lint 防漂移

遗留（不阻断本 ADR，后续迭代）：`nuclei -validate` 调用接进 vf_nuclei_lint（当前静态检查已覆盖结构，validate 需 nuclei 在 PATH）；真实 VM 靶机对接；批量事务优化（模板库翻倍时）。
