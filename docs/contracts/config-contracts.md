# 配置契约（.vulnforge.json）

契约定义：`src/templates/config.ts`。模板仓标记文件，findTemplatesRoot 向上查找（止于 .git 或文件系统根）。

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
    "mockNucleiScript": ""
  },
  "env": {
    "managedRoots": ["D:/ohmyenv"]
  }
}
```

## 字段

| 段                       | 字段     | 默认                    | 说明                                                                 |
| ------------------------ | -------- | ----------------------- | -------------------------------------------------------------------- |
| `db.filename`            | string   | `"templates.db"`        | SQLite 索引文件名（相对模板仓根；不进 git）                          |
| `db.sealFile`            | string   | `"templates-lock.json"` | 封版记录（版本+哈希；进 git）                                        |
| `tools.nucleiPath`       | string   | `""`（空=PATH 搜索）    | nuclei 二进制显式路径                                                |
| `tools.yamllintPath`     | string   | `""`                    | 同上                                                                 |
| `tools.mockNucleiScript` | string   | `""`                    | mock-nuclei CLI 脚本路径                                             |
| `env.managedRoots`       | string[] | `[]`                    | 托管工具根（如 ohmyenv）——其下工具在环境检测中单独分组，不算系统缺失 |

## 契约类型

| 符号                                          | 形态      | 说明                                                                                                                            |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `VulnforgeTemplatesConfig`                    | interface | 上表结构的 TS 契约：`{ db: {filename, sealFile}, tools: {nucleiPath, yamllintPath, mockNucleiScript}, env?: { managedRoots } }` |
| `parseConfig(text): VulnforgeTemplatesConfig` | 函数      | JSON 文本 → 契约（见解析纪律）；失败抛错                                                                                        |
| `findTemplatesRoot(start): string`            | 函数      | 从 start 向上找 `.vulnforge.json`；止于 .git 或文件系统根，未找到抛错                                                           |
| `loadConfig(root): VulnforgeTemplatesConfig`  | 函数      | 读根下标记文件并 parseConfig                                                                                                    |
| `openTemplatesRepo(start): TemplatesRepo`     | 函数      | 定位 + 装配：root/config/dbPath/sealPath 一次取齐                                                                               |
| `TemplatesRepo`                               | interface | `{ root: string; config: VulnforgeTemplatesConfig; dbPath: string; sealPath: string }`——dbPath/sealPath 为模板仓根下绝对路径    |

## 解析纪律

- `parseConfig`：JSON 解析 + 逐字段类型校验，失败抛 `invalid .vulnforge.json: <原因>`；未知字段忽略
- 空 tools 字符串 = 自动发现（PATH / `go env GOPATH`）
- 环境变量覆盖：`VULNFORGE_MANAGED_ROOTS`（分号分隔）优先于配置文件的 managedRoots
