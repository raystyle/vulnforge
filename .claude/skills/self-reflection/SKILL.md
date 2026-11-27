---

name: self-reflection
description: 会话自省流程：用 intent-trace 分析对话历史，提炼修正模式，晋级为 rule/skill/hook/ADR，并定义可验证的改进指标。当会话结束前、阶段性收口时、或用户要求"自省一次"时使用。

---

# self-reflection — 会话自省与改进闭环流程

## 输入

- 会话 transcript：`.claude/sessions/<id>.jsonl`（SessionEnd hook 自动镜像；无则从 `~/.claude/projects/` 手动 mirror：`npm run session-archive` 或 archiveSession）

## 步骤

1. **量化画像**（intent-trace）：

   ```powershell
   npm run intent-trace -- .claude/sessions/<id>.jsonl --limit 10
   ```

   采集四组数：文件数 / 文件事件数 / 用户指令数（真实 prompt，剔除 tool_result 与 `<` 开头的系统注入）/ 中断数。同窗口二次自省时只看增量。

2. **提炼修正模式**——从数据找五类信号：

   | 信号          | 数据特征                                  | 含义                           |
   | ------------- | ----------------------------------------- | ------------------------------ |
   | 重复指令      | 同一意图 prompt 出现 ≥2 次                | 我第一次没做对                 |
   | 术语/概念纠正 | prompt 含"不要 X 应该 Y"式表述            | 概念漂移，需术语铁律           |
   | 架构/边界裁定 | prompt 涉及目录归属/什么不是什么          | 边界未定义或被违反             |
   | 卡壳重试      | 同文件同意图连续编辑 ≥3 次（intent 相同） | 修法低效（逐个修 vs 批量收集） |
   | 中断集群      | 某时段中断密度显著高于均值                | 方向跑偏，用户在拉回           |

3. **裁定改进动作**——每个模式必须落为下列之一。否则记入 `.research/<feature>/notes.md` 的"未晋级教训候选"（候选必须带**指纹**，见第 5 步）：
   指纹 = 信号描述 + 数据特征归一化短句；同指纹候选跨会话累积 corroborations 计数。
   - **rule**（`.claude/rules/`）：跨会话的方法纪律（如类型错误批量收集、控制字符构造法）
   - **skill**（`.claude/skills/`）：多步过程（如本流程）
   - **hook**（`.claude/hooks/`）：必须机械强制的（如危险命令、证据检查）
   - **lint 检查项**（`tools/system-lint.mjs`）：可静态判定的模式（如术语表）
   - **ADR**（`.ad_records/`）：用户做出的方向决定（需用户确认）
   - **不改**：明确写出"为什么不改"（属必要推演/用户偏好/一次性事件）

   纪律：修正是**改结构不是改文档**——优先加机械检查（lint/hook/tsc），其次流程（skill/rule），最后才靠人记忆。

4. **定义验证指标**——每项改进回答"如何证明它生效了"：

   | 改进类型 | 验证方式（下次自省时对照）                         |
   | -------- | -------------------------------------------------- |
   | lint 项  | 先红（造违例确认报错）后绿（清零）；之后违例数恒 0 |
   | rule     | 对应信号在下次自省中不再现                         |
   | hook     | 触发日志可见；被拦操作数 > 0（或确认 0 次尝试）    |
   | 流程类   | 该场景的返工率下降（卡壳段数 / 中断数环比）        |
   | 卡壳类   | 同类卡壳的最长连发长度下降                         |

5. **落盘**：结论写 `.research/dev-system/notes.md`（或当前 feature）；带数据（多少条/几段/环比），不写叙事。
   - **候选 corroboration**（跨会话证据聚合，先例：maestro 知识系统的 candidate 机制——候选带内容指纹，跨 Run 聚合 corroboration，达到门槛才 promotion）：未晋级教训候选记为指纹表：

     ```markdown
     | 指纹（归一化短句）   | 首现会话/日期        | corroborations      |
     | -------------------- | -------------------- | ------------------- |
     | 「API 不熟先写了再改」 | d8cd2140 / 2026-11-26 | 2（+2 于 11-27）    |
     ```

     同指纹再次出现时**更新 corroborations 计数而非新增行**；`corroborations ≥ 2` 的候选是下次自省的**强制裁定项**——必须落为改进动作或明确写"不改"理由（此时才允许清出候选表）。
   - **长跑循环的结构化状态块**：若自省发生在 loop 中（/goal 驱动的多轮任务），长跑任务每轮收口时输出machine-readable 状态块，退出判定从 goal 语义升级为契约（先例：super-ralph 的 RALPH_STATUS）：

     ```text
     ---VF_STATUS---
     STATUS: IN_PROGRESS | COMPLETE | BLOCKED
     TESTS_STATUS: PASSING | FAILING | NOT_RUN   (附最后门禁退出码)
     REVIEW: CLEAN | PENDING | FAILING
     EXIT_SIGNAL: false | true
     BLOCKER: <一行，仅 BLOCKED 时>
     ---END_VF_STATUS---
     ```

     `EXIT_SIGNAL: true` 要求 TESTS_STATUS=PASSING 且 REVIEW=CLEAN——证据先于退出声明。

## 验证改进（下次自省的第 0 步）

1. 先对照上次自省的改进清单逐项检查：指标是否达成？未达成的列为新候选（可能修法不对，考虑换层：rule 没用就升 lint）。改进清空率本身就是体系健康度指标。
2. 扫候选指纹表：本次自省的信号先对表匹配指纹——命中即更新 corroborations 计数；`≥2` 的候选进入第 3 步强制裁定。

## 纪律

- 数据先行：先跑工具拿数，再下结论；感受不进自省
- 修正模式与改进动作一一对应，不允许"观察了但什么都不做"且不写原因
- 中断与重复指令是用户在为我买单——这两类信号优先级最高
- 候选表只进不丢：`corroborations < 2` 的候选永不清除（除非写明"不改"理由）——单次事件是噪声，两次独立出现就是模式
