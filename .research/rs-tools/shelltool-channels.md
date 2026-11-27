# rs-tools — Java/.NET webshell 通道先例（2026-11-27，gh-mcp 检索 + MemShellParty 源码实读）

用户裁定：php 之外，java/.NET webshell 也要有专库支撑。检索先例 + MemShellParty 通道源码 dissect：

## 通道分类学（MemShellParty shelltool 实读，四语言通道形态）

| 通道                  | 语言     | 机制（源码确认）                                                                                                                 | Rust 侧实现位                                                  |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Godzilla**          | Java/JSP | header 门 + pass 参数 base64(AES) + md5 派生链 + 响应三明治（§5 dissect）                                                        | ✅ webshell.rs 已原生（stream_cipher 依赖零，AES 形态 ADR 门） |
| **Behinder 冰蝎**     | Java/JSP | header 门 + **请求体整行** base64(AES-128/ECB) + session 存 pass + defineClass 动态类——**payload 是 class 字节码**（非命令文本） | 增 `behinder_channel`：ECB + body 传输 + class 载荷形态        |
| **Command 内存马**    | Java     | param/header 双取参 → `Runtime.exec` → 回显输出（无加密——明文通道，配 header 门降特征）                                          | 增 `command_channel`：对应 ExecCommand 形态的内存马版          |
| **NeoReGeorg / Suo5** | Java     | 隧道型：HTTP 隧道转发流量（Web 代理后渗透面），非命令通道                                                                        | 规划（proxy 域，exploit 之后）                                 |
| PHP 一句话            | PHP      | `system($_GET/POST[cmd])` 明文（有特征，fallback）                                                                               | ✅ runtime.rs WebshellKind                                     |
| ASP/ASPX              | .NET     | `Process.Start` 型 + ViewState 反序列化植入（machineKey 面）                                                                     | WebshellKind::Aspx 模板 + runtime.ts DotnetPayload 路由        |

## ByPass 系（Tas9er/ByPassBehinder 849★ / ByPassBehinder4J 775★）——免杀生成先例

- 手法：**自动化免杀生成**——变异类名/方法名、拆分字符串、反射调用链变形，输出低检出率变体
- 对应 MemShellParty obfuscation 模块（class-obf：名称/常量混淆 + shrink）
- 落点：vf_rust_lib 用 ristretto_classfile 做 .class 常量/名称混淆（吸收思想，Rust 原生）

## 语言×通道矩阵（我们 webshell 专库的覆盖面）

| 通道                       | PHP                    | Java/JSP                                 | .NET                                    |
| -------------------------- | ---------------------- | ---------------------------------------- | --------------------------------------- |
| 明文 one-liner（fallback） | ✅ runtime.rs          | ✅ 模板                                  | ✅ 模板                                 |
| 加密通道（godzilla 形）    | ✅ webshell.rs 原生    | ✅ 通道协议同形（md5 派生 + AES）        | ✅ aspx_channel_template（同形，C# 面） |
| class 载荷（behinder 形）  | n/a                    | ✅ behinder_channel（ECB + class bytes） | ⬜（.NET 序列化载荷，nrbf 生成）        |
| 隧道（NeoReGeorg/Suo5 形） | ✅ php_tunnel_template | ✅ jsp_tunnel_template（Socket 形）      | ✅ aspx_tunnel_template（TcpClient 形） |

## .NET 面落点（2026-11-27 第一批）

- **aspx_channel_template**：godzilla 形通道的 ASPX 渲染（Request.Headers 门 + Form[p] 密文 + XOR + Process.Start 回显 + 三明治）——通道协议与语言解耦的第三实证
- **DotnetPayload 编排面**：`ysoserial_net_args()` 产出精确 CLI 参数向量（-g/-f/-o/-c）；复杂命令（`;`/`|`/`&`）走 `-s` stdin 模式（ysoserial.net README 转义指引）；soft atom 直接携带可执行调用串（agent 自取自用）
- **ViewStatePayload**：machineKey 泄露 → `-p ViewState --dk/--vk/--path/--apppath/--da/--va` 完整参数向量——密钥只进调用不落配置
- **serialized_kind_b64 补 `/wE` 前缀**：ObjectStateFormatter/LosFormatter 的 b64 面（FF 01 的 base64 形）
- 实测命令面对照源：pwntester/ysoserial.net README --fullhelp（gadget×formatter 矩阵、插件面、ViewState 选项）

## 隧道面落点（2026-11-27，用户指缺 Java/.NET 隧道后补齐）

- **先例实读**（L-codes/Neo-reGeorg templates + dflstone/NetReGeorg）：生产形态是**有状态会话隧道**——CONNECT/DATA 分帧（blv 变长二进制帧：字段号+长度+值）+ 按 mark 键的会话读写缓冲（PHP 用 $_SESSION、Java 内存马形用 static HashMap 经 equals() 触发、.NET 用 HttpRuntime.Cache）+ base64 字符表 strtr 混淆；操作端是 SOCKS5 循环
- **本批实现**：三语言无状态单轮隧道模板（php/jsp/aspx_tunnel_template）——forward-spec（`TARGET:PORT\nDATA_B64`）经加密通道载体，响应回密文中继字节；与 godzilla 通道同门同密码同三明治（隧道=通信加密形态的延伸裁定）
- **形态边界**：单轮形覆盖请求-响应协议（内网 HTTP/探测）；长连接协议（SSH/SOCKS 全双工）需会话形（mark 键缓冲 + 操作端循环）——下一批与操作端 SOCKS 面一起落，pve 靶场环做真实验证

## 设计结论

1. **通道协议与语言解耦**：godzilla 形（header 门+AES+派生链）在 JSP/PHP/.NET 落地形态不同但协议同构——Rust 侧实现协议面，模板按语言生成
2. **behinder 差异点**：请求体整行承载（非参数）+ 载荷是 class 字节码（defineClass）——Rust 侧 generate = ristretto 生成类 + AES 加密
3. **.NET 侧**：模板面照 cheat-sheet（Aspx），加密通道 + ViewState 反序列化载荷走 nrbf/ysonet 运行时路由
4. Command 内存马（明文+header 门）= ExecCommand 形态的落地标准——门降特征但不加密（输出需明文回显）
