---

name: verify
description: 验证流程：跑检查门 + 采集防假测试证据（退出码断言、测试数非零、新测试先红后绿、verbose 输出落盘 .research/<feature>/evidence/）。当实现完成待验证、ship 前、或用户要求"验证这个改动"时使用。
---

# verify — 验证与证据采集流程

## 步骤

1. **确定 feature 名**：当前工作对应 `.research/<feature>/`；没有则先建（见目录约定）。
2. **跑检查门**：

   ```powershell
   npm run check   # tsc --noEmit + vitest run + pi 加载检查
   ```

   断言**退出码为 0**。部分环境缺 pi 二进制时，显式报告"哪项被跳过"，不得静默当作通过。
3. **防假测试证据**：
   - 测试数非零断言：`vitest run` 输出必须含 `Tests  N passed` 且 N > 0；N=0 的"全绿"是失败
   - **新测试先红后绿**：本次新增的测试，先故意破坏被测逻辑确认它失败，再恢复确认通过。把"先红后绿"的过程记入 evidence
   - 如有 SKIP 的测试，逐条列出原因
4. **证据落盘**：

   ```powershell
   npx vitest run --reporter=verbose > .research\<feature>\evidence\vitest-verbose.log 2>&1
   ```

   失败与通过均保留；evidence 只留关键文件，超大日志先裁剪。
5. **写 result.md**（若 feature 流程中）：跑过的命令、退出码、测试数、SKIP 清单、先红后绿记录。
6. **失败回路**：失败 ≤3 轮——修实现（回 Implement）/改计划（回 Plan）/重新研究（回 Research）由你判断并在 result.md 记录选择了哪条；第 3 轮仍失败强制停下，报告用户人工介入。

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
