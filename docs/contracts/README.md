# 数据模型与契约文档

本目录归档 VulnForge 全部数据模型与品牌契约的权威文档。**代码即正本**（zod schema 为契约定义），本目录是给人读的对齐说明——两者不一致时以代码为准并修文档。

## 文档清单

| 文档                                           | 覆盖范围                                                                                           | 契约定义位置                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------ |
| [template-contracts.md](template-contracts.md) | nuclei 模板：文档契约（TemplateDoc）、元数据行契约（TplMetaContract）、SQLite 存储、FTS5、封版记录 | `src/nuclei/meta.ts`           |
| [env-contracts.md](env-contracts.md)           | 环境检测：检查项（EnvCheckItem）、镜像检查（MirrorCheckItem）、验收（EnvAcceptance）、平台命令矩阵 | `src/nuclei/env.ts`            |
| [config-contracts.md](config-contracts.md)     | 模板仓配置：.vulnforge.json 结构、db/tools/env 段                                                  | `src/nuclei/config.ts`         |
| [run-contracts.md](run-contracts.md)           | nuclei 执行：命中（NucleiHit）、运行结果（RunResult）、可用性（NucleiAvailability）、benign 反证   | `src/nuclei/run.ts`、`mock.ts` |

## 契约纪律（全文见 .claude/rules/pi-extension.md）

- **品牌契约默认必用**：领域值一律 zod + `.brand<>()`；校验前置边界（YAML safeParse / DB 行 decode / 配置 parse），内部免检
- 边界违规形态：裸 `string` 传领域值、`as` 逃避检查、`String()` 强转契约字段
- 机械强制（均已入 `npm run check` 门禁）：
  - `npm run brand-lint`（tools/brand-lint.mjs）——契约强转静态扫描；单行豁免 `// brand-allow` 需注明原因
  - `npm run contracts-lint`（tools/contracts-lint.mjs）——**文档完整性**：src/nuclei/ 每个导出契约符号必须出现在对应文档，缺失即 fail（防文档漂移）
