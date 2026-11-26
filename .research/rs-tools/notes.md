# rs-tools — 先例研究笔记

研究主题：为 VulnForge 设计 rs_execute / rs_search / rs_edit / rs_new 系列工具（Rust 脚本作为执行基座）。

## 先例（2026-11-26，本地 clone 实读）

### 1. raystyle/pi-rs-plugins（`.reference/pi-rs2/`，自研先例）

上游 pi 1.4.0 钉死原生跑，语义全走标准插件。rust_script 插件 = rs 工具族的直接原型：

- **rs_execute**（`rust-script-tool.ts`，纯执行面）：按名跑脚本（catalog 三源合并：project > global > bundled）；先 agent-friendly lint（advisory：search 元数据 / args 用法 / envelope / CTA / timeout）；输出严格一行 `AgentResult` JSON（success/action/data/error/next_suggestion）；`background:true` 分离执行（run id 立返，attach/ps/stop 管理后续）；`timeout` 透传 `PI_TIMEOUT_SECS`（进程内超时带活动 trace，进程 kill 兜底）
- **rs_search**（`search-tool.ts`，发现面）：拥有 392 件 catalog（bundle catalog.json 同 schema：name/description/description_en/version/keywords/args/file/faces/dangerous）；混合检索（zvec RRF FTS+向量）；**piece 不可达时显式降级**（degraded:true + local_enough:false + CTA）——绝不静默
- 脚本编制：**不用 rs_new/rs_edit 专用工具**——普通 write/edit 工具 + `//!` 元数据头（name/description/description_en/version/args/keywords/codes）+ ` ```cargo ` 依赖块；local crate 路径执行时注入（源码与平台无关、位置无关）
- 三源合并的单一解析器 + 构建期生成器（`gen-rust-catalog.mjs`）与运行时 catalog 有测试防漂移（同 VulnForge contracts-lint 思路）
- 坑：zvec 预编译 core 只 linux-x64——其他 triple 需加预编译（**musl/windows 导出需求的根因**）

### 2. raystyle/pentest_rs（`.reference/pentest_rs/`，自研先例，rs 生态成熟态）

- `pctl export`：五平台交叉编译（x86_64-linux-gnu / **musl** / **windows-gnu** / aarch64-darwin / x86_64-darwin）走 `cargo zigbuild --release --target`——**musl/windows 二进制导出的直接先例**（zig 工具链免 MSVC）
- pctl 统一入口模式：list/find/run/adhoc/test/smoke/regression/check/self/doctor——发现+执行+验证+自省一体
- `nuclei2rs`：nuclei 模板 → rs 脚本批量转译（rayon 并行）——与 VulnForge 模板域天然衔接点
- AgentResult 单行 JSON 信封 + 失败是数据（alive=false+note）不是异常
- `run.rs` 沙箱包装：firejail/nsjail 可用则限，无则 stderr 告警直跑（不静默降级）

### 3. fornwall/rust-script（`.reference/rust-script/`，substrate 本体）

- 单文件 Rust：`#!/usr/bin/env rust-script` + ` ```cargo ` 内联依赖；MSRV 1.74
- 契约要点：内联 cargo manifest、生成项目缓存、`cargo install rust-script` 或包管理器分发

## 关键设计事实

| 决策点                          | 先例答案                                                           | 对 VulnForge 的启示                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rs_edit/rs_new 要不要专用工具？ | pi-rs-plugins **不用**——write/edit 普通工具 + `//!` 头             | **rs_new/rs_edit 应是元数据/lint 辅助而非编辑替代**：rs_new 生成骨架（//!头+`cargo`+AgentResult 框架），rs_edit 做契约化校验（同 vf_nuclei_edit 的 patch 模式）——而不是自由文本编辑 |
| 检索                            | 用户已定：**sqlite FTS5**（同 vf_nuclei_search 模式）              | rs_search = catalog 三源 → SQLite FTS5（bm25：name 10/keywords 8/description 3/description_en 3），替换 zvec（去预编译 core 平台耦合）                                              |
| 执行信封                        | AgentResult 一行 JSON（success/action/data/error/next_suggestion） | 与 vf-error 三行信封互补：工具级错误用 vf-error，**脚本级结果用 AgentResult**（成功也是结构化数据）                                                                                 |
| 降级                            | 显式 degraded:true + CTA，绝不静默                                 | 同 REVIEW.md "SKIP 必须显式" 纪律                                                                                                                                                   |
| musl/windows 导出               | cargo zigbuild 五平台（pentest_rs 实证）                           | rs_export 工具或 vf 工具：zigbuild 产出 musl/linux/windows 二进制（用户明确要求的能力）                                                                                             |
| 三源 catalog                    | project > global > bundled，同名先到先得                           | .vulnforge.json 加 rs 段（脚本目录/导出目标），catalog 合并复用 vf 的配置驱动模式                                                                                                   |

## 结论（先例显示）

1. 工具族切面：rs_search（发现，SQLite FTS5）/ rs_execute（执行，超时+后台+AgentResult）/ rs_new（骨架生成）/ rs_edit（契约化校验）四件套对齐 vf_nuclei_* 的形状——**同一套开发范式换执行域**
2. musl/windows 交叉编译 = cargo zigbuild（pentest_rs 五平台已实证）；作为 rs_export（或 execute 的 `--export <triple>`）能力
3. 脚本契约（`//!` 头 + cargo 块 + AgentResult）要 zod 品牌化（ScriptName/ArgsUsage/AgentResult），lint 进 system-lint 或独立 rs-lint
4. 坑：zvec 预编译只 linux-x64 → 选 SQLite FTS5 纯 TS 实现即天然跨三平台（VulnForge 已有 14k 语料 FTS5 经验）

## pve-harness rust 分支（`.reference/pve-harness-rust/`，2026-11-26 实读）——靶场能力规划依据

- **定位**：Proxmox VE 幂等 VM 生命周期 + vulhub 靶场管理面；rust 分支 python 已完全退场（cargo/rust-script 运行时）
- **信封**：写操作默认 dry-run，`--yes` 才执行；`--json` 输出 `{ok, data}`；`--llms` agent 手册（命令注册表渲染 + 守卫测试锁漂移）；错误码形 `E_INFRA_TIMEOUT` + CTA
- **vulhub 族**：ls/ps/ips（读）+ up/down（写）+ **wait 就绪探测**（每声明端口至少一个活容器 TCP 可达；降级就绪在显式 settle 轮后 ready）；env_ports 从 compose 声明面取
- **配置**：全环境变量 + .env 自动加载（PVE_HOST/USER/BACKEND auto/local/ssh/https）
- **与 pentest_rs 的衔接**（pctl 已集成）：`pctl vulhub regress|up|down|ps|coverage`（333 实例底账 registry.json）+ regression 默认控制面 29 断言
- **对 VulnForge 的规划含义**：rs 工具族（rs_execute 跑 PoC/exploit 脚本）的真实验证环 = pve-harness 起 vulhub 靶场 → wait 就绪 → rs_execute 打真实靶 → AgentResult 断言命中 → down 清场。这是 vf_nuclei_run mock 靶机的**上位验证**（mock 验证逻辑、pve 验证真实行为）；授权边界同项目红线（VM/容器内跑目标）

## 核心定位（用户裁定，2026-11-26）

**rs 插件的核心 = 维护初始物化库 + exploit rs**，目标是 **exploit 利用锻造**——与已完成的 PoC 扫描锻造对齐成完整闭环：

| 阶段 | 锻造对象 | 已有/规划 | 验证手段 |
| ---- | -------- | --------- | -------- |
| PoC 扫描锻造（已完成，ADR-003） | nuclei 检测模板 | vf_nuclei_* 9 工具 | mock 靶机（无害反证+编程路由） |
| **exploit 利用锻造（本 feature）** | exploit rs 脚本 | rs 工具族 | mock（逻辑）→ **pve 靶场（真实行为）** |

- **初始物化库**：seed catalog 随插件分发（物化 = 下载/解压即用，非首次运行构建），对齐 pi-rs-plugins 392 件三源模式；exploit rs 脚本以 vulhub 可复现靶场为验证底座（pentest_rs 已实证 nuclei2rs 转译 + vulhub 回归断言路径）
- exploit rs 与 PoC 模板共用开发范式（骨架生成 → 契约校验 → 执行验证 → 入库检索），但执行域从 YAML 检测换为 Rust 单文件利用脚本（AgentResult 信封承载利用结果与 next_suggestion 攻击链指针）

## 规划草图（rs 工具族 + pve 靶场，待 ADR 确认）

1. **第一批（rs 四件套）**：rs_search（SQLite FTS5，catalog 三源合并）/ rs_execute（超时透传 + 后台执行 + AgentResult 信封）/ rs_new（骨架生成：`//!` 头 + cargo 块 + AgentResult 框架）/ rs_edit（契约化校验，同 vf_nuclei_edit patch 模式）
2. **rs_export（musl/windows）**：cargo zigbuild 产出五平台二进制（x86_64-linux-gnu / linux-musl / windows-gnu / darwin 双架构——pentest_rs `pctl export` 实证路径）
3. **第二批（pve 靶场验证环）**：pve 面工具（起靶场 dry-run 默认 → wait 就绪 → 跑 rs 扫描/exploit → AgentResult 断言 → 清场）；`.vulnforge.json` 加 pve 段（PVE_HOST 等环境变量映射）；vulhub 底账复用 registry.json 模式
