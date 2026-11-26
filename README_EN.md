# VulnForge

**A vulnerability research and PoC/Exploit forging suite built on the Pi Agent.** [中文](README.md)

VulnForge is a [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) extension package (`pi-package`): it turns nuclei template **authoring, linting, local mock-target validation, and metadata indexing/search** into an integrated custom toolchain, so the agent can develop and manage detection rules fast, automatically, and reliably.

## Features

- **Template pipeline**: scaffold (`vf_nuclei_new`) → lint (structure/metadata/weak-matcher checks, `vf_nuclei_lint`) → local mock-target validation with benign counter-check (`vf_nuclei_run`) → SQLite metadata sync, full-text search, dedup (`vf_nuclei_sync` / `vf_nuclei_search`)
- **Environment doctor and install**: `vf_env_check` covers three platforms (Windows/Linux/macOS) plus China mirror configuration; `vf_env_install` installs missing pieces via a per-platform command matrix (confirmed before running, re-checked after)
- **Branded contracts**: all domain values are typed through zod schemas (`.brand<>()`), enforced by `brand-lint` in the CI gate
- **Testing**: end-to-end runs against the real nuclei binary with a programmable mock target; a mock-nuclei CLI deterministically tests caller code

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
