# ADR-003 | nuclei 规则开发功能

- 日期：2026-11-26
- 状态：实施中（研究完成，待 Plan 批准后实现）

## 需求

实现插件的第一个功能：让 Pi Agent 使用 VulnForge 定制工具**快速、自动、稳定**地开发和管理 nuclei 规则（模板），覆盖开发、lint、测试、验收全链，形成一条龙闭环。

子需求：

1. **模板 lint**：yamllint 语法检查 + `nuclei -validate` 官方验证 + 结构/元数据检查（必填字段、命名规范、弱 matcher 静态黑名单）
2. **本地 mock 靶机（核心问题）**：`vf-template run` 内置可编程 mock HTTP 靶机——模板动态验证完全本地化、确定性、可纳入单测；对无害响应 0 hit 反证（上游 honeypot 判据）；真实 VM 靶机后续对接
3. **模板编写**：骨架生成（按漏洞类型：HTTP 检测/RCE/SQLi/LFI 等基础结构）+ 范例检索（从范例库找同类模板参考）
4. **SQLite 元数据库**：建库管理、分析、搜索所有规则元数据——`tpl_meta` 主表 + `tpl_fts` FTS5 全文索引（bm25 加权）；两套查重（同键查重 + 产品/漏洞类/暴露面/入口点身份四元组）；**文件是唯一真源**，SQLite 只是索引（先落文件再同步索引）
5. **模板管理**：清单、重复检测、目录规范（cves/YYYY/、exposures/ 等）
6. **Pi 扩展集成**：以上能力注册为 Pi 工具与命令，模型在开发主闭环中调用；危险操作走拦截确认
7. **环境检测诊断**：`vf_env_check`——检测 nuclei/yamllint/Golang 编译配置等依赖工具与环境是否完整支持 agent 的工作；缺失项给出修复指引（安装命令）。**运行时策略：bun + uv + node**（JS 工具走 bun、Python 工具走 uv tool、扩展跑 node；不使用系统 pip）
8. **SQLite db 生命周期**：封版内置本地打包——版本号+哈希记录进仓做项目管理；实体 .db 文件不进本地/云端 git；打开时校验哈希，之后**增量运维**（增量 upsert，不整体重建）

模板存放于独立模板仓（插件指向外部路径，仿上游 nuclei-templates 结构）。

## 进度状态

| 子需求             | 状态 | 剩余                                                       |
| ------------------ | ---- | ---------------------------------------------------------- |
| 上游研究           | ✅   | `.research/nuclei-rules/notes.md`                          |
| 先例研究（SQLite） | ✅   | `.reference/数据库建模与业务逻辑.md`                       |
| ADR 登记           | ✅   | 本条目                                                     |
| 实现计划（Plan）   | ✅   | 计划已批准（plan: steady-wobbling-music）                  |
| 模板 lint 实现     | ✅   | lint.ts：结构/元数据/弱 matcher 纯逻辑                     |
| mock 靶机实现      | ✅   | mock.ts（可编程路由+benign）+ mock-nuclei CLI（测调用方）  |
| 模板编写实现       | ✅   | scaffold.ts：五类骨架                                      |
| SQLite 元数据实现  | ✅   | meta.ts：zod 品牌契约+drizzle+FTS5+封版哈希                |
| 模板管理实现       | ✅   | meta.ts：listAll/duplicates/stats/增量同步                 |
| 环境检测诊断实现   | 🚧   | run.ts checkNuclei 已有；vf_env_check 工具待 Pi 集成时注册 |
| Pi 集成实现        | ❌   | src/index.ts 工具注册面                                    |
| 验证与审查         | ❌   | /verify + reviewer + security-reviewer                     |

## 最终产物

| 产物                                     | 路径                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| 配置（模板仓定位+工具路径）              | `src/templates/config.ts`、`vulnforge-templates/.vulnforge.json` |
| lint（yamllint/validate/结构/弱matcher） | `src/templates/lint.ts`                                          |
| mock 靶机（路由+benign profile）         | `src/templates/mock.ts`                                          |
| mock-nuclei CLI（测调用方，uv 自包含）   | `scripts/mock-nuclei.py`                                         |
| nuclei 执行+benign 反证                  | `src/templates/run.ts`（spawn 收集，修 execFile Windows 死锁）   |
| SQLite 元数据（契约/FTS5/封版）          | `src/templates/meta.ts`                                          |
| 模板骨架                                 | `src/templates/scaffold.ts`                                      |
| 测试（pure 28 + runtime 3）              | `tests/templates/*.test.ts`                                      |

## 是否满足需求

部分满足——六个模块与测试已落地（`npm run check` 全过：biome/tsc/vitest 31 用例/pi load），Pi 工具注册面与最终验证审查未完成。
