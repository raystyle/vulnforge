# 规则数据统计（14475 模板，封版索引）

数据源：`vulnforge-workspace/templates.db`（官方 nuclei-templates 全量入库，seal 6a220996/最新）。所有查询毫秒级（`vf_nuclei_stats` 同链路）。

## 1. 总量

**14,475 个模板** | 9,248 个不同标签 | 158 组重复键 | 无 severity 缺失（解析边界收容）| description 缺失 1,568（10.8%）

## 2. 严重级别

critical 2,152 (14.9%) · high 3,167 (21.9%) · medium 2,957 (20.4%) · low 521 (3.6%) · info 5,678 (39.2%)

高危+严重合计 **36.8%**——每三条规则就有一条可直接致害。

## 3. 协议

http 12,346 (85.3%) · code 948 · file 448 · network 299 · workflows 207 · javascript 128 · ssl 38 · dns 33 · headless 27 · websocket 1

**严重度 × 协议画像**（有意义的分化）：

| 协议      | crit | high | info     | 解读                               |
| --------- | ---- | ---- | -------- | ---------------------------------- |
| http      | 16%  | 21%  | 38%      | 主战场，全谱系                     |
| code      | 6%   | 43%  | 3%       | 高度武器化（high 集中），info 极少 |
| file      | 1%   | 8%   | 84%      | 被动检测为主                       |
| network   | 12%  | 10%  | 68%      | 服务识别为主                       |
| workflows | 0%   | 0%   | **100%** | 编排型，自身无判定（引擎语义使然） |

## 4. 功能分野（标签推导）

- **发现/指纹类**：4,280（29.6%）——tech/discover/osint 标签
- **漏洞利用类**：4,152（28.7%）——rce/sqli/xss/lfi/exploit 标签
- 其余：误配置、暴露、云配置等

两翼均衡，各占三成。

## 5. 目录分布（top）

http/cves **4,700** · http/exposed-panels 1,590 · http/technologies 1,175 · http/osint 1,078 · http/misconfiguration 994 · http/vulnerabilities 967 · http/exposures 714 · dast/vulnerabilities 239 · cloud/gcp 227 · cloud/azure 191

## 6. CVE 覆盖

**4,713 模板（32.6%）携带 CVE**。年份 top：2026 **705**（活跃增量最高）/ 2021 598 / 2022 573 / 2023 570 / 2024 567 / 2025 352。

近三年 × 严重度（全数 high+）：

| 年份 | critical | high | medium |
| ---- | -------- | ---- | ------ |
| 2026 | 337      | 223  | 140    |
| 2025 | 166      | 100  | 85     |
| 2024 | 224      | 178  | 162    |

## 7. 重复与质量

- **158 组重复键**；>2 成员的仅 6 组，最大 **CVE-2021-44228（log4shell）×44**——同 CVE 多路径/变体的合理共存，非质量问题
- quality 面干净：severity 全覆盖、author 全覆盖、description 缺失是唯一显著面（10.8%，lint 已报）
- `affected_product` 上游 0% 填写（契约已允许空；产品信号在 tags 中）

## 8. 对 VulnForge 的运营结论

1. **WordPress 是最大单生态**（tags 合计 1,800+）——scaffold/范例应优先覆盖
2. **2026 增量 705 条/年**——vf_nuclei_new 的典型场景就是"新 CVE 出来 → 30 分钟内出模板"
3. **code 协议是高危集中营**（43% high）——scan 的安全红线（confirm 门）对该类模板更应严格
4. **workflows 是编排层**（100% info、0 matcher）——lint 对其豁免 matcher 检查 + 补 subtemplate 引用完整性检查（引擎研究行动清单）
5. **affected_product 无信号**——我们的模板纪律应强制 tags 带产品名（lint 已建议）
