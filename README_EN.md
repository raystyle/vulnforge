# VulnForge

**A vulnerability research and PoC/Exploit forging suite built on the Pi Agent.** [中文](README.md)

VulnForge is a [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) extension package (`pi-package`): it turns nuclei template **authoring, linting, local mock-target validation, and metadata indexing/search** into an integrated custom toolchain, so the agent can develop and manage detection rules fast, automatically, and reliably.

## Features

**nuclei template pipeline** (per tool):

- **Scaffold** — `vf_nuclei_new`: generate a template skeleton from five vulnerability patterns (detect/rce/sqli/lfi/panel) into the templates repo; id derived from the name
- **Lint** — `vf_nuclei_lint`: required fields, metadata discipline (severity enum, author format), weak-matcher blocklist and multi-layer verification advice
- **Local target validation** — `vf_nuclei_run`: run the real nuclei against a programmable mock HTTP target; benign counter-check first (any hit on a generic harmless page = weak matcher, rejected outright)
- **Metadata sync** — `vf_nuclei_sync`: incremental index of template files (single source of truth) into SQLite, with a seal record (version + hash) for repo bookkeeping
- **Search and dedup** — `vf_nuclei_search`: FTS5 full-text search (bm25 weights: id > tags > cve > product > name > description) plus duplicate-key detection

**Environment doctor and install**:

- `vf_env_check` — per-item checks on Windows/Linux/macOS: pi version alignment, fnm/bun/uv, go (GOPROXY mirror), rust (rsproxy mirror), MSVC, zig, nuclei, yamllint, templates repo, mock port
- `vf_env_install` — per-platform command matrix (winget/brew/apt/official distributions), confirmed before running, re-checked after

**Engineering discipline**:

- **Branded contracts**: every domain value typed through zod (`.brand<>()`), enforced statically by brand-lint in the check gate
- **Contract docs**: every exported contract symbol must be documented in docs/contracts/, verified mechanically by contracts-lint
- **Six-part check gate**: biome → tsc → brand-lint → contracts-lint → vitest → pi load check
- **Test layers**: pure / smoke / runtime (real nuclei + mock target end-to-end) / load; an in-process mock ScanPort deterministically tests caller code (zero external dependencies)

## Requirements

**Core**:

- Node.js >= 22.19 ([fnm](https://github.com/Schniz/fnm) recommended)
- [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) (version alignment is checked)

**Template pipeline**:

- nuclei: `go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`
- Go toolchain (official distribution + `GOPROXY=https://goproxy.cn,direct`)
- yamllint: `uv tool install yamllint`

**Dev toolchain** (`vf_env_install` can install per platform, see below):

- fnm / [bun](https://bun.sh) / [uv](https://docs.astral.sh/uv/) — runtime policy: bun + uv + node
- Rust (rustup + rsproxy.cn mirror) / MSVC Build Tools (Windows) / Zig (optional cross-compile)
- China mirrors: npm/bun (npmmirror), pip/uv (tuna), cargo (rsproxy), rustup (rsproxy), fnm node dist (npmmirror)

**One-command doctor**: after installing the extension, ask the agent to call `vf_env_check` — per-platform checks with fix commands; `vf_env_install` installs after confirmation.

## Try without installing

```bash
pi -e /path/to/vulnforge
```

## Install

```bash
pi install /path/to/vulnforge
# or project-local only:
pi install /path/to/vulnforge -l --approve
```

Run `/reload` inside the Pi TUI after installing.

## Development

```bash
npm install
npm run check   # biome → tsc → brand-lint → vitest → pi load check
```

See `CLAUDE.md` for the development system (main loop, review, decision tracking); data-model contracts live in `docs/contracts/`.

## License

MIT
