---

name: work-state
description: VulnForge 工作状态（2026-11-26 晚）：首功能（nuclei 模板一条龙）六模块+Pi 工具面完成，五项检查门全绿；待 git init 与三平台基线验证（均暂缓等用户指令）
metadata:
node_type: memory
type: project
originSessionId: d8cd2140-8dfa-43c0-8e0b-a189c6c104d9
modified: 2026-11-26T06:21:06.047Z
---

# VulnForge 工作状态（2026-11-26）

**首功能主体已落地**（ADR-003，模板仓 `D:\repos\vulnforge-templates` 独立仓）：

- 六模块：config（.vulnforge.json 契约）/ lint（结构+弱 matcher）/ mock（可编程靶机+benign 反证）/ run（spawn 收集，修 execFile Windows 死锁）/ meta（zod 品牌契约+drizzle+FTS5+封版哈希）/ scaffold（五类骨架）/ env（三平台检测+中国镜像+安装+验收）
- Pi 工具面（src/index.ts）：vf_env_check、vf_env_install、vf_template_{lint,run,sync,search,new} + /vf、/vf-debug
- mock-nuclei CLI（scripts/mock-nuclei.py，uv 自包含）测调用方；靶机+真 nuclei 验证模板
- **五项检查门全绿**：biome → tsc → **brand-lint**（新，品牌契约强制）→ vitest 38/38 → pi load
- 体系 REVIEW 完成：全资产去 ADR 噪音（自包含）；docs/contracts/ 四份契约文档归档

**三平台**：Windows 主机 + lan-ubuntu/lan-mac 工作台（herdr peer-linux/peer-mac，cwd `~/repos/vulnforge`，已 ready 待任务）。三机 pi 均已安装（1.5.0/1.4.0/1.4.0-级别，pi 版本对齐检查已入 env 契约）。

**Why:** 功能实现阶段推进中，等用户指令推进基础设施与验证。

**How to apply:**

- **git init + 首次提交**：待用户指令执行（.gitignore 就绪：node_modules/.reference/dist/.claude/worktrees/.claude/settings.local.json；.research/、docs/、adr/ 进 git）
- **三平台基线验证**（主仓→peer 工作台同步→三平台 npm run check 对拍）：用户说"以后再说"，勿主动启动
- ADR-003 剩余：实现后的 /verify 证据落盘、reviewer/security-reviewer 独立审查、ADR-003 最终产物节更新
- 实战教训（勿回退）：execFile 在 Windows 对 Go 二进制死锁（用 spawnCollect）；WAL 下 seal/verify 都先 wal_checkpoint；resolveInsideRepo 分隔符无关化；scaffold id 折叠连续分隔符
- ADR 纪律见 [[feedback-adr-scope]]：起草→用户确认→写入
