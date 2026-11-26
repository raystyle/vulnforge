# nuclei 引擎深入研究（.reference/nuclei）

研究日期：2026-11-26。来源：projectdiscovery/nuclei@dev（shallow clone），重点文件 CLAUDE.md、SECURITY_CONTEXT.md、DESIGN.md、pkg/workflows/、pkg/templates/、pkg/model/、pkg/catalog/loader/。

## 1. 引擎架构（对我们的映射价值）

| 引擎组件                         | 职责                                                                       | VulnForge 对应物                       |
| -------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| `cmd/nuclei` → `internal/runner` | CLI 入口 + 编排                                                            | ScanPort real 适配器（spawnCollect）   |
| `pkg/templates.Parse`            | 模板解析/编译/缓存；**workflow 也在这里编译**（子模板一并加载）            | TemplateDocSchema.parseTemplateFile    |
| `pkg/protocols/*`                | 每协议 Request 接口（Compile/ExecuteWithResults/Match/Extract）            | detectProtocol（11 协议枚举）          |
| `pkg/operators`                  | matcher/extractor 逻辑                                                     | lint.ts 的 weak-matcher 分析（静态侧） |
| `pkg/catalog/loader`             | 发现 + 过滤（tag/severity/path）+ **模板聚类**（相同 HTTP GET 合并省请求） | collectYamlFiles + FTS search          |
| `lib/`                           | **SDK：nuclei 作为库嵌入**（不走 CLI）                                     | 未来真实引擎深度集成候选               |

**执行流**：loader 装载 → HostErrorsCache（错误超阈值跳 host）→ WorkflowLoader → 编译 Executer → 聚类 → work pool 执行 → operators 匹配 → 输出。

## 2. Workflow 模型（编排模板的权威定义）

```go
type Workflow struct { Workflows []*WorkflowTemplate }
type WorkflowTemplate struct {
  Template   string              // 单模板或目录（如 "dns/worksites-detection.yaml"）
  Tags       StringSlice         // 按 tag 选模板执行
  Matchers   []*Matcher          // 基于前置模板结果名的匹配（触发 subtemplates）
  Subtemplates []*WorkflowTemplate // 匹配后递归执行
}
```

要点：**workflow 自身没有 matcher/extractor**（匹配在 operators 层，由子模板产生）；WorkflowMatcher 是"按结果名匹配"而非 HTTP 响应匹配。protocol 枚举里 `WorkflowProtocol = "workflow"` 是一等协议类型。

→ 对我们的修正意义：

1. lint 的 `matcher/missing` 对 workflow 协议是**误报**（引擎从不要求 workflow 有 matcher）——需豁免
2. **WorkflowContract 缺失**：TemplateDocSchema 不解析 `workflows:` 块内容（template/tags/matchers/subtemplates 树）——元数据层至少应索引其引用的模板/目录清单（subtemplate 引用完整性是 lint 的真检查点：引用不存在的模板 = 真 error）

## 3. 安全上下文（引擎安全战史——SECURITY_CONTEXT.md）

仓库 646 个安全相关 commit 挖出的 Top 风险与固定模式（与我们工具面的关联）：

| 引擎风险类                                                                                        | 位置                              | 与 VulnForge 的关联                                                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| SSRF（IPv4-mapped IPv6 规范化绕过、ws/wss 网络策略）                                              | protocolstate/headless            | **我们的 mock/远程目标参数同样要做 URL 规范化**——`target` 参数接受 `http://[::ffff:127.0.0.1]` 类形式可绕过"远程"边界判断 |
| 模板签名验证绕过（缓存信任 → 密码学验证，CVE-2026-76819；javascript 模板强制签名 CVE-2026-76805） | templates/compile、catalog/loader | 元数据层应索引 `signature` 状态（上游 code/javascript 模板必须带 PD 签名——我们已有 check-signing 的知识，可入 lint）      |
| 代码执行（fuzz 变量重渲染、表达式渲染边界）                                                       | pkg/fuzz、expressions             | lint 提醒：`{{}}` 嵌套求值出现在 matcher words 里时是引擎执行面                                                           |
| TLS 证书验证绕过（exporters）                                                                     | reporting/exporters               | 与我们无直接关系                                                                                                          |

**11.8% 的修复重复同一模式**——与我们"Miss→Rule 晋级"机制同理：上游也靠 SECURITY_CONTEXT.md 固化战史。

## 4. 对 VulnForge 的行动清单

1. **lint.ts**：`matcher/missing` 豁免 workflow 协议（detectProtocol = workflows）；新增 `workflow/ref-integrity` 检查（workflows[].template 引用的文件在语料中存在）
2. **meta.ts**：WorkflowContract——`workflows` 块解析为 `subtemplateRefs: string[]`（template/tags 两形态），入库可查"哪些 workflow 引用了此模板"
3. **meta.ts**：protocol 枚举确认含 `workflow`（string 值，注意是单数 `workflow` 非 `workflows`——引擎 ProtocolType.String() 返回 "workflow"）
4. **run.ts 远程模式**：URL 规范化（IPv4-mapped IPv6 canonicalize 后再判断是否本地/授权），抄引擎 d43c1f547f 的教训
5. （远期）`lib/` SDK 嵌入替代 CLI spawn——进程内真引擎，去掉二进制依赖

## 5. 顺手收获

- 引擎的模板聚类（相同 GET 合并）解释了为什么 14475 模板对单目标实际请求量可控
- HostErrorsCache 模式可借给我们的批量 run（错误超阈值跳 host）
- `OfflineHTTPProtocol`（被动/replay 型）是独立协议类型——我们枚举里没有，若语料出现 offline http 模板会落到 detectProtocol 兜底 http
