# VulnForge Pi 工具与命令清单

扩展入口 `src/index.ts` 注册的全部工具面。Pi 会话中模型按需调用；本文档为完整参考，代码为准（由 contracts-lint 的工具清单检查防漂移）。

## 工具（registerTool）

| 工具                 | 用途一句话                                             | 写操作                | 确认    |
| -------------------- | ------------------------------------------------------ | --------------------- | ------- |
| `vf_env_check`       | 环境体检：三平台工具链 + 中国镜像 + 模板仓 + mock 端口 | 否（只读探测）        | —       |
| `vf_env_install`     | 修复一项环境缺失：跑 fix 命令 → 复检回告               | 是（安装软件/改配置） | confirm |
| `vf_template_new`    | 生成模板骨架写入模板仓                                 | 是（新文件）          | —       |
| `vf_template_lint`   | 模板静态检查：结构/元数据/弱 matcher                   | 否                    | —       |
| `vf_template_run`    | 本地 mock 靶机验证 + 无害反证                          | 否（临时端口）        | —       |
| `vf_template_sync`   | 文件 → SQLite 索引增量同步 + 封版                      | 是（写 db）           | —       |
| `vf_template_search` | 元数据 FTS 全文检索                                    | 否                    | —       |

## 命令（registerCommand）

| 命令        | 用途                                       |
| ----------- | ------------------------------------------ |
| `/vf`       | 状态总览：模板仓位置、索引统计、安全模式数 |
| `/vf-debug` | 内部状态：危险命令模式表与匹配自检         |

## 逐项参考

### vf_env_check

- **参数**：无
- **行为**：检测 pi（版本对齐 `EXPECTED_PI_VERSION`）/ winget(win) / node / fnm / bun / uv / go（GO111MODULE+GOPROXY 镜像）/ rust（cargo+rsproxy 镜像）/ msvc(win) / zig / nuclei / yamllint / templates repo / mock target；托管根（ohmyenv）下的工具单独分组不算系统缺失
- **返回**：逐项 OK/MISSING + fix 指引；任一缺失则 isError
- **何时用**：环境验收、装完后复检、跨平台验证前置

### vf_env_install

- **参数**：`name: string`（项名，如 `fnm`、`rust`）
- **行为**：checkEnvironment → 取该项 fix 命令（平台命令矩阵）→ **confirm 后**经平台 shell 执行（win `cmd /d /s /c`，posix `bash -lc`）→ 复检并回告新状态
- **返回**：执行的命令、退出码、输出尾部、复检结果
- **何时用**：vf_env_check 报 MISSING 且用户同意安装

### vf_template_new

- **参数**：`vulnType`（detect/rce/sqli/lfi/panel）、`name`、`author`、`severity`、`description`、`tags`、`cveId?`
- **行为**：生成五类骨架之一（matcher 带 proof 标记思想），按 cve/exposure/vulnerability 归目录写入模板仓；id 由 name 派生（kebab 折叠）
- **返回**：写入路径 + 完整骨架内容
- **何时用**：开始写新模板的第一步；之后模型编辑 matcher 与元数据

### vf_template_lint

- **参数**：`path`（相对模板仓根）
- **行为**：parseTemplateFile（zod 契约）→ lintDocument（结构/元数据/弱 matcher 三层检查）
- **返回**：逐条 `[level] rule: message`；有 error 则 isError
- **何时用**：模板编辑后、提交前

### vf_template_run

- **参数**：`path`；`routes?`（`{method, path, status?, body?}[]` 可编程靶机路由）
- **行为**：**先 benign 反证**（无害页 0 hit，有 hit = weak matcher 直接报错）；再起可编程 mock 靶机（127.0.0.1 随机端口）跑真实 nuclei `-jsonl`
- **返回**：反证结论或命中列表（templateId + matchedAt）；0 hit 也报错（提示路由与模板路径不匹配）
- **何时用**：模板 lint 通过后的动态验证——本地即可，无需真实目标

### vf_template_sync

- **参数**：无
- **行为**：遍历模板仓 yaml → zod 解析 → 增量 upsert（消失文件清除）→ seal（wal_checkpoint 后哈希）
- **返回**：synced/failed/removed 数量 + 封版摘要（版本/哈希前 16 位/计数）
- **何时用**：新增或修改模板后、search 前提

### vf_template_search

- **参数**：`query`（FTS 语法）；`severity?`、`protocol?` 过滤
- **行为**：bm25 加权检索（id 10 / tags 8 / cve 6 / product 5 / name 3 / desc 1）+ snippet 高亮
- **返回**：命中列表（id/severity/相对路径/摘要），最多 50 条
- **何时用**：写新模板前查重、找同类范例

### /vf

- **行为**：openTemplatesRepo → db.stats（总数+按 severity 计数）+ 安全模式自检；模板仓缺失时显示 not found
- **何时用**：会话开始的状态检查

### /vf-debug

- **行为**：危险命令模式数量 + `rm -rf` 匹配自检
- **何时用**：安全模块调试
