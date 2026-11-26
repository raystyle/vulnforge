# rs-tools — result

- 先例研究（本地 clone 实读）：pi-rs-plugins（rs_execute/rs_search 原型：advisory lint、AgentResult 单行信封、显式降级、392 件三源 catalog）、pentest_rs（pctl export 五平台 cargo zigbuild——musl/windows 导出实证；nuclei2rs 转译）、fornwall/rust-script（substrate 契约）、pve-harness rust 分支（dry-run 默认、vulhub up/wait/down、--json/--llms 面）
- 结论：rs_search 用 SQLite FTS5 替换 zvec（预编译 core 只 linux-x64 是平台耦合坑；FTS5 纯 TS 跨三平台）；rs_new/rs_edit 按骨架生成 + 契约校验切面设计（先例证明编辑可由普通 write/edit 承担）
- 规划草图在 notes.md（三批：rs 四件套 → rs_export → pve 靶场验证环）；全部待 ADR 确认
