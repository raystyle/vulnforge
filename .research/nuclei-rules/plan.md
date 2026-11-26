# VulnForge 首功能实现计划：nuclei 规则开发一条龙（ADR-003）

## Context

ADR-003 要求让 Pi Agent 用 VulnForge 定制工具**快速、自动、稳定**地开发和管理 nuclei 模板。当前痛点：上游 nuclei-templates 的质量链（yamllint → nuclei -validate → honeypot 反证 → 人工评审）是 CI/人工流程，Agent 无法直接、确定性地使用；且动态验证依赖真实靶机。本功能把全链工具化，**本地 mock 靶机是核心**（动态验证本地化、确定性、可单测），并用 SQLite 元数据库（先例：`.reference/数据库建模与业务逻辑.md` 的 poc-scanner 实测建模）管理/分析/搜索全部规则元数据。

已确认的决策：模板存**独立仓**（`D:\repos\vulnforge-templates`，仿上游结构）；六子需求一次到位；mock 靶机本地化。

研究依据：`.research/nuclei-rules/notes.md`（上游质量链蒸馏）、Pi API 形状（pi-super 先例实测：registerTool typebox 参数 + execute 五参签名 + `{content:[{type:"text",text}],isError}` 返回、tool_call 拦截、ctx.ui.confirm 带 hasUI 守卫、spawn shell:false 可注入）。

## 目标架构

```
vulnforge（本仓，Pi 扩展）
├── src/
│   ├── index.ts            # 薄入口：注册工具/命令（工厂期零 Pi action 调用）
│   ├── safety.ts           # 已有
│   └── templates/
│       ├── config.ts       # 模板仓定位（findUp 找 .vulnforge.json，止于 .git——pi-super paths.ts 模式）
│       ├── lint.ts         # yamllint + nuclei -validate + 结构/元数据检查 + 弱 matcher 静态分析
│       ├── mock.ts         # 可编程 mock HTTP 靶机（node:http，路由→固定响应；含无害 profile）
│       ├── run.ts          # spawn nuclei -t <tpl> -u <mock> -jsonl；解析命中；无害 profile 0-hit 反证
│       ├── meta.ts         # SQLite（node:sqlite）：tpl_meta + tpl_fts(FTS5,bm25)；同步/搜索/双套查重
│       └── scaffold.ts     # 模板骨架生成（按漏洞类型）+ 范例检索（查 tpl_fts）
└── tests/                  # pure/smoke/runtime 三层

vulnforge-templates（独立模板仓，本计划初始化）
├── .vulnforge.json         # 配置：db 路径（templates.db）、mock 端口范围
├── .yamllint               # 上游同款配置（禁 flow style 等）
├── http/cves/…、exposures/…# 上游式目录
└── templates.db            # SQLite 索引（生成物，gitignore）
```

**核心原则**（先例）：模板 yaml 文件是唯一真源，SQLite 只是索引——先落文件、再同步索引。

## 实施步骤

### Phase 0：环境与模板仓初始化

1. 安装依赖：`go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`（Go 1.27 已备）；`pip install yamllint`
2. 建 `D:\repos\vulnforge-templates`：上游式目录骨架 + `.yamllint` + `.vulnforge.json` + 2 个种子模板（1 个合格、1 个故意弱 matcher——用于红绿测试与工具演示）
3. 仓内 devDependencies 增补：`yaml`（YAML 解析）；SQLite 用 Node 内置 `node:sqlite`（engines ≥22.19 已满足，免原生编译；若 API 不可用则降级 better-sqlite3——实施时验证）

### Phase 1：纯逻辑模块（TDD，先红后绿）

按依赖序实现，每个模块先写 pure 测试：

1. **config.ts**：findUp 定位模板仓（读 `.vulnforge.json`）；解析失败/未找到的显式错误
2. **lint.ts**：
   - `runYamllint(path)`：execFile yamllint，退出码/输出结构化
   - `runNucleiValidate(path)`：execFile nuclei `-duc -validate -t <file>`（nuclei 缺失时显式 SKIP 标记，不静默通过——REVIEW.md 规则）
   - `checkStructure(doc)`：必填字段（id/info.name/author/severity/description）、severity 枚举、id 命名规范（kebab、≤4 词）、author 格式、tags 规范
   - `checkWeakMatchers(doc)`：弱词黑名单（error/admin/login/dashboard 等上游反模式）+ matcher 结构分析（无多层验证/无 exploitation proof 时降级建议）
3. **mock.ts**：`startMockTarget(routes)`——routes 为 `{method,path}→{status,body,headers}` 数组；随机端口监听 127.0.0.1；返回 `{url,close}`；内置 `benignProfile`（返回通用无害页，任何模板命中即弱 matcher）
4. **run.ts**：`runTemplateAgainst({tplPath,url})`——spawn nuclei `-t -u -jsonl -no-color -silent`，收集 JSONL 命中，返回 `{hits,rawOutput,exitCode}`；证据输出可落 `.research/<feature>/evidence/`
5. **meta.ts**：
   - schema：`tpl_meta`（id/name/author/severity/description/tags/cve/cwe/protocol/affected_product/relative_path/duplicate_key/identity 四元组/updated_at）+ `tpl_fts`（FTS5：id 10/tags 8/cve 6/product 5/name 3/description 1，bm25 加权 + snippet——先例权重）
   - `syncFromFiles(root)`：遍历 yaml → 解析 → upsert（文件真源，幂等重同步）
   - `search(query,{filters})`：FTS 查询 + 过滤维度
   - `findDuplicates(tpl)`：同键查重（duplicate_key）+ 身份查重（product/vulnClass/surface/entryPoints 四元组）
6. **scaffold.ts**：`skeletonFor(vulnType)`——HTTP 检测/RCE/SQLi/LFI/面板识别 五类骨架；`findExamples(query)`——查 tpl_fts 返回同类范例路径

### Phase 2：Pi 集成（src/index.ts）

注册 6 工具 + 1 命令（typebox 参数，execute 返回 `{content:[{type:"text",text}],details,isError?}`）：

| 工具 | 参数 | 行为 |
|------|------|------|
| `vf_template_new` | vulnType, cve?, name | 生成骨架到模板仓正确目录，返回路径 |
| `vf_template_lint` | path | yamllint+validate+结构+弱matcher 四合一，结构化结果 |
| `vf_template_run` | path, routes? | 起 mock 靶机 → 跑 nuclei → 返回命中+证据；**先跑 benign profile 0-hit 反证** |
| `vf_template_search` | query, filters? | FTS 搜索元数据 |
| `vf_template_sync` | — | 文件→SQLite 同步（写库前 confirm） |
| `vf_template_list` | dir?, tag? | 清单/查重报告 |

命令 `/vf`：状态（模板仓路径、db 统计、nuclei/yamllint 可用性）。

安全：所有 spawn `shell:false`、参数数组化；模板仓路径外的写操作拒绝；`vf_template_run` 只允许 127.0.0.1 mock 目标（外部目标留待后续 VM 对接，启用时走 ctx.ui.confirm）。

### Phase 3：测试四层

- **pure**：lint 规则、弱 matcher 分析、scaffold、mock routes、meta 同步逻辑（临时目录，不依赖 nuclei）
- **smoke**：注册面断言（6 工具+1 命令；工厂期无 Pi action 调用）
- **runtime**：mock 靶机 + 真实 nuclei 二进制端到端（种子模板→预期命中；弱模板→benign 反证触发）；nuclei 缺失时测试显式 SKIP 并打印原因
- **load**：已有 pi-load-check 不变

### Phase 4：验证与收尾

1. `/verify`：`npm run check` 四门 + 新测试先红后绿记录 + verbose 落盘 `.research/nuclei-rules/evidence/`
2. 独立审查：reviewer + security-reviewer（新增 spawn/HTTP 面）
3. 更新 ADR-003（最终产物/是否满足）、CHANGELOG Unreleased、CLAUDE.md 导航
4. 模板仓 git init（与主仓节奏一致，用户指令时执行）

## 关键文件

- 新建：`src/templates/{config,lint,mock,run,meta,scaffold}.ts`、`tests/templates/*.test.ts`、模板仓全套
- 修改：`src/index.ts`（注册）、`package.json`（+yaml 依赖）、`scripts/pi-load-check.mjs`（不变）
- 复用：`src/safety.ts` 危险命令模式（不直接复用于 mock，但保持同风格）；pi-super 的 spawn/confirm/findUp 模式（参照实现，非 import）

## 验证方式

1. `npm run check` 全绿（含新增 pure/smoke 测试）
2. runtime 测试（需 nuclei）：种子好模板 → mock 靶机 → 恰好 1 hit；弱模板 → benign profile 反证报 weak-matcher
3. 手动闭环演示：`pi -e src/index.ts` → 让模型写一个新模板 → lint → run（mock）→ sync → search 全链走通
