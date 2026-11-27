---

name: work-state
description: VulnForge 工作状态（2026-11-27）：ADR-004 exploit 利用锻造实施中（P0-P4 完成）；工具三段式改名定稿；vf_rust_lib v0.1 落地
metadata:
node_type: memory
type: project
originSessionId: d8cd2140-8dfa-43c0-8e0b-a189c6c104d9
modified: 2026-11-27T03:25:17.727Z
---

# VulnForge 工作状态（2026-11-27）

**首功能（nuclei 模板一条龙）已交付**（ADR-003）：9 工具更名 nuclei_* 三段式，模板仓 vulnforge-workspace。

**当前 feature（ADR-004 实施中 P0-P4 完成）**：exploit 利用锻造。关键事实：

- 工具名三段式定稿：nuclei_*（8 个）/ rs_search（已注册）/ vf_init（check+install 已合一 + java/dotnet/rust-script/cargo-zigbuild 四新检测项）
- vf_rust_lib v0.1（vf-rust-lib/ crate）：report 信封 / Atom 原子错误（七 kind 内化，无知识库无注册表）/ tls roots+danger 双配置 / machine 强制模板——Outcome 三形 Success(data) 流转 / Failure / Data 终态；DeliverForm 四形态 Submit/ExecCommand/WriteFile/RevShell = 两原子动作（写文件+执行命令）组合；Check→Probe→Craft→Deliver→Verify，Verify 前出 Data 自动 skip_verify 留痕；npm run rs-lib 门（fmt+clippy+test，7 单测）
- 信封分工：工具级 vf-error hint=用法纠偏；脚本级 next_suggestion=攻击链指针——严格分离
- 研究收口：MemShellParty 四轴分类学（ServerType×ShellType×ShellTool×Packer）+ 隐蔽植入（probe 先行/无侵入/验证三态/字节码单常量嵌入）；WAF 变形正交原语+指纹→策略+变异闭环；ristretto_classfile（Rust 读 .class，生成留 Java）；.NET NRBF nom/binrw；Java 反序列化 java-serialization/jaded/ysoserial-rs。文件在 `.research/rs-tools/`
  工具名 rs_run（execute→run 对齐裁定）。工具面 15+2 已齐：rs_search/new/edit/execute/export 全注册 + vf_init action=init（生成配置+lint+幂等+force 确认门）；E2E 三链实证（scaffold→execute Machine 轨迹回信封 / export musl 真二进制+SHA256SUMS / search 跨域）
- webshell 专库：godzilla 形加密通道（PHP+JSP 模板）+ behinder 整 body class 载荷面 + 无特征断言（模板无 system/exec 字串）；Defender 会隔离含 one-liner 的中间文件（教训：内容编码存放）
- rs_sync/stats 已注册对齐 poc 面（branded group-by）；webshell 免杀研究收口（Bypass-Guide 手册：检测分类学+8 类变异原语+两阶段写入；mutate 原语做成数据）
- **范围裁定：后渗透止于隧道代理（webshell 实现）**——能力四件：写入/执行命令/通信加密/隧道代理；权限维持/横向移动/凭据收集/C2 明确不做
- **2026-11-27 交付**：oob 模块（interactsh 全协议/collaborator/dnslog 三 provider + Lease 租约轮询；密钥红线 = token/biid 只经环境变量；.vulnforge.json oob 段非密事实 → oobEnvFor → VF_OOB_* 透传）；mutate 数据面（23 原语 JSON 表 + 组合代数 + 种子确定性 + A/C/B/D 全类执行器）；.NET webshell 面（aspx 通道 + ysoserial.net CLI 编排 + ViewState + behinder Assembly.Load 面）；三语言隧道模板（php/jsp/aspx forward-spec 形）；widgets http/net/fingerprint；配置分层阶段 2（pi 数据目录全局回退）。顺手修 fixCommandsFor 反转过滤器。三平台两轮全绿。三平台 peer 轮流程沉淀进 verify skill。rust-lib 89+1 测试
- **到 pve 边界**：剩余待办全部依赖 pve 靶场环（批次 2）——变异-测试闭环（检测平台 + RASP 沙箱）、nrbf 生成面、隧道会话形 + 操作端 SOCKS。独立审查结论归档后收口
- **pve 集成方式（用户裁定 2026-11-27）**：等用户的 pve MCP（hvperv-harness/mcps/ 系——已有 hyperv-mcp/vm-repl-mcp/browser-control-mcp 同族）做好后由 Claude 安装操作接入——不自建 pve 靶场工具面，复用用户 MCP 生态
- 待做：pve 靶场环（批次 2，双锻造线通用验证底座，经用户 pve MCP 接入）
