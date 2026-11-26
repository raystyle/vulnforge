# 配置契约（.vulnforge.json）

契约定义：`src/templates/config.ts`。模板仓标记文件，findTemplatesRoot 向上查找（就近优先，可穿透嵌套 git clone；到文件系统根未找到则抛含修复指引的诊断错误）。

## 结构

```json
{
  "db": {
    "filename": "templates.db",
    "sealFile": "templates-lock.json"
  },
  "tools": {
    "nucleiPath": "",
    "yamllintPath": "",
  },
  "env": {
    "managedRoots": ["D:/ohmyenv"]
  }
}
```

## 字段

| 段                   | 字段     | 默认                    | 说明                                                                 |
| -------------------- | -------- | ----------------------- | -------------------------------------------------------------------- |
| `db.filename`        | string   | `"templates.db"`        | SQLite 索引文件名（相对模板仓根；不进 git）                          |
| `db.sealFile`        | string   | `"templates-lock.json"` | 封版记录（版本+哈希；进 git）                                        |
| `tools.nucleiPath`   | string   | `""`（空=PATH 搜索）    | nuclei 二进制显式路径                                                |
| `tools.yamllintPath` | string   | `""`                    | 同上                                                                 |
| `env.managedRoots`   | string[] | `[]`                    | 托管工具根（如 ohmyenv）——其下工具在环境检测中单独分组，不算系统缺失 |

## rs 段契约（exploit rs）

| 字段               | 类型     | 默认                               | 说明                                                              |
| ------------------ | -------- | ---------------------------------- | ----------------------------------------------------------------- |
| `rs.scriptsDir`    | string   | `"rust-scripts"`                   | workspace 下 exploit rs 脚本目录（一漏洞一脚本，脚本名=漏洞标识） |
| `rs.exportTargets` | string[] | `[]`（由已装 rustup targets 推导） | cargo zigbuild 导出目标（rust triple 形）                         |

`rs.scriptsDir` 必须非空字符串；exportTargets 逐项按 triple 正则在 parse 边界校验。`TemplatesRepo.rsRoot` 派生为 root 下 rs.scriptsDir 绝对路径。

## sync 过滤契约（8 键）

| 字段              | 类型     | 默认                                                                       | 说明                                                 |
| ----------------- | -------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `corpusDir`       | string   | `""`                                                                       | 语料子目录（空 = 仓根）                              |
| `includeDirs`     | string[] | `[]`（全部）                                                               | 只收这些顶层目录（相对 corpusDir）                   |
| `excludeDirs`     | string[] | `DEFAULT_SYNC_EXCLUDED_DIRS`：`.git/.github/node_modules/profiles/helpers` | 任意深度排除                                         |
| `includeFiles`    | string[] | `[]`（默认 _.yaml/_.yml）                                                  | 只收这些文件名                                       |
| `excludeFiles`    | string[] | `[]`                                                                       | 按文件名排除                                         |
| `includePatterns` | string[] | `[]`                                                                       | 正则（对相对路径、忽略大小写）；非空时须至少命中一个 |
| `excludePatterns` | string[] | `[]`                                                                       | 正则命中即排除                                       |

正则语法在 parseConfig 边界校验——坏正则直接抛 `invalid .vulnforge.json`。`DEFAULT_SYNC_EXCLUDED_DIRS` 导出为上游语料布局的默认排除集。

## 契约类型

| 符号                                          | 形态      | 说明                                                                                                                                           |
| --------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `VulnforgeTemplatesConfig`                    | interface | 上表结构的 TS 契约：`{ db: {filename, sealFile}, tools: {nucleiPath, yamllintPath}, env?: { managedRoots } }`                                  |
| `parseConfig(text): VulnforgeTemplatesConfig` | 函数      | JSON 文本 → 契约（见解析纪律）；失败抛错                                                                                                       |
| `findTemplatesRoot(start): string`            | 函数      | 从 start 向上找最近的 `.vulnforge.json`；不受嵌套 `.git` 阻断（语料 clone 自带 .git 也能找到工作区配置）；未找到抛诊断错误（含起点与修复指引） |
| `loadConfig(root): VulnforgeTemplatesConfig`  | 函数      | 读根下标记文件并 parseConfig                                                                                                                   |
| `openTemplatesRepo(start): TemplatesRepo`     | 函数      | 定位 + 装配：root/config/dbPath/sealPath 一次取齐                                                                                              |
| `TemplatesRepo`                               | interface | `{ root: string; config: VulnforgeTemplatesConfig; dbPath: string; sealPath: string }`——dbPath/sealPath 为模板仓根下绝对路径                   |

## 解析纪律

- `parseConfig`：JSON 解析 + 逐字段类型校验，失败抛 `invalid .vulnforge.json: <原因>`；未知字段忽略
- 空 tools 字符串 = 自动发现（PATH / `go env GOPATH`）
- 环境变量覆盖：`VULNFORGE_MANAGED_ROOTS`（分号分隔）优先于配置文件的 managedRoots
