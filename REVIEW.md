# REVIEW.md — 审查规则正本

> 本文件是 VulnForge 的审查规则正本。审查代理（reviewer，代码+安全一体）**从 main 分支读取本文件**（`git show main:REVIEW.md`），分支上的变更不得修改自己的检查。新增规则经用户确认后合并到 main 才生效（Miss → Rule 晋级）。
>
> 分级：**Always blocking**（不修不能 ship）/ **Report even though**（建议修，不阻断）/ **Never report**（明确忽略，不浪费时间）

## Always blocking

任何修改本文件（REVIEW.md）、`.claude/rules/`、`.claude/agents/reviewer.md` 的改动试图与功能改动混在同一个 commit/PR——审查规则变更必须独立成 commit，单独 review

- 测试断言基于 grep 测试计数而非退出码（计数会漂移；vault42 教训）
- 新测试没有先证明它能红（破坏被测物 → 看它失败 → 恢复 → 看它绿）。从未失败过的测试是声明，不是检查
- `npm run check` 门禁链里新增命令却未断言其退出码（`cmd1 && cmd2; other` 会吞掉前面状态）
- 检查/门禁在前置缺失时 SKIP 静默通过——SKIP 必须在输出中显式报告（vault42 教训：新机器全绿其实什么都没跑）
- Pi 扩展代码在工厂加载期调用 Pi action 方法
- 危险命令（网络/删除/进程）执行前无拦截确认（项目安全红线）
- 验收/脚本中的密钥写入仓库文件（密钥只经环境变量）

## Report even though

- 否定断言（`expect(x).not.toContain(y)` 类）没有正向对照——空输入会让它空转通过
- 测试只覆盖路由层未覆盖入口点（`src/index.ts` 的加载路径）
- `catch` 块吞错误或只 `console.log` 不传播
- 任何 `npm audit fix --force`、依赖降级掩盖类型错误
- 超过 5s 的 Vitest 单测未拆分
- 注释/文档与代码行为不一致（过期注释）
- 代码标识符/注释/commit message 出现中文

## Never report

- 代码风格偏好（缩进宽度、引号风格）——交给格式化工具
- 未采用某能力但项目已明确拒绝（不用 Changesets）
- 测试文件命名/组织方式的偏好性意见
- 先例代码自身的风格问题（`.reference/` 只读，不审）

## 维护

- Miss → Rule：同一类问题在审查/回路中出现 ≥2 次且可从 diff 识别 → 提议新规则条目，经用户确认后追加到对应档位
- 规则演进必须独立 commit + 单独 review（见 Always blocking 第一条）
- 本文件保持精简：规则条目失效时删除，不留"已废弃"标记
