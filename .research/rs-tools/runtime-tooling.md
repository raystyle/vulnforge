# rs-tools — exploit 工具与运行时集成先例（gh-mcp 检索 + 本地 clone 实读，2026-11-27）

用户裁定（两条）：
1. **Rust 没有原生库（gadget/payload 面）就集成 Java/.NET 运行时工具**——纯解析层（Rust）与生成执行层（Java/.NET 工具）组合成完整 exploit 能力。
2. **MemShellParty 不直接使用，是吸收提炼**——学它的四轴分类学、probe→植入→验证流程、无侵入验证三态、Packer 通道思想，用 Rust 在 vf_rust_lib 内原生实现（ristretto_classfile 做 .class 读写），不依赖 Java 服务/docker/MCP 运行时。

## 检索验证的先例清单

| 工具 | 语言 | 能力 | 集成方式 |
| ---- | ---- | ---- | -------- |
| **emo-crab/ysoserial-rs**（69★，本地 clone） | Rust | 28+ Java gadget 链命令 payload（cc1-7/cck1-4/spring1-2/hibernate/jdk7u21/jdk8u20/groovy/clojure/rome/myfaces/jboss/vaadin/rhino）+ url_dns；tomcat 回显头支持；CLI（-p payload -c command）+ crate 嵌入 | **crate 直接嵌入 vf_rust_lib 或 CLI spawn**——Rust 原生，主通道 |
| Java ysoserial / GadgetBuilder | Java | 链最全（Rust 版覆盖外的更新链） | **运行时集成**：vf_init 检测 java 后 CLI 调用（依赖 jar） |
| **ysoserial.net / ysonet**（pwntuster/irsdl） | .NET | BinaryFormatter/ViewState/NetDataContract 等 .NET 链 + 插件模式 | vf_init 检测 dotnet 后 CLI 调用 |
| MemShellParty boot（MCP Server！） | Java | `generate_memshell` / `generate_probe_shell` MCP 端点——**内存马生成已有 MCP 面** | **MCP 直接集成**（vi 原生 MCP 客户端生态）或 REST |
| nrbf / nrbf-parser crates | Rust | MS-NRBF 双向编解码 + serde JSON（真实使用者：pungin/Beanfun、daijro/paint.rs、landaire/wows-toolkit 均为安全/取证工具） | crate 嵌入（.NET payload 解析） |
| ristretto_classfile / cafebabe | Rust | .class 读/写/分析 | crate 嵌入 |

## 集成架构定稿（用户裁定推导）

```
vf_rust_lib（Rust 原生层）
├── 解析/检测：java-serialization、nrbf、ristretto_classfile、魔数扫描
├── 生成（Rust 侧）：ysoserial-rs crate 嵌入（28+ Java 链）——主通道
├── 内存马（Rust 原生——MemShellParty 思想吸收提炼，非集成）：
│   四轴分类学 + probe/植入/验证三态 + Packer 通道 → ristretto_classfile 读写 .class 原生实现
└── 编排：
    ├── 运行时集成面（vf_init 检测就绪后，仅补 Rust 覆盖外的面）：
    │   ├── java 运行时 → 调 ysoserial.jar / GadgetBuilder（新链）
    │   └── dotnet 运行时 → 调 ysoserial.net/ysonet（.NET 链）
    └── 结果统一回 AgentResult/vf-error 信封
```

- **依赖方向**：vf_init 检测项（java/dotnet）是这些运行时工具的可用性前提——环境检测与 exploit 能力已闭环
- **降级策略**：Rust 原生（ysoserial-rs 28 链）为主，运行时工具（Java/.NET）为扩展——无运行时也能打主流链

## 坑

- ysoserial-rs 2023-02 后未更新（覆盖截至 jdk8u20）——新链靠运行时集成补
- 运行时工具输出格式各异（ysonet 插件交互式）——编排层要按工具归一
- **MemShellParty 集成路线废弃**（用户裁定）：不依赖 Java 服务/docker/MCP——内存马能力走 Rust 原生（ristretto_classfile 读写 .class），运行时 Java 仅在无 Rust 等价物时保留
- Rust 原生内存马限制：Tomcat/Filter 系的 .class 读写可行（ristretto 已覆盖常量池/方法/属性全量）；Agent 系（字节码增强运行时）超出 .class 读写范围——Agent 形态需运行时工具兜底或明确不做
