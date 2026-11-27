# vf-rust-lib 开发规则

> Rust 侧物化库（`vf-rust-lib/`，exploit rs 脚本的标准库）与 TS 插件面（`src/`）分工：本规则只管 Rust 侧；TS 侧见 `pi-extension.md`。两套规则同源同纪律——品牌契约、错误原子、模板强制、门全过——只是语言载体不同。

## 何时载入

改 `vf-rust-lib/**`（源码、测试、mutate-primitives.json、Cargo.toml）时自动载入。

## 检查门（改动必须全过）

```powershell
npm run rs-lib    # cargo fmt --check + cargo clippy --all-targets -- -D warnings + cargo test
```

与 TS 门（`npm run check`）平行：改两侧的批次两个门都要跑。clippy `-D warnings` 把 warning 升 error——修代码不留 allow（`#[allow]` 需在 commit message 里给理由）。

## 修错纪律（TS 侧同款，先收全量再修）

- tsc/clippy 报错一次跑完整命令拿全量清单、按文件分组、每个文件一次改完再复跑——禁止修一个错复跑一次
- **先探 API 再写调用**：对不熟悉的 crate API（尤其 ureq/rustls 这类版本差异大的），先 `grep` 本地 registry 源码（`$CARGO_HOME/registry/src/*/crate-version/src/`）确认签名再写——本项目实战中 `send_bytes` 参数个数、`Response` 方法面、`Iterator::Item` 生命周期都是写了再返工的
- **clippy 惯用法直接照改**：`is_multiple_of`、`!is_empty`、`useless_vec`、`should_implement_trait`（`next` 改名 `draw`）——这些修一次全仓清零，不要 allow 掉

## 协议实现纪律（oob/webshell 通道类）

- **对端源码实读**：协议字段（kebab-case vs camelCase）、加密链（RSA-OAEP + AES-CTR）、响应结构必须从对端仓库源码核定，不凭记忆写——interactsh 的 `public-key`/`secret-key`/`correlation-id` kebab-case 键就是实测教训（camelCase 服务端解出空值）
- **标准测试向量**：加密原语用公开向量断言（NIST SP 800-38A F.5.5、RFC 1321 MD5）；协议形用对端解析器同构回环（PEM 形状 → PKIX 解析回公钥）
- **语义级测试**：跨语言协议（PHP strtr 重复键首胜）要在测试里模拟目标语言的真实语义，不能用"看起来对"的简化模型——strtr 的位置级置换模型实测就是错的
- 密钥红线：token/biid/machineKey 只经环境变量或调用参数，永不进配置文件/日志/仓

## mutate 数据面（表驱动纪律）

- 原语是**数据**（mutate-primitives.json，include_str! 嵌入）：改原语属性改表不改码；weight=0 免重编译禁用
- **表-执行器同步测试**（`table_and_executor_are_in_sync`）：implemented=true 的原语必须有执行器。注意漂移方向——该测试只捕获"标了 implemented 但无执行器"；反向（implemented=false 但执行器存在）不触发，新增执行器时必须同步翻表标志
- 变体生成必须**种子确定性**（SplitMix64）：同 seed 复现同变体——变异-测试闭环的可复现前提
- 新原语先在测试里证明可逆/等价（载波 rot13 反解回明文、strtr 语义模拟解码回 system），再标 implemented

## 模板纪律（生成目标语言代码时）

- 生成的模板（webshell/tunnel/behinder）自带**无签名断言**：`!contains("system(")` 等黑名单检查进测试——模板泄漏明文 shell 语法是回归
- 三语言对称性：同一通道协议落 PHP/JSP/ASPX 三面时，测试逐面断言门/密码/回显三要素都在
- 嵌入值（派生密钥/密码）经 format! 注入模板前先过 escape 检查——引号/反斜杠会破坏生成代码

## 模块结构

- 每个模块（widgets）：IO 归闭包/widget，判定纯函数（http 快照可重放、fingerprint 纯函数判定）——与 TS 侧"状态机 + 判定分离"同构
- `Atom` 七 kind 封闭集 + 内化建议不变；新模块的错误码 `E_<域>_<NNN>` 稳定不复用
- 新模块进 `src/lib.rs` 的 `pub mod` 列表；依赖只加当前需要的（KISS），heavy 依赖（ysoserial-rs embed 等）ADR 门
- 测试内嵌 `#[cfg(test)] mod tests`（同一文件）；公共服/真网络用例标 `#[ignore]` 注明手工验证
