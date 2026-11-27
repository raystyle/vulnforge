# rs-tools — 公共 OOB 集成先例研究（用户令，2026-11-27）

**裁定**：集成使用公共 OOB（Out-of-Band 回调面）——盲打漏洞（SSRF/反序列化/无回显 RCE）的 Verify 步骤标准支撑。检索 gh-mcp + pi-rs2 自有先例实读。

## 先例清单（检索验证）

| 先例                                                         | 形态                                                                                                                                        | 集成方式                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **projectdiscovery/interactsh**（4.7k★）                     | OOB 交互收集 server+client 库；自托管/公共实例双选；DNS/HTTP/LDAP/RMI/SMTP 全协议；client 有 Go 库可程序化调用                              | **首选**：interactsh 协议客户端（Rust 生态有兼容实现可引，或 CLI spawn 官方 client） |
| **Burp Collaborator 公共服务**（pi-rs2 burp_collab.rs 实读） | 自持 biid secret 派生 `<label>.oastify.com` 载荷；轮询 `polling.oastify.com/burpresults?biid=` 读回 DNS/HTTP 交互；**已验证公共服可用协议** | **第二**：协议同形（secret 派生 + 轮询），pi-rs2 已实现可吸收                        |
| **DNSLog-GO / BugScanTeam/DNSLog**（1.3k/1.4k★）             | 自托管 DNS+HTTP 记录监控，WEB 界面                                                                                                          | 自托管通道（pve 靶场环场景——内网不依赖公网服）                                       |
| **cola_dnslog**（498★）                                      | dnslog/httplog/ldaplog/rmilog 多协议 + API 调用 + docker 一键                                                                               | 自托管备选（API 面适合编排）                                                         |
| **Hyuga**（540★）                                            | OOB 流量监控（DNS/HTTP/LDAP/RMI/DNS-Rebinding）                                                                                             | 备选                                                                                 |
| **pi-rs2 oob_poll + dns_oob**（自研先例）                    | 权威 DNS canary 收件（自持 OOB 底座：任意子域全收 + JSONL 日志）+ marker 轮询客户端（租约轮询/超时结构化收束）                              | **自托管通道第三**：pve 靶场内网场景直接复用思想（收件器+轮询器闭环）                |

## 公共 vs 自托管裁定矩阵

| 场景                 | 通道                                             | 依据                                                          |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| 公网授权目标         | interactsh 公共实例 / Burp Collaborator          | 快、免部署；payload 带唯一 marker                             |
| 内网/lab（pve 靶场） | 自托管 DNSLog/cola_dnslog 或 pi-rs2 dns_oob 思想 | 内网不依赖公网服（pi-rs2：内网绑定 lab 基建不吸收——我们自建） |
| 隐蔽要求高           | 自托管（公共服通信本身可被流量审计标记）         | 授权范围内自持                                                |

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

## 实现落点（2026-11-27，vf_rust_lib oob.rs 已落地）

- **interactsh 协议实读核定**（gh-mcp，pkg/client + pkg/server + pkg/storage）：注册体 JSON 键是 **kebab-case**（`public-key`/`secret-key`/`correlation-id`，Go tag 直译——camelCase 服务端解出空值）；公钥**强制**（`ParseB64RSAPublicKeyFromPEM` 空串即 400，无明文通道旁路）→ rsa/aes/ctr 原生依赖不可省；载荷 = correlation-id（20 字符 xid 字母表 `0-9a-v`）+ nonce（13 字符 zbase32）；轮询 `GET /poll?id=&secret=`，响应 `{data[], extra[], aes_key, tlddata[]}`——data 项 = base64(IV ‖ AES-256-CTR(json))，aes_key = base64(RSA-OAEP-SHA256 包裹的 32 字节密钥)；extra/tlddata 为明文 JSON；交互字段 `protocol/unique-id/full-id/raw-request/remote-address/timestamp`
- **correlation-id 检出规则**（pkg/server/util.go）：服务器按 `GetIdLength()=33` 滑窗扫 host 标签，首 20 字符必须 xid 字母表、后 13 字符 zbase32——mint 必须同形，否则交互不被归属
- **collaborator**：biid（32 字节 b64，环境变量 VF_OOB_BIID）→ sha1 → base36 双半 + 校验字符 → `{kh}1g{counter:x}yz` 双寄存器密码加密成标签；轮询 polling.oastify.com，content_length_check 守门随行
- **dnslog**：随机 12 字符标签 + 域名；轮询 URL 模板 `{marker}`/`{host}` 洞（VF_OOB_DOMAIN/VF_OOB_POLL_URL 环境变量）
- **配置面**：`.vulnforge.json` `oob` 段只载非密事实（provider/server/pollHost/domain/pollUrl）→ `oobEnvFor` 映射 VF_OOB_* 透传给脚本；**token/biid 只经用户环境变量**（VF_OOB_TOKEN/VF_OOB_BIID），不落仓
- **轮询闭环**：`poll_until(lease, poll_fn, matches)`——命中回 PollReport{hit,attempts,elapsed,deadline_hit,evidence}，超时结构化收束；auth_denied（401）即断不重试；Machine Verify 盲打形态：命中 → Outcome::Data(evidence)，超时 → Atom::timeout
- 测试 16 项：NIST SP 800-38A F.5.5 CTR 向量、OAEP+CTR 回环、PEM 形状对服务端解析器、协作方密码可逆、租约重试/超时/认证中断；公共服全流程标 `#[ignore]`（手工验证）
