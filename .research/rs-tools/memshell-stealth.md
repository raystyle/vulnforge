# rs-tools — 内存 webshell 稳定隐蔽植入 + WAF 变形绕过先例研究（2026-11-27）

用户裁定两项新研究：① 初始稳定隐蔽植入内存 webshell 不被发现；② exploit 考虑变形绕过 WAF。均需库与先例支撑。

## 1. MemShellParty（`.reference/memshell-party/`，本地 clone 实读）

Java 内存马生成器生态标杆（类 Jenkins 般全面）：

| 维度                                         | 实现形态                                                                                                                            | 对 VulnForge 的启示                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **ServerType 分类学**（api/ServerType.java） | 23 种中间件常量：Tomcat/Jetty/JBoss 全系/Resin/GlassFish/WebLogic/WebSphere/Spring MVC+Flux/国产（Apusic/BES/TongWeb6-8/Primeton）… | 内存植入面的**能力矩阵**：target×server 枚举闭环                                          |
| **ShellType 分类学**（api/ShellType.java）   | Servlet/Filter/Listener/Valve/Upgrade/ProxyValve/Handler/Netty Handler/Agent 系/Interceptor + Jakarta 变体                          | **植入位置枚举**：内存马的落点类型（每型对应注册进容器的组件钩子）                        |
| **ShellTool 对接**（api/ShellTool.java）     | Godzilla/Behinder/AntSword/Suo5/NeoreGeorg/Custom——加密回连协议                                                                     | 操作端：植入后驱动内存马的工具协议                                                        |
| **obfuscation/ 混淆门面**（core）            | class-obf 字节码混淆（名称/字符串/控制流）+ gzip→base64 单字符串 LDC 嵌入 injector（65535 UTF8 常量上限 → 49149 字节 gzip 约束）    | **隐蔽的落地形态**：payload 编码进单个字符串常量，二阶变形                                |
| **Packer 注册表**（packer/）                 | 26 种投递包装器：base64/deserialize（各反序列化链）/ognl/spel/el/groovy/velocity/freemarker/xslt/jsp/jar/xxljob/translet…           | **变形通道分类学**：按漏洞面（表达式注入/反序列化/SSTI）选择包装器——变形=按通道换编码载体 |
| **probe/ 探测马**（core）                    | 独立 ProbeShell：CommandProbe/ServerProbe/JdkProbe/FilterProbe×9 中间件/OsProbe + DnsLog/Sleep/Response 三种回显确认方式            | **稳定植入前置**：先探测服务类型（对应探测结论=可生成的内存马类型），再植入               |
| **无侵入性 + 测试矩阵**                      | 不影响正常流量；integration-test 容器化全矩阵（每个 server 的 docker-compose + 断言注入无异常流量）                                 | **稳定性的验证方式**：植入后正常流量回归断言                                              |
| **探测↔服务对应**                            | "探测出来的服务类型，即是可生成内存马的服务类型"（非中间件名，如 Apusic→GlassFish 因二开）                                          | 探测层与植入层直接同键连接                                                                |

### MemShellParty 模式提炼（写入我们设计的吸收点）

1. **枚举闭环**：ServerType × ShellType × ShellTool × Packer 四轴分类学——每轴是封闭枚举，组合即 payload 的完整坐标。我们的 vf_rust_lib 应有同形四轴（Rust 版）。
2. **Probe 先行**：植入前必探测（ServerProbe 定容器），与我们 Machine 的 Probe 步骤语义完全一致——探测定型，植入与探测同键连接。
3. **验证三态**：植入后 DnsLog/Sleep/Response 回显三选一确认存活（无侵入确认，不产生可疑流量）——Verify 步骤在内存马场景的具体化。
4. **字节码压缩+单常量嵌入**：隐蔽的核心是 payload 不以可读类形态出现在 class 里（gzip+base64 LDC）。

## 2. WAF 变形绕过（`.reference/waf-bypass-cheatsheet/` + gh-mcp 检索）

| 先例                             | 形态                                                                                                                         | 启示                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CHYbeta/WAF-Bypass（cheatsheet） | 分类学：命令执行（`${IFS}`、`<>` 重定向、`%1a`、宽字节、未初始化变量 `$9`）、SQL 注入（注释符/大小写/编码）、XSS、上传、SSRF | **变形原语集**：空格替代、引号变形、注释插入、编码轮换、大小写——正交小原语组合出大量变体 |
| nemesida-waf/waf-bypass（1.5k★） | 字典驱动 WAF 自检（检测自家 WAF 误拦截）                                                                                     | 字典+正则匹配的变异器形态                                                                |
| BypassPro（burp 插件 1.3k★）     | 请求重放变异：对同一请求做自动变形再试                                                                                       | **变异策略引擎**面：对 payload 应用策略集→重发→比对拦截差异                              |
| WhatWaf（2.9k★）                 | 检测 WAF 型号 + 120+ 内置绕过                                                                                                | WAF 指纹↔绕过策略映射表                                                                  |

### 变形绕过模式提炼

1. **正交原语**：变形不是黑盒，是一小组正交原语（空格替代/编码轮换/等价表达式/大小写/注释插入）的组合代数
2. **指纹→策略**：WAF 指纹（WhatWaf）→ 应用对应策略集；先知道拦什么再变形什么
3. **变异-重发-比对闭环**：变形引擎的价值在"试"——发变体、比拦截差异、收敛到可行变体
4. **通道选择**：MemShellParty Packer 的启示——变形的最高形式是**换编码载体**（不变形 payload，变形包装层：ognl/base64/反序列化链）

## 3. 落入 vf_rust_lib 的设计结论（用户裁定待确认）

| 模块                  | 内容                                                                                                                                                  | 先例依据                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `memshell`（Rust 版） | 四轴分类学（ServerType/ShellType/ShellTool/Packer）+ 植入（injector）/验证（回显三态：dnslog/sleep/response）/操作（Godzilla/Behinder/Suo5 协议）三面 | MemShellParty 全量                              |
| `mutate`              | 正交变形原语集 + WAF 指纹→策略映射 + 变异重发比对引擎（data 里带 tried_variants + outcomes）                                                          | cheatsheet 原语 + WhatWaf 映射 + BypassPro 闭环 |

注意（边界，待用户确认）：Java 字节码生成（ByteBuddy/ASM）在 Rust 侧不可移植——内存马本体生成保留 Java 生态（MemShellParty 生成字节码）。vf_rust_lib 的 memshell 模块做**编排与操作**：调用生成器、植入投递、回显验证、工具协议驱动，不做字节码生成。

## 3.5 .NET 反序列化 / NRBF（用户补充选型，2026-11-27）

- 格式识别：NRBF 魔数 `00 01 00 00 00 FF FF FF FF 01 00 00 00`（BinaryFormatter，Remoting/剪贴板/存档）；JSON 带 `$type`（Newtonsoft）；MessagePack/protobuf-net 无全局头
- Rust 侧解析选型：**nom**（NRBF 动态 Record 结构按 RecordType 分支）或 **binrw**（已知结构派生宏）；7-bit Encoded Int 变长读取（.NET 字符串长度前缀）；netcorehost 可进程内宿主 .NET 调 C# 逻辑（复杂 ISerializable 兜底）
- 安全红利：纯数据解析器不动态实例化类型——天然隔离 Gadget Chain 代码执行（BinaryFormatter 已被官方废弃标记）
- 用途：.NET 反序列化漏洞利用链的 payload 构造与取证分析（exploit 域 dotnet 消费者——vf_init 已检测 dotnet SDK）

## 3.6 Java 序列化 / 反序列化（用户补充选型，2026-11-27）

- 魔数：`AC ED 00 05`（base64 常以 `rO0AB` 开头）；漏洞本质 = 不安全反序列化入口 + classpath 有 gadget chain
- Rust 侧选型（解析/生成/检测三层，与 .NET 同构）：
  - **解析**：`java-serialization` crate（全 TC_* 类型码 + handle 引用 + block data；内置 JDK 8u20 payload 适配；已测 ~35 条 ysoserial 链；serde 输出 JSON）或 `jaded`（FromJava trait 映射）——纯解析器不实例化对象，内存安全红利同 NRBF
  - **生成**：`ysoserial-rs`（emo-crab/ysoserial-rs：cc1-7/cck*/spring1/2/hibernate/jdk7u21/jdk8u20/url_dns/groovy/clojure；CLI 可执行命令 + DNS 交互 + hex/base64/bin 输出，亦可作 crate 嵌入）
  - **检测**：魔数扫描 + 深度解析 + 已知 gadget 特征匹配（InvokerTransformer/TemplatesImpl/PriorityQueue 等）
- 流程定位：exploit 域的 java 反序列化链 = WriteFile/ExecCommand 形态的经典通道（Packer 对应 deserialize 面）
- 注意：主流 gadget 发现仍在 Java 生态（GadgetInspector/SerdeSniffer）；Rust 做解析生成检测集成层

## 4. 坑

- MemShellParty 的"无侵入性"依赖测试矩阵实证（integration-test docker 全矩阵）——我们 pve 靶场环正好承接（第二批计划）
- 反序列化链（CommonsCollections 等）本身就是 Packer 的一种——通道即攻击面
- WAF 变形的对抗性：变形原语需要持续更新（cheatsheet 2017 的部分技巧已失效，如宽字节）——原语集做成数据不是代码

## 5. 无特征通道研究（用户裁定：webshell 无特征字串、通信无 WAF 拦截特征——MemShellParty Godzilla 实读）

### 5.1 Godzilla 协议 dissect（shelltool-godzilla 源码）

四要素——每项都是无明文特征设计：

1. **header 门**：请求头 name/value 双定制（headerName/headerValue 配置化）——WAF 按 URI/参数特征拦截失效，门开在任意路径
2. **参数取值**：POST 参数名 = pass（定制），内容 = base64(AES(payload))——密文即报文体，无 shell 语法字串
3. **密钥派生链**（生成期固化）：md5Key = md5(key)[0:16]；md5 = md5(pass+md5Key) 大写；AES key = md5Key——三次派生，密钥与明文永不传输
4. **响应对称**：响应 = md5[0:16] + base64(AES(result)) + md5[16]——响应体也是密文三明治，无明文回显特征

### 5.2 隐蔽机制（吸收点）

| 机制                    | 效果                      | 吸收方式                                               |
| ----------------------- | ------------------------- | ------------------------------------------------------ |
| 配置化 header 门        | 通信入口不在 URL 特征里   | vf_rust_lib webshell 模块：植入/驱动均带随机 header 门 |
| AES 密文通信            | 报文/响应无明文命令或回显 | 驱动走 AES(base64()) 双向                              |
| md5 派生链              | 密钥不出现在通信/文件中   | key/pass 只在生成期，只存派生结果                      |
| ClassLoader defineClass | 字节码不落盘              | Java 生态能力；Rust 侧 ristretto 生成 .class           |
| 混淆 + shrink           | class 内无常量特征串      | ristretto 生成后做名称/常量混淆                        |
| 无侵入验证              | 探测不产生可疑流量        | Verify 步骤用 Response 回显三态                        |

### 5.3 落入 vf_rust_lib webshell 模块的裁定

- **模板面**：one-liner（有特征）降为 fallback；标准形态 = 加密通道模板（header 门 + AES 通信 + md5 派生）
- **驱动面**：`webshell::drive(url, cmd)` = 构造 header 门 + AES 加密 cmd + 解密响应——WAF 看到任意 POST + 密文
- **验证面**：植入后 Response 回显三态确认存活
- **生成面**：ristretto 生成 .class 时常量混淆 + gzip+base64 单常量嵌入
