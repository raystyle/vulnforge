# rs-tools — 信封语义 + 物化基础库研究（2026-11-27 补充）

## 信封语义（pi-rs2 实读：piece-envelope-cta.md + ADR-0023 + report.rs）

- 先例：AgentResult 单行 JSON，成败同形；失败必带 next_suggestion（CTA = 纯下一步建议，机读）；error 内嵌原子错误（error_atom：kind 封闭七词表 + error_code `E_<KIND>_<NNN>` + message + context）
- ADR-0023 先例裁决：CTA 与知识库分离，CTA 只专注下一步建议（1315 条注册表 + 1311 页知识库的耦合曾拖慢入册）
- **本项目裁定（用户令）**：
  - 工具级 = vf-error 的 `hint:`（纠偏指引、工具用法、稳定文案）
  - 脚本级 = AgentResult 的 `next_suggestion`（下一步建议、域内攻击链指针、脚本自述）
  - 两者不混用；脚本信封**只暴露原子错误 + 错误处理建议**。**原子错误信息完全内化（用户令）**：kind/code/message 与默认建议全部内化在 vf_rust_lib 的枚举与构造器里（report::failure 直接从 kind 出建议），无外部注册表、无知识库、无 docs 检索面——脚本作者只调构造器，信封零模板
- error kind 七词表（先例封闭集）：timeout / auth_denied / parse / net_unreachable / protocol_mismatch / response_limit / soft_success——失败是数据不是异常（alive:false + note）

## 物化基础库（pi_rust_lib 0.6.3 实读，模块清单）

| 模块                           | 能力                                                                                                        | 采纳                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| report                         | success/failure_json/failure 信封打印                                                                       | ✅ 直接对应 AgentResultSchema                            |
| tls                            | rustls danger_client_config（零校验，`--insecure`）+ roots_client_config（webpki 默认）；ring provider 安装 | ✅ 用户裁定的忽略证书校验能力（默认 roots，选配 danger） |
| net                            | PI_RS_VIA SOCKS5 路由（fail-closed，绝不静默直连）                                                          | 后续（打内网靶需要时）                                   |
| timeout                        | cancel-this 协作取消 + stage 活动追踪 + 子进程兜底 kill + panic hook                                        | 后续（先例成熟态；第一批用 PI_TIMEOUT_SECS 简化）        |
| error_atom                     | {kind, message, detail, context, error_code} + envelope_sha256                                              | ✅ 简化版（kind/code/message）                           |
| builders/codec/payload/longrun | jc 解析器/jaq/duct 子进程                                                                                   | 后续按需                                                 |

- **第一批最小物化库 `vf_rust_lib` crate**：报告信封（report 对应实现）+ rustls 双配置（roots 默认 / danger `--insecure`）+ 基础 HTTP 请求面 + 错误原子（kind/code/message）——以 path 依赖注入 exploit 脚本（源码位置无关，先例同款）
- 骨架 ` ```cargo ` 依赖块默认带 vf_rust_lib + serde_json + rustls
- 坑（先例教训记录在案）：rustls 0.23 无静态 RSA 密钥交换，老栈需 legacy 通道；heavy 依赖进 lib 需 ADR

## exploit 状态机模板先例研究（2026-11-27）

| 先例                                                                      | 机制                                                                                                                                                                                             | 对我们的裁定                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| pentest_rs scanner.rs（自研先例）                                         | **PhantomData 类型状态机**：Configured→Probed→Verified 三态编码进类型；只有 Scanner\<Configured\> 有 probe_with、只有 \<Verified\> 能产报告——**跳步是编译错误**不是运行时警告；IO 与并发归脚本层 | 理念正中靶心（防"以为利用成功"），但 pi-rs2 吸收分析判定它对 agent 现写单文件**过重拖编译** |
| pi-rs2 pentest-rs-absorption.md                                           | 明确拒绝引入 PhantomData 状态机——"取理念不取代码"，把"先证存在再验证"次序下沉到 selftest 断言                                                                                                    | 直接教训：类型级状态机对薄脚本不经济                                                        |
| module.rs（Black Hat Rust Ch4）                                           | 检测模块 trait：IO 归脚本层（抓快照）、判定归模块（inspect 纯函数）——快照可缓存重放、模块可规范驱动测试                                                                                          | 采纳分工纪律：Machine 框架不 IO，步骤闭包做 IO                                              |
| 业界 typestate builder（gh-mcp 检索：泛型 builder 阶段态，缺字段=编译错） | 编译期已知的固定序列用类型编码                                                                                                                                                                   | 验证 typestate 是成熟模式，但 exploit 步骤序列按漏洞而异（运行时声明），不宜全类型化        |

**先例结论（实测表明）**：

1. **两层设计**：Machine 驱动循环（运行时：声明式步骤序列 + Transition 三形 + 轨迹记录）负责 agent 现写脚本的可观测与回放；**类型级防跳步不进第一批**（先例实证对单文件脚本过重）。改为 **Verify 步骤强制在框架内**：最后一步必须是 Verify，或显式 `Done::skip_verify(reason)` 留痕——跳过验证变成显式留痕而非编译错误
2. 步骤闭包做 IO、判定保持纯函数（module.rs 分工纪律）——快照可测可回放
3. "以为利用成功"比"利用失败"更危险（scanner.rs 的立论）——Verify 不可静默省略正是框架存在的理由

### 补充先例（gh-mcp 检索，2026-11-27）

| 先例                             | 机制                                                                                                                                                  | 对我们的裁定                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| pallab-js/r-msf（Rust 渗透框架） | Module trait 生命周期 `register → check → run → output`：check 验证必填选项、run 异步执行、output 三态（success/failure/data）；模块注册表 + 按名发现 | 生命周期四段与我们 Machine 的步骤序列同构——**check 阶段独立**值得吸收（选项校验先于任何 IO）；ModuleOutput 三态 ≈ Transition 三形交叉验证 |
| r-msf TLS 策略                   | `--dangerous-accept-invalid-certs` 仅限 lab 自签目标——与我们 `--insecure` 选配同语义（业界再证）                                                      | 已采纳的方向无需改                                                                                                                        |
| hieuit095/hieu-pentest           | pipeline runner 有 check_required_store 前置校验模式                                                                                                  | 同上：前置校验独立成步                                                                                                                    |

**综合裁定不变**：运行时 Machine 循环 + Verify 框架层强制 + 显式 skip 留痕；**新增吸收**——Machine 步骤序列第一项固定为 Check（选项/参数完备性校验，纯函数零 IO），与 r-msf check 生命周期对齐；Probe 承接指纹与前提探测。

## exploit 状态机模板（用户裁定，2026-11-27：**rs 脚本写 exploit 必须以状态机化模板实现——强制结构，非可选**）

vf_rust_lib 提供状态机**模板实现**，rs 脚本写 exploit **一律基于此模板**（等价 TS 侧"状态机默认必用，无豁免"纪律的 Rust 侧对应物）：

```
// vf_rust_lib 提供（示意）
enum Step { Probe, Craft, Deliver, Verify, /* 按利用类型扩展 Extract 等 */ }
enum Transition { Advance, Fail(ErrorKind, String), Done(Value) }

Machine::new(steps)      // 声明本 exploit 的步骤序列（脚本顶部，读脚本即读状态图）
  .step(Step::Probe, |s| ...)   // 每步一个闭包：入参状态，出 Transition
  .step(Step::Craft, |s| ...)
  .run()                 // match 穷尽驱动循环；阶段轨迹自动记录
```

- **强制模板**：exploit_rs 脚本的结构即 Machine 声明 + 步骤闭包——rs_edit/rs lint（advisory 层）检查 Machine::new 存在性；不符合模板的 exploit 脚本 lint 报错
- **步骤序列声明式**：脚本顶部 `Machine::new([...])` 写本 exploit 的状态图；不同利用类型可扩展步骤集
- **转移三形**：Advance（进下一步）/ Fail（ErrorKind + message，即出信封）/ Done（data 终态出信封）——转移穷尽由 match + 编译期保证
- **轨迹自动记录**：框架收集执行过的步骤序列 + 每步耗时，落入信封 `data.steps`——AgentResult 自带利用流程回放
- **rs_new 骨架按模板展开**：Machine 声明 + 每步闭包框架预置，脚本作者只填每步逻辑
- **并发预留**：sweep 型（一步内打 N 目标）在闭包内用 par_map，框架不管并发只收敛回 Transition
