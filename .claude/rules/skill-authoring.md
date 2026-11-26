---

paths:

- ".claude/skills/**"

---

# Skill 编写规范（agentskills.io 标准）

## 目录结构

```text
skill-name/          # 目录名 = frontmatter name，小写连字符
├── SKILL.md         # 必需：frontmatter + 指令
├── scripts/         # 可选：可执行脚本
├── references/      # 可选：详细文档（按需加载）
├── assets/          # 可选：模板、数据文件
└── evals/           # 可选：测试用例
```

## Frontmatter

```yaml
---
name: skill-name # 1-64 字符，小写+连字符
description: 一句话做什么 + Use when 触发场景 # 1-1024 字符，决定触发
compatibility: Requires uv and bun # 环境要求，有脚本必写
license: MIT # 可选
metadata:
  author: ray
  version: "1.0.0"
---
```

## 脚本规范（自包含，优先级：uv > Bun > npx）

- **Python**：`uv run scripts/x.py`，PEP 723 头声明依赖并 pin 版本（`# /// script ... ///`）
- **JS**：`bun run scripts/x.mjs`，版本化 import（`import x from "pkg@1.0.0"`）
- 禁交互式提示；提供 `--help`
- stdout 输出 JSON（结果），stderr 输出诊断信息；错误非零退出码
- 依赖声明在脚本内部，不依赖外部 package.json

## 编写纪律

- **只写意图、目标、工具、指导过程**——不引用 ADR 编号、来源署名、历史轨迹（如"源自 X""先例 Y"）；skill 面向无上下文的会话，自包含可执行
- SKILL.md < 500 行；细节放 `references/`，正文引用时才加载
- 运行命令写明相对路径：`uv run scripts/extract.py --file input.pdf`
- 渐进式披露：启动只加载 name+description；触发场景写清（description 是触发依据）
- 正文结构：何时使用 → 步骤 → 注意事项
- 文档中文（代码/脚本英文）
