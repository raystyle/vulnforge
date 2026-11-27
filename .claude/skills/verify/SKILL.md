---

name: verify
description: 验证流程：跑检查门 + 采集防假测试证据（退出码断言、测试数非零、新测试先红后绿、verbose 输出落盘 .research/<feature>/evidence/）+ 三平台 peer 轮（lan-ubuntu/lan-mac 兄弟工作台经 herdr 驱动）。当实现完成待验证、ship 前、或用户要求"验证这个改动"时使用。
---

# verify — 验证与证据采集流程

## 步骤

1. **确定 feature 名**：当前工作对应 `.research/<feature>/`；没有则先建（见目录约定）。
2. **跑检查门**：

   ```powershell
   npm run check   # biome + tsc --noEmit + brand-lint + contracts-lint + system-lint + vitest run + pi 加载检查
   ```

   断言**退出码为 0**。部分环境缺 pi 二进制时，显式报告"哪项被跳过"，不得静默当作通过。system-lint 红时先看报的是哪处资产脱节（文档/索引/状态机接线），修派生物而非删检查。
3. **防假测试证据**：
   - 测试数非零断言：`vitest run` 输出必须含 `Tests  N passed` 且 N > 0；N=0 的"全绿"是失败
   - **新测试先红后绿**：本次新增的测试，先故意破坏被测逻辑确认它失败，再恢复确认通过。把"先红后绿"的过程记入 evidence
   - 如有 SKIP 的测试，逐条列出原因
4. **证据落盘**：

   ```powershell
   npx vitest run --reporter=verbose > .research\<feature>\evidence\vitest-verbose.log 2>&1
   ```

   失败与通过均保留；evidence 只留关键文件，超大日志先裁剪。
5. **三平台 peer 轮**（本地门绿后）：见下节。
6. **写 result.md**（若 feature 流程中）：跑过的命令、退出码、测试数、SKIP 清单、先红后绿记录、三平台逐台结果。
7. **失败回路**：失败 ≤3 轮——修实现（回 Implement）/改计划（回 Plan）/重新研究（回 Research）由你判断并在 result.md 记录选择了哪条；第 3 轮仍失败强制停下，报告用户人工介入。

## 三平台 peer 轮（跨机器验证）

主开发机（Windows）本地门全绿后，推送 main，再让 lan-ubuntu / lan-mac 兄弟工作台（`~/repos/vulnforge`）拉取并跑同样的门——平台差异（路径分隔符、shell 语义、二进制缺失、文件系统行为）只有异地运行才暴露。

**操作序列**：

1. `git push origin main`（peers 从远端拉，不直接推 peers）
2. 逐台驱动。herdr 通道优先（SSH 直连可能走 IPv6 超时，herdr 走既有连接）：

   ```sh
   # 单命令模式：run 返回全地址，read 必须用全地址（短名在本机不解析）
   hc run --on lan-mac --bg --name pm-verify -- /bin/bash -lc \
     "cd ~/repos/vulnforge && git pull --ff-only && npm run check 2>&1 | tail -4; echo CHECK_EXIT=$?; npm run rs-lib 2>&1 | grep 'test result'; echo RSLIB_EXIT=$?"
   hc read lan-mac/tXX

   # 常驻 peer 会话模式（可多轮对话）：
   hc run --on lan-ubuntu --bg --name peer-linux --cwd ~/repos/vulnforge -- /bin/bash -lc "~/.local/bin/claude"
   hc send lan-ubuntu/tXX "git pull && npm run check ... 全绿报告 hc send t4b"
   ```

3. 长跑命令用 Monitor 等完成信号（`until hc read <addr> | grep -q DONE`），不轮询
4. 逐台收报：CHECK_EXIT / RSLIB_EXIT / 测试数；失败要求贴失败测试名与原因
5. 三台（含本机）全绿才收口进 result.md

**坑（逐台排查时先查这些，均有实战实例）**：

| 症状                                      | 根因                                                        | 处置                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| peer 大批文件变 0 字节（package.json 等） | peer 断电，ext4 把写一半的文件清零                          | `git status` 见 80+ 文件 M；`git checkout -- .` 从 HEAD 还原 tracked 文件；未跟踪区（.reference/）需重 clone |
| `npm: command not found`                  | 非登录 shell 无 nvm/PATH                                    | 用 `/bin/bash -lc`（login shell）                                                                            |
| ENOENT `.reference/...` 测试红            | `.reference/` 不进 git，peer 机没有该 clone                 | 测试必须 existsSync 探测 + console.warn SKIP（纪律：依赖本机才有资源的测试一律 skip-guard）                  |
| `rust-script not found` 测试红            | peer 未装 cargo 工具链                                      | 同上，spawnSync 探测 + SKIP                                                                                  |
| herdr `read` 空输出 / not_found           | 用了终端短名                                                | 用全地址 `machine/tXX`                                                                                       |
| `spawn_failed: cannot start "bash"`       | 相对程序名不解析                                            | 用绝对路径 `/bin/bash`                                                                                       |
| peer 机 e2e 大面积 SKIP                   | 工作区探测路径是 `~/repos/vulnforge-workspace` 而 peer 未建 | 设 `VULNFORGE_E2E_WORKSPACE` 指向实际工作区                                                                  |

**peer 轮失败分类（三类处置不同，混同会误修）**：

1. 环境缺失（装工具 / 测试该 skip-guard）——修测试的探测面
2. 代码平台差异（路径/编码/换行）——修实现
3. 测试假设错（大小写、正则、硬编码本机路径）——修测试

## 语言适配表

| 运行时            | 命令                                |
| ----------------- | ----------------------------------- |
| Node/TS（本项目） | `npx vitest run --reporter=verbose` |
| Node debug        | `DEBUG=* npm test`，输出重定向      |
| 其他              | 项目约定 debug 开关 + 输出重定向    |

## 纪律

- 证据链：research → plan → evidence → result → ship，缺环在 ship 时会被发现
- 不修改已确认的测试来让实现通过；实现与测试冲突时报告用户裁决
- 禁止 sleep/retry 强行让 flaky 测试通过；无法定位则报告并建议移除该测试
- 依赖本机才有资源的测试（参考仓 clone、本地二进制）必须 skip-guard——否则 peer 轮的红绿不可比较
- 三平台全绿才算验证完成：本机绿 ≠ 验证完成
