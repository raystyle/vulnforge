---

paths:

- "src/**"
- "tests/**"
- "package.json"
- "tsconfig.json"
- ".npmrc"

---

# Pi 扩展开发规则

## 编码规范

- TypeScript：`strict` + `NodeNext` + `noEmit` + `verbatimModuleSyntax` + `allowImportingTsExtensions`，target ES2022（Pi Jiti 直接加载 TS）；附加 `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride` + `noFallthroughCasesInSwitch`
- **品牌契约默认必用（所有工具，新旧一律）**：领域值（ID/枚举语义/路径/版本）一律 zod schema + `.brand<>()` 契约化——校验前置边界（YAML safeParse / DB 行 decode / 配置 parse），内部免检；裸 `string` 传领域值、`as` 逃避检查、`String()` 强转契约字段都是违规（工具 execute 边界的 StringEnum 参数窄化除外）
- **事件驱动状态机默认必用（所有工具，新旧一律，无豁免）**：一切工具执行逻辑（含单步请求-响应）一律 XState `setup()` 严格类型化（context/events/input）。转换只由事件触发，禁止 `always` 自循环与命令式隐藏状态；事件穷尽用编译期守卫（switch 全 case + never 兜底，模式见 `src/nuclei/sync-machine.ts` 的 `assertSyncEventHandled`），新事件未处理 = tsc 失败。无"简单单步"豁免——单步工具以最小状态机（idle→executing→done/failed）表达，保证生命周期可观测、可断点、可恢复
- **编译期暴露警告和错误**：能放 tsc 的约束不放运行时（品牌、判别联合、穷尽检查）；能放机械 lint 的不放人工（brand-lint/contracts-lint）；约定必须能报错和告警
- Biome 单工具管 format+lint：2 空格缩进、行宽 120、recommended 预设；战史规则挂 grit 插件固化（pi-extensions 模式）
- 依赖纪律：KISS/YAGNI 只加当前需要的依赖；Pi 核心已有功能不重复造；升级依赖解决类型错误而非降级代码；禁 `npm audit fix --force`
- 文件组织：单文件 >1000 行按职责拆分；`src/index.ts` 保持薄入口，实现放描述性命名的模块
- 注释：默认无注释，只在 WHY 非显而易见时写；英文
- 语言约定：代码标识符、注释、commit message 英文；文档中文

## 产品侧安全规则（五条红线）

1. **危险命令拦截**：扩展工具执行网络/删除/进程类命令前必须 `ctx.ui.confirm`；维护 askFirst 模式列表（`rm -rf`、`git push --force` / `git push -f`、`git reset --hard`、`drop table`、`delete data`、外部消息类）
2. **不可信输入**：模型输出/路径/会话文本不直接拼 shell/路径；TUI 输出剥离终端控制符
3. **密钥只经环境变量**：不落盘 evidence/日志/仓库
4. **敏感操作写独立审计日志**
5. **测试目标跑在 VM/容器**

## 包形态与依赖

- 单包 pi-package，入口 `src/index.ts`
- `@earendil-works/pi-*`、`typebox` → `peerDependencies: "*"` + devDependencies 钉版本（仅为 typecheck，不得移入 dependencies）
- `.npmrc` 开 `legacy-peer-deps`（npm 10 在 `peerDependencies: "*"` 上崩溃）
- `engines: node >= 22.19.0`

## 检查门（改动必须全过）

```powershell
npm run check
# = biome check + tsc --noEmit + brand-lint + contracts-lint + system-lint + vitest run + pi 加载检查（spawn 真实 pi --no-extensions -e src/index.ts --help 断言注册面）
```

**体系一致性（system-lint 全局核查）**：检查门清单 ↔ 四处文档（rules/verify skill/两份 README）、工具注册面 ↔ docs/tools.md ↔ 测试按名覆盖、ADR 文件 ↔ 索引、研究目录 ↔ 五件套、XState 状态机从入口可达（含棘轮底线）。任何一处脱节即 gate 失败；改门/改工具面/改资产结构必须同步所有派生文档，system-lint 会强制提醒。

**受控双语规范**：术语表、句长、代码命名形见 `.claude/rules/docs-style.md`。一概念一术语，中英与代码标识符三态对齐；工具 `vf_<域>_<动作>`、状态机 `*Machine`、守卫 `assert<Event>EventHandled`。system-lint 的 docs-terminology / docs-sentence-length / code-naming 三项机械执法。

## 修错纪律（类型错误批量收集）

**先收全量再修**：tsc 报错时一次跑完整 `npx tsc --noEmit` 拿全量错误清单、按文件分组、每个文件一次改完再复跑——禁止逐个修再逐个复跑。同文件同意图连续编辑 ≥3 次（修一个错冒下一个）是低效信号（实测 38 段、最长 8 连发）。

**工具脚本禁字面控制字符**：正则/字符串里的 ESC、BEL 等控制字符一律用 `RegExp` 构造 + `String.fromCharCode` 表达——字面控制字符会被格式化工具（biome unsafe fix）反复改坏（实战教训）。

## 测试分层

| 层        | 内容                                                 |
| --------- | ---------------------------------------------------- |
| `pure`    | 纯逻辑，无 mock                                      |
| `smoke`   | mock ExtensionAPI/ctx，断言工具/命令/flag/事件注册面 |
| `runtime` | 真实 runtime + 注入 Host 假件，不调真实模型          |
| `load`    | spawn 真实 pi 二进制验证加载                         |

- 真实模型验收走独立脚本，密钥只经环境变量，不进仓库
- Vitest 单测 5s 超时内完成，慢测试拆分而非加大超时

## 调试循环

```powershell
pi -e src\index.ts                        # 快速迭代
pi install .\                             # 真实验证 + TUI 内 /reload
pi --no-extensions -e src\index.ts        # 隔离排查（排除其他扩展干扰）
```

## 先例教训（长期规则）

- 扩展工厂加载期不得调用 Pi action 方法，推迟到 `session_start` 之后
- `agent_end` 是运行边界、`agent_settled` 是空闲边界——清理/重试/下一项激活用后者
- headless 会话资源挂 `sessionManager`，不挂 `ctx.ui`（headless 共享 no-op UI）
- 工具懒加载只走 `pi.setActiveTools()` 纯增量路径，激活期不移除/替换活动工具
- 生命周期测试先设 `PI_CODING_AGENT_DIR`；模块缓存路径用新 import
- 模型输出/路径/会话文本按不可信输入处理，显示边界剥离终端控制符
- 禁用 `npm audit fix --force`，依赖问题定点修复

## 先例参考

`.reference/pi-super/`（单包模板）、`.reference/pi-extensions/`（含 `docs/extension-conventions.md` 37KB 规范）。写实现前先查先例。
