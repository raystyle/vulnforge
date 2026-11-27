---

name: work-state
description: VulnForge 工作状态（2026-11-27）：ADR-004 exploit 利用锻造实施中（P0-P4 完成）；工具三段式改名定稿；vf_rust_lib v0.1 落地
metadata:
node_type: memory
type: project
originSessionId: d8cd2140-8dfa-43c0-8e0b-a189c6c104d9
modified: 2026-11-26T23:56:55.075Z
---

# VulnForge 工作状态（2026-11-27）

**首功能（nuclei 模板一条龙）已交付**（ADR-003）：9 工具更名 poc_nuclei_* 三段式，模板仓 vulnforge-workspace。

**当前 feature（ADR-004 实施中 P0-P4 完成）**：exploit 利用锻造。关键事实：

- 工具名三段式定稿：poc_nuclei_*（8 个）/ exploit_rs_search（已注册）/ vf_init（check+install 已合一 + java/dotnet/rust-script/cargo-zigbuild 四新检测项）
- vf_rust_lib v0.1（vf-rust-lib/ crate）：report 信封 / Atom 原子错误（七 kind 内化，无知识库无注册表）/ tls roots+danger 双配置 / machine 强制模板——Outcome 三形 Success(data) 流转 / Failure / Data 终态；DeliverForm 四形态 Submit/ExecCommand/WriteFile/RevShell = 两原子动作（写文件+执行命令）组合；Check→Probe→Craft→Deliver→Verify，Verify 前出 Data 自动 skip_verify 留痕；npm run rs-lib 门（fmt+clippy+test，7 单测）
- 信封分工：工具级 vf-error hint=用法纠偏；脚本级 next_suggestion=攻击链指针——严格分离
- 研究收口：MemShellParty 四轴分类学（ServerType×ShellType×ShellTool×Packer）+ 隐蔽植入（probe 先行/无侵入/验证三态/字节码单常量嵌入）；WAF 变形正交原语+指纹→策略+变异闭环；ristretto_classfile（Rust 读 .class，生成留 Java）；.NET NRBF nom/binrw；Java 反序列化 java-serialization/jaded/ysoserial-rs。文件在 `.research/rs-tools/`
工具名 exploit_rs_run（execute→run 对齐裁定）。工具面 15+2 已齐：exploit_rs_search/new/edit/execute/export 全注册 + vf_init action=init（生成配置+lint+幂等+force 确认门）；E2E 三链实证（scaffold→execute Machine 轨迹回信封 / export musl 真二进制+SHA256SUMS / search 跨域）
- webshell 专库：godzilla 形加密通道（PHP+JSP 模板）+ behinder 整 body class 载荷面 + 无特征断言（模板无 system/exec 字串）；Defender 会隔离含 one-liner 的中间文件（教训：内容编码存放）
- exploit_rs_sync/stats 已注册对齐 poc 面（branded group-by）；webshell 免杀研究收口（Bypass-Guide 手册：检测分类学+8 类变异原语+两阶段写入；mutate 原语做成数据）。待做：mutate 数据面实现、.NET webshell 面（nrbf 路由）、三平台轮、独立审查
