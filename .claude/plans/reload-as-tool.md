# 草案：reload-as-tool（让 Agent 自己触发 /reload）

> 状态：**草案，未接线**（不注册进 `src/index.ts`，不影响 `npm run check` 门禁）。
> 起因：2026-11-27 验收回环——`b483919`/`29e8d3d` 修好 `nuclei_search` 的 totalCount，
> 但源码直接引用路径的活进程仍跑旧模块，`/reload` 又无法在 agent 运行中发生
> （`@earendil-works/pi-coding-agent/docs/extensions.md:1538`："Pi cannot reload while the agent is running"）。
> 结果：修复已验证（单独跑 `db.search` → `rows=50 totalCount=70`）却无法在同会话自证。

## 1. 结论（实测/先例）

- 上游自带完整先例：`examples/extensions/reload-runtime.ts`（命令 `ctx.reload()` + 工具置位 + `agent_settled` 补发命令）。
- API 形状已在本机类型里核实（`@earendil-works/pi-coding-agent@1.5.0`）：
  - `ExtensionCommandContext.reload(): Promise<void>` → `dist/core/extensions/types.d.ts:347`
  - `pi.on("agent_settled", handler)` → `dist/core/extensions/types.d.ts:1261`
  - `pi.sendUserMessage(text, { expandPromptTemplates: true })` → `dist/core/extensions/types.d.ts:1320-1323`
  - **工具结果支持 `terminate?: boolean`** → `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:391`
    （docs 示例里的 `terminate: true` 是合法的，不必绕路）
- reload 语义：`await ctx.reload()` 会先对旧运行时发 `session_shutdown`，随后以 `reason: "reload"` 发
  `session_start` / `resources_discover`；**该 handler 之后的代码仍跑旧版本**（`docs/extensions.md:1529-1536`）。

## 2. 设计

三件套，全部落在 `src/index.ts` 的注册面 + 一个新模块 `src/reload.ts`（机器与纯逻辑；**不放进 `src/nuclei/`**，那里被 `system-lint` 的 dead-machine 检查按域扫描）。

```
src/reload.ts
  ├── ReloadIntentMachine        # XState setup：idle → REQUEST → pending → DISPATCH → dispatched / RESET → idle
  ├── assertReloadIntentHandled  # 编译期穷尽守卫（switch 全 case + never）
  └── createReloadIntent()       # 包 actor：request(reason) / takePending() / phase()
```

状态机（满足 `.claude/rules/pi-extension.md:19` 事件驱动状态机默认必用，无单步豁免）：

```
idle ──REQUEST(reason)──▶ pending ──DISPATCH──▶ dispatched ──RESET──▶ idle
pending ──RESET──▶ idle        # 失败/放弃时可回收，不留僵尸请求
```

`src/index.ts` 追加（与现有 `withToolMachine` 风格一致）：

```ts
const reloadIntent = createReloadIntent();

pi.registerTool({
  name: "vf_reload",
  label: "VulnForge runtime reload",
  description:
    "Reload Pi extensions/skills/prompts/themes/context files after editing VulnForge source. Ends the current run; Pi reloads once the agent settles.",
  parameters: Type.Object({
    reason: Type.Optional(Type.String({ description: "Why a reload is needed (audit line)" })),
  }),
  execute: withToolMachine("vf_reload", async (_id, params) => {
    const requested = reloadIntent.request(params.reason ?? "");
    if (!requested) return textResult("reload already pending — the runtime reloads when this run settles");
    return {
      content: [
        {
          type: "text",
          text: "Reload requested. Pi reloads after this response; tools keep the pre-reload version until then.",
        },
      ],
      details: {},
      terminate: true, // 单调用批次才会真正提前结束（见风险 §5.2）
    };
  }),
});

pi.registerCommand("vf-reload", {
  description: "Reload extensions, skills, prompts, themes, and context files",
  handler: async (_args, ctx) => {
    ctx.ui.notify("VulnForge: reloading runtime…", "info"); // reload 后已在新实例，通知必须前置
    await ctx.reload();
    return; // reload 对该 handler 是终态
  },
});

pi.on("agent_settled", () => {
  if (!reloadIntent.takePending()) return;
  pi.sendUserMessage("/vf-reload", { expandPromptTemplates: true });
});

// 让下一轮知道"工具面已经变过"
pi.on("session_start", (event) => {
  if (event.reason !== "reload") return;
  pi.appendEntry?.("vf_reload", { at: new Date().toISOString() });
});
```

要点：

- **请求状态存活期正确**：模块级 actor → reload 后是新模块、新 actor（`idle`），天然不会重放旧请求。
- **不在工具里调 reload**：工具拿到的是 `ExtensionToolContext`，没有 `reload()`；也不能在 agent 运行时 reload（`docs/extensions.md:1538`）。
- **单次收口**：`agent_settled` 里 `takePending()` 同时置 `dispatched`，避免 settle 多次重复补发。

## 3. 门禁影响（必须同步改的地方）

| 门禁                                          | 要求                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/system-lint.mjs:641` `code-naming`     | 工具名只允许 `^(vf_init\|poc_<x>_<y>\|exploit_<x>_<y>)$` → **`vf_reload` 会红**，需扩为 `^(vf_(init\|reload)\|...)$`（**需用户裁决**） |
| 同上（命令）                                  | `vf-reload` 符合 `^vf(-[a-z-]+)?$` ✅                                                                                                  |
| `tools/system-lint.mjs:83` `tools-md-surface` | `docs/tools.md` 必须出现 `vf_reload`、`vf-reload`；工具表加行 + `### vf_reload` / `### /vf-reload` 小节（命令表在 55 行附近）          |
| `.claude/rules/pi-extension.md:19`            | 状态机必需；若将来挪进 `src/nuclei/`，导出名必须以 `Machine` 结尾                                                                      |
| `biome` / `tsc`                               | 2 空格、双引号、分号；`params.reason` 走 typebox Optional                                                                              |
| `CHANGELOG.md`                                | 记一条 unreleased                                                                                                                      |
| docs 命名表                                   | `.claude/rules/docs-style.md` 命名表补 `vf_reload` 行（与 code-naming 同步）                                                           |

## 4. 测试计划（先红后绿）

`tests/reload.intent.test.ts`（纯逻辑，不碰 Pi）：

1. `idle` 收 `REQUEST` → `pending`；`takePending()` 返回 true 且相位变 `dispatched`
2. 连续两次 `REQUEST`，第二次返回 false（不覆盖首个 reason）
3. `pending` 收 `RESET` → `idle`，随后 `takePending()` false（无僵尸）
4. `idle` 直接 `DISPATCH` 被忽略（不越级）

`tests/tools.reload.test.ts`（用 `tests/helpers/capture.ts` 的 `loadExtension` 假 pi）：
5. 断言注册面存在 `vf_reload` / `vf-reload` / `agent_settled` 三个订阅
6. 调 `vf_reload.execute()` → 结果带 `terminate: true`；触发假 `agent_settled` → 捕获到
`sendUserMessage("/vf-reload", { expandPromptTemplates: true })`
7. 无请求时 `agent_settled` 不发消息（幂等）

## 5. 风险与边界

1. **terminate 是"批次提示"不是"立即中断"**：只有该批所有 tool result 都 `terminate: true`，
   run 才提前结束（`types.d.ts:1125` 注释）。所以要文档化"**单独调用 `vf_reload`**"，
   与其它工具同批时应忽略其终止性、靠 settle 兜底。
2. **reload 期间工具面不一致**：从工具返回到 reload 完成之间，模型可能继续调用旧工具 →
   `terminate` + 结果文案明确"旧版本在 reload 前继续生效"。
3. **坏代码热载风险**：reload 会把语法/加载错误的扩展直接带进去 → 工具建议先跑 `npm run check`；
   命令侧在 reload 前 `notify`，失败信息由 Pi 的扩展加载告警承接（`docs/packages.md:19` 同类失败不致命）。
4. **无 UI/无 `agent_settled` 的环境**（RPC/headless）：`sendUserMessage` 仍可用；`ctx.ui.notify` 需
   `hasUI` 守卫（先例：`src/index.ts` 现有命令里的用法）。
5. **工具面文档漂移**：新增两个注册项没同步 `docs/tools.md` 会被 `system-lint` 拦下（这是好事）。

## 6. 验收（本草案的目标）

在活会话里编辑 VulnForge 源码后：

```
vf_reload(reason="totalCount 修复已 pull")   → terminate，run 结束
（settle 后自动 /vf-reload）                 → session_start reason=reload
nuclei_search "CVE-2021-44228"          → 70 match(es) (showing top 50 by relevance):
```
即不必再人工发 `/reload`，本次验收里那一步就能自证。

## 7. 待裁决

- [ ] `vf_reload` 命名是否放行（扩 `code-naming` 正则）。备选：`vf_init reload`（`action` 枚举加 `reload`，
      复用现有 `vf_init` 工具面，零命名改动，但语义上 tinit 是"环境初始化"）。
- [ ] 是否需要 `reason` 参数（还是固定文案，少一个旋钮）。
- [ ] 是否要在 reload 后自动回显一条面变更摘要（工具数增减）——需要 diff 旧/新注册面，成本略高，暂不做。
