# rs-tools — vf_rust_lib 运行时小部件与工具（用户裁定，2026-11-27）

**裁定语义**：打造运行时的小部件（widgets）和工具（tools），**供 rs 脚本（Rust）使用**——vf_rust_lib 不只是信封+模板，是 exploit 脚本的**标准库**：脚本作者 `use vf_rust_lib::xxx` 直接获得原子能力，不重写样板。先例 = pi_rust_lib（report/tls/net/timeout/error_atom/builders/codec/payload/longrun）+ pentest_lib（scanner/module/payload/util）。

## 小部件清单（第一批，web exploit 为主）

| 模块 | 小部件 | 能力 | 先例 |
| ---- | ------ | ---- | ---- |
| `http` | `http::get/post/request` | rustls 双配置（roots 默认/danger `--insecure`）的极简 HTTP 面：返回状态/头（小写化）/body 字节——**快照结构**（可缓存重放、纯函数判定） | pi_rust_lib tls + pentest_lib HttpSnapshot |
| `report` | `report::success/failure` | AgentResult 单行信封（已建） | pi_rust_lib report |
| `machine` | `Machine::standard/with_deliver` | 强制状态机模板（已建） | 本仓设计 |
| `error` | `Atom::*` 七 kind 原子错误（已建） | 内化默认建议 | pentest_rs error_atom |
| `payload` | `payload::b64_encode/decode`、`payload::url_encode`、`payload::bytes_lit` | payload 构造小件（base64/hex/url/字面字节——cheatsheet 常用变形原语） | pentest_lib payload + util |
| `net` | `net::connect`、`net::rev_shell_listener` | TCP 连接 + 反弹 shell 监听收会话（RevShell 形态的攻击端） | pentest_rs net（SOCKS5 路由 fail-closed 思想后续） |
| `fingerprint` | `fingerprint::server` | 常见中间件指纹判定（Tomcat/Jetty/WebLogic 头特征）——Probe 步骤的标准实现 | MemShellParty probe 思想 + pentest_lib fingerprint |
| `webshell`（规划） | `webshell::php/jsp/asp` 模板 + `webshell::drive(url, cmd)` | 植入文件模板 + 经文件执行命令（WriteFile 形态标准支撑） | 用户裁定（专库） |

## 设计纪律

1. **IO 归闭包，判定纯函数**（module.rs 分工）：http 返回快照，判定在 Machine 步骤里做——小部件自身可规范驱动测试
2. ** Newtype 防 payload 串门**（pentest_lib payload.rs 先例）：危险类型（如 ShellPayload）不经构造器无法混用
3. **每个小部件带 selftest**（pentest_rs 件纪律）：`--selftest` 参数自证核心路径
4. 体积克制：只加当前需要的（KISS/YAGNI）；heavy 依赖进 lib 需 ADR（pi_rust_lib Cargo.toml 声明纪律）

## 已建 vs 待建

- ✅ report / machine / error（P2c）
- ✅ tls 双配置（rustls roots/danger，P2c）
- ⬜ http 快照面（第一批核心——脚本目前手写 TcpStream）
- ⬜ payload 构造小件（b64/url/bytes）
- ⬜ net::connect + rev_shell_listener（RevShell 形态攻击端）
- ⬜ fingerprint::server（Probe 标准实现）
- ⬜ webshell 模板+驱动（专库裁定）
