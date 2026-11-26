# VulnForge

**A vulnerability research and PoC/Exploit forging suite built on the Pi Agent.** [中文](README.md)

VulnForge is a [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) extension package (`pi-package`): it turns nuclei template **authoring, linting, local mock-target validation, and metadata indexing/search** into an integrated custom toolchain, so the agent can develop and manage detection rules fast, automatically, and reliably.

## Features

- **Template pipeline**: scaffold (`vf_nuclei_new`) → lint (structure/metadata/weak-matcher checks, `vf_nuclei_lint`) → local mock-target validation with benign counter-check (`vf_nuclei_run`) → SQLite metadata sync, full-text search, dedup (`vf_nuclei_sync` / `vf_nuclei_search`)
- **Environment doctor and install**: `vf_env_check` covers three platforms (Windows/Linux/macOS) plus China mirror configuration; `vf_env_install` installs missing pieces via a per-platform command matrix (confirmed before running, re-checked after)
- **Branded contracts**: all domain values are typed through zod schemas (`.brand<>()`), enforced by `brand-lint` in the CI gate
- **Testing**: end-to-end runs against the real nuclei binary with a programmable mock target; a mock-nuclei CLI deterministically tests caller code

## Requirements

- Node.js >= 22.19 (fnm recommended)
- [Pi coding agent](https://github.com/earendil-works/pi-coding-agent)
- nuclei (`go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`)
- yamllint (`uv tool install yamllint`)

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
