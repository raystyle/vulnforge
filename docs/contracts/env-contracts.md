# 环境契约（EnvCheckItem / MirrorCheckItem / EnvAcceptance）

契约定义：`src/templates/env.ts`。平台：Windows / Linux / macOS 三平台（主开发机 Windows，lan-ubuntu 与 lan-mac 工作台验证）。

## 1. EnvCheckItem（检查项）

| 字段        | 类型                  | 说明                                                                                                                            |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | `string`              | 项名：pi / winget(win) / node / fnm / bun / uv / go / rust / msvc(win) / zig / nuclei / yamllint / templates repo / mock target |
| `ok`        | `boolean`             | 是否通过                                                                                                                        |
| `detail`    | `string`              | 版本/状态详情                                                                                                                   |
| `fix`       | `string \| undefined` | 未通过时的修复命令（按平台矩阵生成）                                                                                            |
| `managedBy` | `string \| undefined` | 工具位于托管根（ohmyenv）时标注——**与系统工具链分组展示，不算系统缺失**                                                         |

**版本对齐**：`EXPECTED_PI_VERSION = "1.5.0"`，`versionSatisfies(actual, expected)` 语义化比较；pi 低于期望版本即检查失败。

## 2. 中国镜像检测（MirrorCheckItem）

| 项              | 检测方式                                               | 未配置的修复                                                                          |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| npm mirror      | ~/.npmrc 或 `npm config get registry` 含 npmmirror.com | `npm config set registry https://registry.npmmirror.com`                              |
| bun mirror      | ~/.bunfig.toml 含 npmmirror（bun 缺席则跳过）          | 追加 `[install]` 段 `registry = "https://registry.npmmirror.com"` 到 `~/.bunfig.toml` |
| pip mirror      | pip.conf/pip.ini（tuna/aliyun）或 pip config           | `pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple`            |
| uv mirror       | uv.toml 或 UV_INDEX_URL                                | 设 UV_INDEX_URL                                                                       |
| cargo mirror    | ~/.cargo/config(.toml) 含 rsproxy                      | rsproxy-sparse source 替换                                                            |
| rustup mirror   | RUSTUP_DIST_SERVER 含 rsproxy.cn                       | setx/export RUSTUP_DIST_SERVER                                                        |
| fnm node mirror | FNM_NODE_DIST_MIRROR / NODE_DIST_MIRROR 含 npmmirror   | 设 FNM_NODE_DIST_MIRROR=https://npmmirror.com/mirrors/node                            |

## 3. EnvAcceptance（环境验收）

`acceptEnvironment(cwd)` = checkEnvironment + checkMirrors：

- **blocking**（必须修复才能工作）：pi / node / go / nuclei / templates repo / mock target 任一不 ok
- **mirrorGaps**（建议修复，CN 网络慢）：镜像未配置项，不阻断
- `passed = blocking.length === 0`

## 4. 平台命令矩阵（platformCommands）

类型 `PlatformCommands`：`{ wingetOrBrewOrApt: PackageManager; node/fnm/bun/uv/go/rustup/zig: string }`——每个工具在该平台的完整安装命令。

`PackageManager` = `"winget" | "brew" | "apt" | "none"`（`detectPackageManager` 按 PATH 探测）。

`ManagedRoot` = `{ root: string; label: string }`；`loadManagedRoots(cwd): ManagedRoot[]`——来源优先级：环境变量 `VULNFORGE_MANAGED_ROOTS`（分号分隔，label "env"）→ 模板仓 `.vulnforge.json` 的 `env.managedRoots`（label "ohmyenv"）→ 无。

按 `detectPlatform()`（win32/darwin/linux）+ `detectPackageManager()`（winget/brew/apt/none）生成：

| 工具   | Windows                                                                             | macOS (brew)                                                | Linux (apt)                                                |
| ------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| node   | winget Schniz.fnm → fnm install 22                                                  | brew install fnm                                            | curl fnm.vercel.app/install                                |
| go     | golang.google.cn msi（windows-amd64）                                               | golang.google.cn tar.gz（darwin-arm64，解到 /usr/local/go） | golang.google.cn tar.gz（linux-amd64，解到 /usr/local/go） |
| rustup | winget Rustlang.Rustup（先设 rsproxy）                                              | rsproxy.cn rustup-init.sh                                   | 同左                                                       |
| nuclei | go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest（需 goproxy.cn） | 同左                                                        | 同左                                                       |
| zig    | winget zig.zig                                                                      | brew install zig                                            | apt install zig                                            |

**Go 安装纪律**（官方指引）：三平台统一走**官方预编译发行版**（Windows msi / mac-linux tar.gz），源用中国官方镜像 `https://golang.google.cn/dl/`；**不用** winget/brew/apt 的 Go 包（版本旧、非 Go 团队直接支持）；tar.gz 安装须先 `sudo rm -rf /usr/local/go` 再解压，PATH 加 `/usr/local/go/bin` 与 `$(go env GOPATH)/bin`；装后 `go env -w GOPROXY=https://goproxy.cn,direct`。

**安装执行**：`runInstallAction` 经平台 shell（win: `cmd /d /s /c`；posix: `bash -lc`）串联执行 fix 命令，10 分钟超时，返回 InstallOutcome（exitCode + output）；Pi 工具层执行前 `ctx.ui.confirm` 确认（系统修改操作），装后复检。

## 4.9 env-contract.ts — 品牌契约 + 引擎探测状态机

| 符号                                                     | 契约                          | 说明                                               |
| -------------------------------------------------------- | ----------------------------- | -------------------------------------------------- |
| `MirrorKindSchema` / `MirrorKind`                        | zod 枚举                      | 七个镜像维度白名单                                 |
| `EnvToolNameSchema` / `EnvToolName` / `envToolName(raw)` | zod 枚举 + 构造器             | 环境检查项名白名单（vf_init 的安装补齐只接受这些） |
| `EnvCheckItemSchema` / `EnvCheckItem`                    | zod object                    | 检查行契约（含受管标注）                           |
| `EnvAcceptanceSchema` / `EnvAcceptance`                  | zod object + `EnvPassed` 品牌 | 验收结论契约                                       |

**EngineProbeMachine**（XState，事件驱动）：probing →（PROBE_RESULT available/unavailable）→ 终态，REPROBE 从任一终态回到 probing。`probeEngine(availability)` 把 checkNuclei 结果映射为状态机事件并返回 EngineProbeState。`assertEngineProbeEventHandled`：编译期穷尽守卫。

## 5. 与 Pi 工具的对应

- `vf_init`（P7 落地）check 面 → checkEnvironment + environmentText（分组渲染：system toolchain / managed）
- `vf_init`（P7 落地）install 面 → fixCommandsFor(检查结果, name) → confirm → runInstallAction → 复检回告
- 验收入口 `acceptEnvironment` + `acceptanceText`（后续可挂命令或 CI）
