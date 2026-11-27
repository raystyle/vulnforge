# rs-tools — mutate 数据面设计（用户裁定：WAF/杀毒/荷载变形/静态字符/函数规避，2026-11-27）

**原语做成数据不是代码**（对抗性演进——手册/cheatsheet 技巧会失效）。mutate 引擎 = JSON 原语表 + 组合代数 + 变异-测试闭环。

## 原语表（JSON 形态，四类）

### A. 静态字符规避（查杀特征绕过）

| 原语                   | 机制                   | 示例（手册出处）                     |
| ---------------------- | ---------------------- | ------------------------------------ |
| `char-chr-splice`      | chr(n) 拼接还原函数名  | `chr(98-1).chr(116-1)…` → assert     |
| `array-modulo-name`    | 数组取模还原           | `$s[$a%10]` → sysTem（§2.1）         |
| `self-filename-key`    | 读自身文件名提取密钥   | 976534.php → 976534 → sysTem（§2.2） |
| `special-chars-insert` | 换行/null/空白干扰正则 | ` `.$hello ``（§2.3）                |
| `strtr-chain`          | 字符替换链             | strtr 两级 → system（§3）            |
| `base64-rotate`        | base64 解码            | `base64_decode("YXNzZXJ0")`（§1.1）  |
| `rot13/gzinflate`      | 编码轮换               | 深度编码组合                         |

### B. 函数规避（调用位变形）

| 原语                | 机制                                      |
| ------------------- | ----------------------------------------- |
| `callback-wrap`     | call_user_func_array/array_map 包裹（§4） |
| `variable-variable` | $$f 间接寻址（§5）                        |
| `array-wrap`        | 数组包裹调用（§6）                        |
| `class-magic`       | 构造/析构函数藏执行（§7）                 |
| `nested-operator`   | 多重运算嵌套改 AST（§8）                  |
| `heredoc-carry`     | heredoc/反引号承载                        |

### C. 荷载变形（结构变形）

| 原语                    | 机制                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `two-stage-write`       | 本体=写入器，产物=webshell（§3）——与 DeliverForm::WriteFile 组合 |
| `single-constant-embed` | gzip+base64 单字符串嵌入（MemShellParty 49149 字节约束）         |
| `name-randomize`        | 类/方法/变量名随机化（class-obf 思想）                           |
| `constant-split`        | 字符串常量拆分重组                                               |
| `dead-code-inject`      | 死代码膨胀改变熵/结构                                            |

### D. 通信变形（WAF 流量侧）

| 原语                    | 机制                                            |
| ----------------------- | ----------------------------------------------- |
| `header-gate-randomize` | 门 header 名值随机化（godzilla）                |
| `param-name-randomize`  | pass 参数名随机化                               |
| `cipher-rotate`         | XOR/AES 切换 + 密钥派生深度                     |
| `body-carrier-switch`   | 参数体/整 body/多段切换（godzilla vs behinder） |

## 组合代数与约束

- 组合 = 原语序列（每类可叠加，A+B 常见、C 一次、D 独立通道层）
- 约束：eval/assert 不可动态调用（最终执行位必须明文——手册 §0.3 铁律）；某些组合互斥（self-filename-key 需落盘文件）
- 生成：按约束随机/穷举组合 → 变体；每变体带 `variant_id` + `primitives[]` 回溯

## 变异-测试闭环

1. 生成变体（原语组合）
2. 自测：长亭百川/阿里 TI/河马/D盾 平台清单（手册 §0.4）+ 本地 RASP 沙箱（pve 靶场环承接）
3. 结果回写原语表（原语权重：存活变体组合权重+1，被杀组合降权）——**进化由数据驱动**

## 实现位

- `mutate` 原语表 JSON 进插件（`mutate-primitives.json`，数据文件）
- vf_rust_lib `mutate` 模块：原语执行器（A/B 类在 PHP/JSP 模板渲染时应用；C 类在 .class 生成时应用；D 类在通道配置生成时应用）
- 变体元数据进信封 `data.variant`（primitives + variant_id——AgentResult 自带回溯）

## 实现落点（2026-11-27，vf_rust_lib mutate.rs 已落地第一批）

- **原语表**：`vf-rust-lib/src/mutate-primitives.json` 以 `include_str!` 嵌入（23 原语：A8/B6/C5/D4），行字段 id/class/mechanism/weight/implemented/requires/excludes——**表即数据**：weight=0 免重编译禁用原语、implemented 标记执行器就绪面
- **组合代数**（`variant_for(ctx, seed)`）：eligible 过滤（implemented + weight>0 + requires 满足——on_disk_file/class_generation 经 MutationCtx）→ C 类至多 1 个 → excludes 互斥（base64-rotate/rot13/gzinflate 三载波互斥）→ SplitMix64 种子加权抽取（**确定性**：同 seed 复现同变体——变异-测试闭环的可复现前提）
- **variant_id**：FNV-1a(排序后链) 十六进制——顺序无关稳定标识，进信封 `data.variant` 与 primitives[] 一起回溯
- **执行器子集**（第一批 implemented）：A 类 chr-splice（函数名字符 chr(n) 拼接）/ special-chars-insert / base64-rotate / rot13；C 类 name-randomize（$ 变量改名，超全局与 $this 不动）/ constant-split / dead-code-inject；D 类经 `channel_variant` 通道面（gate header/pass 参数名从良性池随机）——**payload 执行器跳过 D 类原语**（通道事实非载荷变换）
- **未实现原语**（B 类全部 + A/C 各 3 个）：表内 implemented=false，误入链返回 soft_success Atom（E_MUT_003，表漂移非 panic）
- 测试 13 项：表形状（23/8/6/5/4 分类计数）、种子确定性、C 单例 + excludes 200 seed 扫描、requires 门控、variant_id 序不变性、载波可逆（rot13 反解回 base64）、超全局保留、D 轴隔离（md5 密钥材料不动）
- **待第二批**：B 类函数位变形执行器、变异-测试闭环平台对接（长亭百川等清单 + pve 靶场 RASP 沙箱——结果回写权重）
