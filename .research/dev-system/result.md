# dev-system — result

## 体系闭环（system-lint）

- 先例依据见 notes.md（manypkg 检查注册表 / syncpack 单一事实源方向 / knip 可达性 / pm-skills 自研校验器）。
- 交付：`tools/system-lint.mjs`，14 项检查（gate-docs-alignment / tools-md-surface / adr-index-alignment / research-feature-alignment / hook-watchlist-alignment / machines-wired / machine-rule-echoed / skill-shape / hook-shape / claude-md-current / test-tool-alignment / docs-terminology / docs-sentence-length / code-naming），`npm run check` 第七项门。
- 执法效果（实测表明）：资产关联脱节在提交前被拦截。曾抓出的真实脱节：文档未同步新检查门；状态机模块未接线；stop hook 监视目录过期；中文文档以近义词指代状态机；超长句。
- 修复方向：改派生物，不改检查（误报经用户确认后调整规则正本）。
- 命令：`node tools/system-lint.mjs` → `system-lint: all 14 checks pass`，退出码 0。

## 错误信封（Round 8）

- 一切工具失败原子暴露：vf-error code=<稳定码>（11 码封闭集）+ detail（offending 输入 + 解析后实际值）+ hint（下一步）
- 实测表明：contracts-lint 映射缺 errors.ts/tool-machine.ts（导出符号未被核查）——补映射后 143→151 全文档化
- 三平台全绿（Windows 106+9 / ubuntu 103+12 / mac 103+12，共 115）；wrapAsVfError 幂等（重包装信封是 no-op）

## 配置自动发现修复（Round 7）

- 实测表明：工具从语料 clone 内调用时 findUp 被止于 .git 守卫阻断，永远找不到工作区配置——修复为就近标记 findUp（嵌套 clone 穿透）
- 缺配置报诊断错误：搜索起点 + 层数 + 内联最小配置示例（安装后的插件无仓库 docs，指引必须自包含）
- 三平台全绿（Windows 100+9 / ubuntu 97+12 / mac 97+12，共 109）

## 三平台验证（Round 6）

| 平台         | system-lint | vitest                       | 全门      |
| ------------ | ----------- | ---------------------------- | --------- |
| Windows 主机 | 14/14       | 99 passed / 9 skipped (108)  | ✅ exit 0 |
| lan-ubuntu   | 14/14       | 96 passed / 12 skipped (108) | ✅ exit 0 |
| lan-mac      | 14/14       | 96 passed / 12 skipped (108) | ✅ exit 0 |

- system-lint 纯文本+fs，无平台分支，三平台行为一致
- vitest 差异为环境性：Windows 有 workspace（e2e 9 项跑）+ nuclei；两 peer 无 workspace/nuclei（对应 SKIP，显式非静默）
- 单步工具最小状态机（ToolExecutionMachine）已接入全部 9 个工具，7 项 pure 测试三平台通过

## 受控双语规范

- 交付：`.claude/rules/docs-style.md`（四原则 + 术语表 + 句长 + 代码命名形）+ system-lint 三项机械执法（docs-terminology / docs-sentence-length / code-naming）
- 实测表明：首跑即抓出存量违例（9 个中文文档 20 处近义词指代、3 处超长句），当日全部修正

## 全量审查（reviewer + security-reviewer 独立代理）

- 代码审查：1 blocking（rules 与功能代码混 commit，e4e23d0/713e8d2）；4 report（README_EN/CLAUDE.md 实际未被术语检查扫到=执法静默缩水；信封 4 个死码+2 处散文残留；hook URL.pathname 百分号编码路径不匹配；reachability 只处理一层 ../）
- 安全审查：1 blocking（transcript 含密钥载体永久留仓，defeats 全局清理）；4 report（intent-trace 终端转义注入；findUp 信任边界扩大到根+ReDoS；session_id 未验形；gitignore 不匹配子目录）
- 修复完成（4d6e409，用户裁定全修）：安全 4 项（退出开关/信任边界重设计/session_id 验形+gitignore 递归/转义剥离+fileURLToPath）+ 代码 4 项（执法范围真实化/信封 4 码补产生点+headless confirm 拒绝/散文清零/混装 commit 记为后续规则）；headless env_install 直接执行是安全审查带出的额外真漏洞，已修
- Round 9 三平台：mac 全绿 122+12（mac 报告：连 biome info 都清零）；linux 报告待回；Windows 125+9 全绿
