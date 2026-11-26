# nuclei-templates 全量分析报告

分析时间：2026-11-26。数据源：官方 [projectdiscovery/nuclei-templates](https://github.com/projectdiscovery/nuclei-templates) 快照（14520 个 yaml，14475 个通过契约解析入库 `vulnforge-workspace/templates.db`，24 个非模板文件失败）。全部查询走 VulnForge 元数据索引（FTS5 + SQL group-by），毫秒级。

## 1. 总量与协议分布

| 协议       | 数量   | 占比  |
| ---------- | ------ | ----- |
| http       | 12,346 | 85.3% |
| code       | 948    | 6.5%  |
| file       | 448    | 3.1%  |
| network    | 299    | 2.1%  |
| workflows  | 207    | 1.4%  |
| javascript | 128    | 0.9%  |
| ssl        | 38     | 0.3%  |
| dns        | 33     | 0.2%  |
| headless   | 27     | 0.2%  |
| websocket  | 1      | <0.1% |

## 2. 严重级别分布

| severity | 数量  | 占比  |
| -------- | ----- | ----- |
| info     | 5,678 | 39.2% |
| high     | 3,167 | 21.9% |
| medium   | 2,957 | 20.4% |
| critical | 2,152 | 14.9% |
| low      | 521   | 3.6%  |

info 占比近四成（technologies/osint 类发现型模板天然是 info）。经上游收容后 `unknown` severity 已归零（解析时映射为 info）。

## 3. 目录结构（http 下 12,073 个）

| 目录                                                       | 数量  | 说明         |
| ---------------------------------------------------------- | ----- | ------------ |
| http/cves                                                  | 4,700 | CVE 定向模板 |
| http/exposed-panels                                        | 1,590 | 后台面板暴露 |
| http/technologies                                          | 1,175 | 技术栈指纹   |
| http/osint                                                 | 1,078 | 资产情报     |
| http/misconfiguration                                      | 994   | 配置错误     |
| http/vulnerabilities                                       | 967   | 通用漏洞     |
| http/exposures                                             | 714   | 信息泄露     |
| http/default-logins                                        | 335   | 默认口令     |
| http/token-spray                                           | 247   | 令牌喷洒     |
| 其余（takeovers/iot/miscellaneous/cnvd/fuzzing/honeypot…） | 177   |              |

非 http：cloud 663、file 447、code 306、network 293、dast 251、workflows 207、javascript 137、ssl 39、dns 31、headless 26。

## 4. 漏洞类型（http/vulnerabilities 内标签频次）

XSS 185 / LFI 183 / RCE 180 / SQLi 108 为主力四类；WordPress 生态显著（wordpress 200 + wp-plugin 128 + wp 104 + wpscan 80）；log4j/jndi 43+41；edb/packetstorm 来源标签说明大量模板源自公开 PoC。

## 5. CVE 覆盖

- **4,713 个模板（32.6%）携带 CVE 编号**，共 4,713 个 CVE 提及（1:1）
- 年份直方图（近期）：2026 **705** / 2021 598 / 2022 573 / 2023 570 / 2024 567 / 2025 352 / 2020 337——2026 年新增量最高，说明上游活跃维护当前漏洞
- 近四年 CVE × severity 矩阵：

| 年份 | critical | high | medium | low | info |
| ---- | -------- | ---- | ------ | --- | ---- |
| 2023 | 208      | 138  | 223    | 1   | 0    |
| 2024 | 224      | 178  | 162    | 3   | 0    |
| 2025 | 166      | 100  | 85     | 1   | 0    |
| 2026 | 337      | 223  | 140    | 5   | 0    |

CVE 模板里 critical+high 占约 62%，符合"新 CVE 优先高危定级"的社区惯例。

## 6. 严重级别 × 目录（http 子目录质量画像）

| 目录                                                     | 总量  | critical 占比 | critical+high |
| -------------------------------------------------------- | ----- | ------------- | ------------- |
| http/vulnerabilities                                     | 967   | 26%           | 71%           |
| http/cves                                                | 4,700 | 35%           | 63%           |
| http/default-logins                                      | 335   | 3%            | 96%           |
| http/misconfiguration                                    | 994   | 4%            | 40%           |
| http/exposures                                           | 714   | 0%            | 14%           |
| http/exposed-panels / technologies / osint / token-spray | —     | 0%            | 0%            |

发现型目录（technologies/osint/exposed-panels）全部为 info；漏洞型目录以 critical/high 为主——分级体系与目录语义一致。

## 7. 标签体系

- 9,248 个不同标签，216 个模板无标签（1.5%）
- 高频标签：vuln 7,230 / cve 4,914 / discovery 3,892 / vkev 2,228 / wordpress 1,826 / panel 1,645 / wp-plugin 1,627 / exposure 1,555 / xss 1,461 / tech 1,236 / rce 1,146 / osint 1,131 / detect 1,101 / misconfig 1,023 / unauth 980 / lfi 933
- KEV 类标签（kev 626 + vkev 2,228）表明上游持续对齐 CISA 已知被利用漏洞清单

## 8. 作者集中度

rxerium 932 / daffainfo 829 / princechaddha 809 / DhiyaneshDK 797 / dwisiswant0 762 / pussycat0x 745 / ritikchaddha 712——前 7 位作者（含 DhiyaneshDK/Dk 合并后 1,442）贡献约 47%（6,867/14,475），长尾社区贡献过半。注意 `DhiyaneshDK` 与 `DhiyaneshDk` 是同一人的大小写分身（1,442 合并后进前 3）——上游作者字段无大小写规范。

## 9. 数据质量

- **empty description：1,568（10.8%）**——契约已放行（可选），lint 层报 warning
- **unknown severity：0**（解析边界收容后）；空 author：0
- **重复键：158 组**（同 CVE 多模板，最大组 CVE-2021-44228/log4shell 44 个——不同变体/路径的合理共存）
- 疑似脏数据：`http/` 存在一个含 BOM 的隐藏目录（`‎http/`，U+200E 前缀）——上游自身问题

## 10. 对 VulnForge 的启示

1. **查重基线已建立**：158 组同键重复是后续贡献模板时的必须检查项（vf_nuclei_search 先查）
2. **CVE 是主键维度**：32.6% 带 CVE，年增量 700+；vf_nuclei_new 的 cveId 参数与 duplicate_key 设计对准了这一现实
3. **WordPress 是最大单生态**（cves+exposed-panels+vulnerabilities 中 wordpress 标签合计 1,800+）：模板编写辅助应优先覆盖 wp-plugin 场景
4. **info 类占 39%**：它们是"发现"而非"漏洞"，扫描策略上应与漏洞型模板分开调度（severity 过滤已支持）
5. **description 缺失 10.8%**：我们自己的模板仓纪律应要求 description 必填（lint 已是 error 级）

## 复现

```bash
# 索引（一次性）
cd D:/repos/vulnforge-workspace && node -e "..."   # syncFromFiles → templates.db
# 分析（任选维度，毫秒级）
vf_nuclei_stats dimension=severity|protocol|tags|cve|author|affected_product
```
