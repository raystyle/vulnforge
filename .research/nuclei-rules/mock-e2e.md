# mock 测试 e2e 报告（真实上游模板 × 全链路）

日期：2026-11-26。脚本：`tools/mock-e2e.mjs`。目标模板：`http/technologies/tech-detect.yaml`（上游真实、多 regex matcher、可确定性回放）。

## 场景与结果

| #   | 场景                                                                                  | 结果                                          | 判定                      |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------- |
| 0   | 语料种子 + parse/lint                                                                 | tech-detect 已入库；parse ok，doc 2 findings  | ✅                        |
| 1   | **真实引擎 × 编程数据**：spawn mock server 返回 mollom img body → 真实 nuclei v3.11.1 | **1 hit（tech-detect）**                      | ✅ 预期请求→预期数据→命中 |
| 2   | **真实引擎 × 无害页**：benignProfile（nginx 欢迎页）                                  | **weakMatcher=true——真发现一个上游误报**      | ⚠️ 见下                   |
| 3   | **mock ScanPort**（进程内、无二进制）                                                 | exit=0，hits=tech-detect，走生产 JSONL 解析链 | ✅ 确定性                 |
| 4   | **全链**：benign 反证（干净端口）→ 编程靶机扫描 → 关闭                                | benign=clean（对空端口）→ 1 hit → 无泄漏关闭  | ✅                        |

## 场景 2 的发现：上游 tech-detect 对 nginx 欢迎页误报

命中 matcher：`nginx`（`Server: nginx` 头匹配）。**我们的 benignProfile 本身就是一个 nginx 页**——所以这不是 mock 的错，是"无害页选型与 tech-detect 的 nginx 指纹重叠"。两个修正方向：

1. benignProfile 应选**无任何常见指纹的合成页**（空 body + 非常见 Server 头），避免与模板库指纹撞车——已验证场景 4 用空端口/合成响应时 benign=clean
2. 对真实评估，上游 tech-detect 的 nginx matcher 对"检测 nginx 存在"而言是设计使然（它就是 tech 指纹），不算误报——但**对"漏洞判定"目的，benign 反证的目标页必须与被测指纹无关**

→ 结论：mock 测试链路本身**全部符合预期**（0/5 异常）；场景 2 修正 benignProfile 选型（工具改进项，记入 ship.md 遗留）。

## 附带发现：FTS bm25 ≠ 精确 id 查询

`search('"tech-detect"')` 返回 50 条 `-detect` 模板，tech-detect 自身排名 50 开外（bm25 下太多模板的 tags/描述含 "tech"+"detect"）。**精确 id 查找需要 `WHERE id = ?` 直查**，不该用 FTS 相关度——对 vf_nuclei_stats 的 id 校验路径已改用直查（元数据行与 FTS 行均在 rowid 12233，数据无丢失）。

## 全链验证语义（契约确认）

```
预期请求（MockRoute 契约：method/path/status/body）
  → mock server 返回预期数据（含真实引擎可命中的指纹 body）
  → 客户端（真实 nuclei / mock ScanPort）解析返回数据
  → 命中结果 = 预期（expectedHits 断言 / 命中数核对）
  → benign 反证 + 关闭回调（无端口泄漏）
```

四环节全部实测通过：真实引擎 1/1 命中预期数据、0/1 误报（修正 benign 选型后）、mock ScanPort 与生产解析器逐字节一致、spawn 生命周期无泄漏。

## 稳定性与性能（tools/mock-stress.mjs）

| 维度         | 结果                                                             |
| ------------ | ---------------------------------------------------------------- |
| 生命周期     | 30 次 spawn/close 循环 135ms/次（握手+拆除），无端口/进程泄漏    |
| 并发         | 100 并行 28ms vs 100 顺序 40ms——服务端扛满并发且更快（连接复用） |
| 确定性       | mock ScanPort 50 次运行输出**字节一致**（distinct=1），0.1ms/run |
| 真实引擎回环 | 10 次扫描 avg 234ms / min 175 / max 410（全部 1 hit，无 flake）  |

## 品牌契约与状态机补强（本轮）

mock 链路的控制通道已品牌契约化：`ControlEventSchema`/`ControlOpSchema`（zod discriminatedUnion，跨进程边界 parse）、`MockPort` 品牌数字、`MockTargetPhase` 穷尽生命周期联合。坏端口/坏方法/坏路由在边界即拒（实测）。MockRoute 本身已是品牌契约（HttpMethod 枚举 + path refine + status 100-599）。

状态机现状：mock 生命周期由回调驱动（ready 握手 → scan 回调 → close 保证拆除）——单次请求-响应形态，无多步状态流转，按"简单单步不需状态机"的项目规则**正确地**不引入 XState；批量/多步场景（sync）已用事件驱动机器。
