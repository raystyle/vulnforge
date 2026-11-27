# rs-tools — ship

## 交付事实

- 研究阶段交付：`.research/rs-tools/notes.md`（四先例 + 关键设计事实表 + 规划草图）、result 与本 ship
- ADR-004 已确认写入（.ad_records/004-exploit-rs.md）——范围：初始物化库 + exploit rs 工具族 + pve 靶场验证环（批次 2）
- 实现第一批交付（2026-11-27，commits 9c827d4..71941f1）：
  - TS 工具面：exploit_rs_search/new/edit/run/export + exploit_rs_sync/stats + vf_init 三合一 + oob 配置段 + 配置分层全局回退
  - vf_rust_lib：report/error/tls/machine/payload/runtime/webshell/oob/mutate/http/net/fingerprint 十二模块；AgentResult 信封 + Machine 强制模板 + 三 provider OOB + 变异数据面 + 三语言通道/隧道模板 + .NET 编排面
  - 门：TS 186+12、rust-lib 89+1、system-lint 14/14、contracts-lint 210/210；三平台（Windows/lan-ubuntu/lan-mac）两轮全绿；e2e 真实工作区 9/9
- 验证证据：`.research/rs-tools/evidence/`（check/rs-lib/cargo-test/vitest/e2e verbose 日志 + result.md 先红后绿记录）

## 遗留项

- 独立审查结论归档 `.review/`（reviewer 进行中，完成后回填）
- pve 靶场环（批次 2）：vulhub up/wait/down + 可插拔验证对象（双锻造线共用）——后续 ADR 扩展
- 变异-测试闭环：检测平台清单对接 + pve RASP 沙箱（依赖 pve）
- .NET nrbf 序列化载荷生成面（依赖运行时工具路由）
- 隧道会话形（长连接 mark 键缓冲）+ 操作端 SOCKS 面（依赖 pve 真实验证）
- pve 段配置契约（PVE_HOST 等）与 `.vulnforge.json` 扩展设计
