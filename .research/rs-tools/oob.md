# rs-tools — 公共 OOB 集成先例研究（用户令，2026-11-27）

**裁定**：集成使用公共 OOB（Out-of-Band 回调面）——盲打漏洞（SSRF/反序列化/无回显 RCE）的 Verify 步骤标准支撑。检索 gh-mcp + pi-rs2 自有先例实读。

## 先例清单（检索验证）

| 先例 | 形态 | 集成方式 |
| ---- | ---- | -------- |
| **projectdiscovery/interactsh**（4.7k★） | OOB 交互收集 server+client 库；自托管/公共实例双选；DNS/HTTP/LDAP/RMI/SMTP 全协议；client 有 Go 库可程序化调用 | **首选**：interactsh 协议客户端（Rust 生态有兼容实现可引，或 CLI spawn 官方 client） |
| **Burp Collaborator 公共服务**（pi-rs2 burp_collab.rs 实读） | 自持 biid secret 派生 `<label>.oastify.com` 载荷；轮询 `polling.oastify.com/burpresults?biid=` 读回 DNS/HTTP 交互；**已验证公共服可用协议** | **第二**：协议同形（secret 派生 + 轮询），pi-rs2 已实现可吸收 |
| **DNSLog-GO / BugScanTeam/DNSLog**（1.3k/1.4k★） | 自托管 DNS+HTTP 记录监控，WEB 界面 | 自托管通道（pve 靶场环场景——内网不依赖公网服） |
| **cola_dnslog**（498★） | dnslog/httplog/ldaplog/rmilog 多协议 + API 调用 + docker 一键 | 自托管备选（API 面适合编排） |
| **Hyuga**（540★） | OOB 流量监控（DNS/HTTP/LDAP/RMI/DNS-Rebinding） | 备选 |
| **pi-rs2 oob_poll + dns_oob**（自研先例） | 权威 DNS canary 收件（自持 OOB 底座：任意子域全收 + JSONL 日志）+ marker 轮询客户端（租约轮询/超时结构化收束） | **自托管通道第三**：pve 靶场内网场景直接复用思想（收件器+轮询器闭环） |

## 公共 vs 自托管裁定矩阵

| 场景 | 通道 | 依据 |
| ---- | ---- | ---- |
| 公网授权目标 | interactsh 公共实例 / Burp Collaborator | 快、免部署；payload 带唯一 marker |
| 内网/lab（pve 靶场） | 自托管 DNSLog/cola_dnslog 或 pi-rs2 dns_oob 思想 | 内网不依赖公网服（pi-rs2：内网绑定 lab 基建不吸收——我们自建） |
| 隐蔽要求高 | 自托管（公共服通信本身可被流量审计标记） | 授权范围内自持 |

## 集成设计（vf_rust_lib `oob` 模块）

1. **`oob::mint(marker)`**：生成唯一 marker（子域+URL 双形——pi-rs2 oob_poll 同款），payload 即盲打探测值
2. **`oob::poll(marker, lease)`**：租约轮询（every-ms + deadline），命中回证据行（DNS/HTTP 交互），超时结构化收束（attempts/elapsed/deadline_hit——pi-rs2 同款信封）
3. **provider 抽象**：interactsh / collaborator / 自托管 dnslog 三 provider 实现 `poll` 接口——配置驱动（.vulnforge.json `oob` 段：provider + endpoint + secret）
4. **Machine 集成**：Verify 步骤的盲打形态 = Deliver 后 `oob::poll` 等回调——回调到达即 Done，超时即 Fail（Atom::timeout）
5. 公共服纪律：只对授权目标；payload 不含敏感数据（公共服可见）

## 坑（先例记录）

- burp_collab.rs：DNS 标签明文外传优先（免复制解码）；body 信道有丢字符风险须核 content_length_check
- 公共 OOB 服的交互记录可能被第三方读取——marker 后不带敏感外传数据
- 内网 lab 无公网出口时 DNS/HTTP 回调都不通——pi-rs2 解法是自托管收件器（dns_oob 自持底座）
