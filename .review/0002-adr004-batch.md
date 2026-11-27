# 0002 — ADR-004 exploit 锻造批次独立审查（b0c6443..0788ea7，2026-11-27）

- 审查者：reviewer 代理（新上下文，未参与编写；REVIEW.md 正本 hash d36df13a 与工作区一致）
- 范围：12 commit（oob / mutate / .NET webshell 面 / 隧道 / widgets / 配置分层），约 5100 行
- 结论：**5 blocking + 16 report + 3 never-report；修完 5 blocking + 实机冒烟后收口**

## Blocking 修复记录

| #   | 发现                                                                                                      | 修法                                                                                                                           | 状态         |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| B1  | PHP 模板双缺陷：空密钥（`wrap_command("")`→零长 `$k`→`$i%$c` 除零）+ 门键未规范化（`HTTP_X-PJAX` 不存在） | `php_key_literal`（16 字节 md5-key b64 载体）+ `php_header_key`（大写 + 连字符转下划线）；php_channel 与 php_tunnel 双模板同修 | ✅ 已修+实机 |
| B2  | ureq Transport Display 携完整 URL → `?biid=`/`?secret=` 泄进 Atom 消息与信封（踩密钥红线）                | `redact_url`（oob.rs：剥 query 只留 host）+ http.rs `map_transport` 改 `transport.kind()`                                      | ✅ 已修      |
| B3  | resolveLayeredConfig 吞工作区解析错——坏配置静默切全局层，写工具写进 `~/.pi/agent`                         | findTemplatesRoot 单独 try（仅"未找到"回退）；loadConfig 错误直接上抛；补测试（坏工作区配置必须报错不回退）                    | ✅ 已修      |
| B4  | chr_splice 产物语法损坏（`.` 优先级低于调用，args 绑到最后一个 chr()）+ special_chars_insert 括号不平衡   | chr_splice 改统一可变调用形 `(chr(..).chr(..))(args)`（实机 php:8 验证执行成功）；special_chars 双字符区间替换；补括号平衡断言 | ✅ 已修+实机 |
| B5  | constant_split 测试恒真（单引号输入绕过双引号扫描，断言对原文恒真）                                       | 双引号输入 + 20-seed 扫描 + 重组还原断言；死代码注入补 `<?php` 前不插入断言                                                    | ✅ 已修      |

**审查后追加发现**（修复过程中自查，同根因）：

- php_channel_template 回显未 base64（unwrap_response 期望 b64 载体，JSP/ASPX 均编码）→ 补 `base64_encode($o)`
- php_channel_template 无执行步（只解密回显命令本身）→ 补 `exec($o,$rl,$rc)` 完整 godzilla 语义（JSP/ASPX 同形）
- unwrap_response 字节切 `&str` 在非字符边界 panic（review R2，不可信响应打崩脚本）→ 字节级比对 + 多字节敌意输入测试

**实机验证**（WSL docker php:8-cli，reviewer 建议）：

- PHP 通道模板全链：密文 body → 门 → 解密 → `exec` → 输出加密 → 三明治回显 → Node 端解出 `"hello-from-php"` ✓
- chr_splice 括号形：`(chr(115).…)('echo mutate-ok')` 实机执行输出 `mutate-ok` ✓

## Report 项处置

| #                                                                                                                            | 处置                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R1 NIST 单块 / R3 entry_class / R4-R7 mutate 面 / R8 文档漂移 / R9 铁律语义 / R10 http 面 / R11 带端口 server / R16 品牌统一 | 留下批（pve 批次统一清）                                                                                          |
| R12 exploit_rs_run 无 confirm 门                                                                                             | **记录待用户裁定**：dangerous 面无确认门与 poc remote 不对称——涉及"本地监听+任意目标"的确认语义，属产品裁定非 bug |
| R13 oob.pollUrl 带凭证风险                                                                                                   | 文档已写"密钥只经环境变量"；pollUrl 若含 token 同理归环境变量——留下批在 config 契约文档明示                       |
| R14 全局层写注释                                                                                                             | 注释已随 B3 修复更新语义                                                                                          |
| R15 证据断档                                                                                                                 | 本轮修复后已补全量门记录（TS 190+9 / rust 91+1）                                                                  |

## 门禁（修复后）

- `npm run check` exit 0：TS 190+9，system-lint 14/14，contracts-lint 210/210，pi-load 过
- `npm run rs-lib` exit 0：fmt --check + clippy -D warnings + cargo test 91+1
- 三平台：Windows 本机 ✓（本轮）；peers 待下轮 pull 验证

## 遗留

- R12（exploit_rs_run confirm 门）需用户裁定
- R1/R3-R11/R16 report 项进 pve 批次清单
