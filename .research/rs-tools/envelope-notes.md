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

## exploit 状态机框架（用户裁定，2026-11-27：**exploit 利用流程与步骤状态机化的框架**）

vf_rust_lib 提供一等的状态机**框架**（非仅模板）——每个 exploit 的利用流程与步骤在框架内声明式表达：

```
// vf_rust_lib 提供（示意）
enum Step { Probe, Craft, Deliver, Verify, /* 按利用类型扩展 Extract 等 */ }
enum Transition { Advance, Fail(ErrorKind, String), Done(Value) }

Machine::new(steps)      // 声明本 exploit 的步骤序列（脚本顶部，读脚本即读状态图）
  .step(Step::Probe, |s| ...)   // 每步一个闭包：入参状态，出 Transition
  .step(Step::Craft, |s| ...)
  .run()                 // match 穷尽驱动循环；阶段轨迹自动记录
```

- **步骤序列声明式**：脚本顶部 `Machine::new([...])` 写本 exploit 的状态图；不同利用类型可扩展步骤集
- **转移三形**：Advance（进下一步）/ Fail（ErrorKind + message，即出信封）/ Done（data 终态出信封）——转移穷尽由 match + 编译期保证
- **轨迹自动记录**：框架收集执行过的步骤序列 + 每步耗时，落入信封 `data.steps`——AgentResult 自带利用流程回放
- **rs_new 骨架按框架展开**：Machine 声明 + 每步闭包框架预置，脚本作者只填每步逻辑
- **并发预留**：sweep 型（一步内打 N 目标）在闭包内用 par_map，框架不管并发只收敛回 Transition
