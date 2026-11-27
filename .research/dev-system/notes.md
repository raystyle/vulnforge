# dev-system — notes

## 未晋级教训候选

（暂无——单次事件待 ≥2 次重复才晋级）

## 晋级记录

### 2026-11-27（/self-reflection，用户令：为 Rust 部件开发建立 claude rule）

**数据来源**：session d8cd2140（全量 transcript 22520 行，Rust 批次窗口）。

**量化画像**：

- cargo/clippy 运行 115 次，FAIL 67 次（58%）
- ≥3 连败段 ×10（最长 7 连 ×3：http.rs API 不熟链、B 类测试失败链、oob 先红验证链）
- vf-rust-lib 编辑 88 次：mutate.rs 21 / webshell.rs 17 / lib.rs 10 / machine.rs 9 / http.rs 8
- 用户纠正信号（Rust 窗口）：隧道面只做 PHP 被用户抓缺（"JAVA WBSHELL、net webshell的隧道呢？研究下啊"）——矩阵完整性缺横向检查

**五类信号 → 改进动作**：

| 信号                       | 数据特征                                                                                      | 裁定          | 落点                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| API 不熟返工（卡壳）       | ureq send_bytes 参数、Response 方法面、Iterator Item 生命周期——写了再探再改，贡献 7 连败段 ×2 | **rule**      | rust-lib.md「先探 API 再写调用」——grep 本地 registry 源码确认签名                                     |
| clippy 惯用法连发（卡壳）  | is_multiple_of/len_zero/useless_vec/should_implement_trait 各一轮往返                         | **rule**      | rust-lib.md「clippy 惯用法直接照改」                                                                  |
| 协议实现错误（正确性）     | interactsh kebab-case 键、strtr 位置级置换模型错误（语义级测试暴露）                          | **rule**      | rust-lib.md「协议实现纪律」——对端源码实读 + 标准向量 + 语义级测试                                     |
| 表-执行器漂移（隐性）      | mutate 表 implemented 标志与执行器不同步风险；漂移方向有盲区（false+有执行器不触发）          | **lint-测试** | `table_and_executor_are_in_sync` 测试（先红已验证：gzinflate 标 true 即红）+ rust-lib.md 漂移方向说明 |
| 模板完整性缺口（用户抓缺） | 隧道 PHP 先行，Java/.NET 后补——三语言矩阵缺横向断言                                           | **rule**      | rust-lib.md「三语言对称性」逐面断言三要素                                                             |

**验证指标**（下次自省对照）：

- rule 生效判据：Rust 窗口 cargo/clippy FAIL 率从 58% 降；≥3 连败段数下降；「先探 API」后 ureq/rsa 类 API 返工不再出现
- 漂移测试：违例恒 0（已先红验证）
- 用户抓缺类（矩阵完整性）：下次自省不再出现"用户指出某语言面缺失"

**晋级动作文件**：`.claude/rules/rust-lib.md`（新建，paths 域 vf-rust-lib/**）+ `.claude/README.md` 资产表更新 + `vf-rust-lib/src/mutate.rs` 漂移守卫测试
