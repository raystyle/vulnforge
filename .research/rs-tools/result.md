# rs-tools — result

- 先例研究（本地 clone 实读）：pi-rs-plugins（rs_execute/rs_search 原型：advisory lint、AgentResult 单行信封、显式降级、392 件三源 catalog）、pentest_rs（pctl export 五平台 cargo zigbuild——musl/windows 导出实证；nuclei2rs 转译）、fornwall/rust-script（substrate 契约）、pve-harness rust 分支（dry-run 默认、vulhub up/wait/down、--json/--llms 面）
- 结论：rs_search 用 SQLite FTS5 替换 zvec（预编译 core 只 linux-x64 是平台耦合坑；FTS5 纯 TS 跨三平台）；rs_new/rs_edit 按骨架生成 + 契约校验切面设计（先例证明编辑可由普通 write/edit 承担）
- 规划草图在 notes.md（三批：rs 四件套 → rs_export → pve 靶场验证环）；全部待 ADR 确认

## 验证记录（2026-11-27，ADR-004 批次：oob + mutate + .NET webshell 面，commits a770020/65267e9/82a8982）

实测表明，全部门绿：

| 门                | 命令                                                                                          | 退出码 | 结果                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| TS 七项门         | `npm run check`                                                                               | 0      | biome + tsc + brand-lint + contracts-lint(207/207) + system-lint(14/14) + vitest 184+9 + pi-load |
| Rust 门           | `npm run rs-lib`                                                                              | 0      | fmt --check + clippy -D warnings + cargo test 63+1                                               |
| e2e（真实工作区） | `VULNFORGE_E2E_WORKSPACE=D:/repos/vulnforge-workspace npx vitest run tests/tools.e2e.test.ts` | 0      | 9/9（SKIP 已解除）                                                                               |

- **evidence**：`evidence/{check-gate,rs-lib-gate,cargo-test,vitest-verbose,e2e-verbose}.log`
- **先红后绿记录**（4 例，全红后还原复绿）：
  1. oob NIST 向量：翻转 XOR keystream（`mask ^ 1`）→ `aes256_ctr_matches_nist` 红（left/right 不符）
  2. mutate rot13 载波：移位 13→12 → `base64_and_rot13_layers_hide_the_payload` 红（反解不回明文）
  3. TS oobEnvFor：删除 provider 映射 → `oobEnvFor always sets the provider` 红（2 用例）
  4. aspx 模板断言破坏例（弱证据，弃用——破坏的是测试非实现，不计入）
- **SKIP 清单**：默认运行 9 个 e2e SKIP——原因 = 工作区探测路径 `~/repos/vulnforge-workspace`（homedir）在本机不存在；设 `VULNFORGE_E2E_WORKSPACE` 后 9/9 全过。cargo 侧 1 ignored = `interactsh_full_flow_public`（设计如此：注册公共服属手工验证面）
- **失败回路**：1 轮——e2e 暴露潜伏测试缺陷（`/no fix commands|cancelled|ran:/` 正则大小写敏感 vs 信封 `CANCELLED`；本机 nuclei 缺失走拒绝路径）。修法 = 正则加 `i` 旗标（测试意图"绝不静默安装"本就两路径皆收），非实现改动。已提交
- 备注：首轮 AES-CTR 红例尝试（keystream 初值 1）无效——该值每轮被覆盖，非真破坏点；换 XOR 输出点后红成功。教训：先红验证要打断被断言的计算路径本身

## 三平台 peer 轮（Round 11，commit 9c246e3 后）

| 平台         | check                                                    | rs-lib | 备注                                                                                                     |
| ------------ | -------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Windows 本机 | exit 0（184+9 / 207 契约 / 14 项 system-lint / pi-load） | 63+1   | —                                                                                                        |
| lan-ubuntu   | exit 0（181+12 skip / pi-load 过）                       | 63+1   | 断电恢复后：ext4 清零 80 文件 → `git checkout -- .` 从 HEAD 还原 tracked；`.reference` ENOENT 修复后复验 |
| lan-mac      | exit 0（181+12 skip / 207 契约 / 14 项 / pi-load）       | 63+1   | 无平台问题                                                                                               |

- **peers 暴露并修复的 2 个测试缺陷**（commit 9c246e3）：`.reference/pi-rs2` 引用测试无 skip-guard（peer 机无 clone 必挂）；rust-script runtime 测试无二进制探测。两者均按既有纪律改 console.warn SKIP——peers 的 12 skip = 本机 9 skip + 这 2 项环境缺失，对账成立
- **peer 断电事件**：lan-ubuntu 在验证中途掉电（journal 显示 EXT4 恢复 + 写一半文件清零）；tracked 文件全部从 HEAD 还原后全绿。教训已沉淀进 verify skill 的坑表
- **验证方式沉淀**：三平台 peer 轮流程（herdr 全地址驱动 + login shell + Monitor 等完成 + 失败三分法）增补进 `.claude/skills/verify/SKILL.md`
