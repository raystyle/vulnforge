# 受控双语规范（文档 + 代码命名）

> 参照 ASD-STE100（受控英语，~65 条写作规则 + ~900 词受控词典）、Microsoft Writing Style Guide（"one term, one concept"）、ruanyf/document-style-guide（中文技术文档写作）、W3C 中文排版需求。目标：降低跨 Agent 与人工审查的理解损耗；规范只约束**表达形式、术语、命名**，不替代事实核查与逻辑校验（归 /verify 与 REVIEW 独立审查）。

## 核心原则（四条，中英通用）

1. **一概念一术语**：同一概念在文档、代码、命令中各只有一个名字；禁近义词轮换
2. **短句**：中文单句 ≤60 汉字；英文指令句 ≤20 词
3. **一句一动作**：列表项不链式多动作（禁"然后/接着/再"串联，拆条）
4. **可追溯**：结论必须带证据（命令/退出码/测试数/evidence 文件）；主动语态

## 术语表（概念 ↔ 中文 ↔ 英文 ↔ 代码标识符）

| 概念          | 中文正术语 | 英文正术语           | 代码标识符                              | 中文禁用         |
| ------------- | ---------- | -------------------- | --------------------------------------- | ---------------- |
| XState 状态机 | 状态机     | state machine        | `*Machine`（如 `syncMachine`）          | 机器、状态引擎   |
| 检查门        | 检查门     | check gate           | `npm run check`                         | 门禁、闸门       |
| 模板仓        | 模板仓     | templates repo       | `TemplatesRepo`                         | 模板库、模板仓库 |
| mock 靶机     | 靶机       | mock target          | `MockTarget` / `startMockTarget`        | 目标机、靶标     |
| 契约          | 契约       | contract             | `*Schema` + `.brand<>()`                | 约束类型         |
| 品牌类型      | 品牌类型   | branded type         | `.brand<"...">()`                       | 类型标记         |
| 封版          | 封版       | seal                 | `seal()` / `verifySeal()`               | 定版、锁定       |
| 工具          | 工具       | tool                 | `vf_<域>_<动作>`（如 `vf_nuclei_lint`） | 插件函数         |
| 命令          | 命令       | command              | `/vf[-<名>]`（如 `/vf-debug`）          | 斜杠函数         |
| 事件守卫      | 穷尽守卫   | exhaustiveness guard | `assert<Event>EventHandled`             | 穷举检查         |

- **"机器"指代 XState 概念是最严重违例**（本项目实战教训：状态机写成机器导致概念漂移）
- "机器"仅允许指物理计算机（如"跨机器同步""新机器"）
- 新术语进表：先查 `.research/` 与既有代码用法，经用户确认后增删；发现违例改文不改表
- 表内术语在 README.md（中文）与 README_EN.md（英文）中必须成对一致

## 中文规则

- 单句 ≤60 汉字；表格、代码、路径、命令、frontmatter 行豁免
- 中英文之间加空格（`XState 状态机`）；数字与单位同理
- 标点全角（中文语境）；括号内容为纯英文/代码时可用半角
- 主动语态："工具执行 X"，不用"X 被工具执行"

## 英文规则（STE 适配）

- 指令句 ≤20 词、主动语态、一般现在时
- 一个词只取一个词性与词义（受控词典思想：本项目以术语表 + 代码标识符为准）
- Sentence case 标题；禁 idiom 与口语缩写（don't → do not）

## 代码命名规范（与术语表联动）

| 对象        | 形式                             | 例                                    |
| ----------- | -------------------------------- | ------------------------------------- |
| 工具名      | `vf_<域>_<动作>` 全小写下划线    | `vf_nuclei_lint`                      |
| 命令名      | `/vf[-<名>]` kebab               | `/vf-debug`                           |
| 文件名      | kebab-case.ts                    | `sync-machine.ts`                     |
| 类型/接口   | PascalCase                       | `ToolExecutionMachine`                |
| 状态机导出  | `<名>Machine` 后缀               | `MockLifecycleMachine`                |
| 穷尽守卫    | `assert<Event>EventHandled`      | `assertSyncEventHandled`              |
| 常量        | SCREAMING_SNAKE_CASE             | `WIRED_MACHINES_FLOOR`                |
| 契约构造器  | camelCase 名词（与 Schema 同根） | `remoteTarget` / `RemoteTargetSchema` |
| 注释/commit | 英文                             | —                                     |

## 证据约束（研究文档专属）

- result.md 结论行必须可追溯：引用命令、退出码、测试数或 evidence 文件
- 结论措辞以"实测表明/先例显示"开头，不用"应该/决定"（决策归 ADR）

## 执法

- `tools/system-lint.mjs`：
  - `docs-terminology`：术语表违例（含"机器"指代状态机）报错，范围 = README/README_EN、docs/、.ad_records/、.research/、.claude/
  - `docs-sentence-length`：中文长句检查（豁免表格/代码/路径行）
  - `code-naming`：工具/命令/状态机/守卫命名形检查
- 修文不改检查；检查误报经用户确认后调整规则正本（本文件）
