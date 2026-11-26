# VulnForge

**A vulnerability research and PoC/Exploit forging suite built on the Pi Agent.** [中文](README.md)

VulnForge is a [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) extension package (`pi-package`): it turns nuclei template **authoring, linting, local mock-target validation, and metadata indexing/search** into an integrated custom toolchain, so the agent can develop and manage detection rules fast, automatically, and reliably.

## Features

**nuclei template pipeline** (per tool; full reference in docs/tools.md):

- **Scaffold** — `vf_nuclei_new`: generate a template skeleton from five vulnerability patterns (detect/rce/sqli/lfi/panel); id derived from the name
- **Lint** — `vf_nuclei_lint`: built-in TS yaml lint (syntax/style) + zod contract parsing + structure/metadata/weak-matcher checks
- **Contract edit** — `vf_nuclei_edit`: structured patches (info/matcher/path) or whole-document replacement, auto-linted after edit; invalid edits are rejected before write
- **Local target validation** — `vf_nuclei_run`: run the real nuclei against a programmable mock HTTP target; benign counter-check first; remote authorized targets supported (confirm-gated)
- **Metadata sync** — `vf_nuclei_sync`: event-driven state machine batch index (config-driven include/exclude dirs/files/patterns), checkpoint resume, seal record
- **Search and dedup** — `vf_nuclei_search`: FTS5 full-text search (bm25 weights) plus duplicate-key detection
- **Analysis** — `vf_nuclei_stats`: severity/protocol/tags/cve/author seven-dimension group-by + CVE year histogram + duplicate-key report

**Environment doctor and install**:

- `vf_env_check` — per-item checks on Windows/Linux/macOS: pi version alignment, fnm/bun/uv, go (GOPROXY mirror), rust (rsproxy mirror), MSVC, zig, nuclei, yamllint, templates repo, mock port
- `vf_env_install` — per-platform command matrix (winget/brew/apt/official distributions), confirmed before running, re-checked after

**Config auto-discovery (zero hardcoding)**:

- Every template tool automatically walks up to the nearest `.vulnforge.json` — call them from deep inside the corpus (e.g. `nuclei-templates/http/cves/...`) and the workspace config is found; nested git clones do not block the walk (an upstream corpus with its own `.git` still resolves to the enclosing workspace)
- The config defines db filenames, nuclei/yamllint paths (empty = auto-discover), and the 8-key sync filter (corpus dir, include/exclude dirs/files/regex patterns)
- **Missing config fails loudly**: a diagnostic error with the search start, levels walked, and an inline minimal config example — installed extensions need no repo docs

```json
{
  "db": { "filename": "templates.db", "sealFile": "templates-lock.json" },
  "tools": { "nucleiPath": "" },
  "sync": { "corpusDir": "nuclei-templates" }
}
```

**Engineering discipline**:

- **Branded contracts**: every domain value typed through zod (`.brand<>()`), enforced statically by brand-lint in the check gate
- **Event-driven state machines**: every tool execution path (including single-step request-response) is expressed as an XState machine — transitions fire on events only, with compile-time exhaustiveness guards (an unhandled new event fails tsc); machines must be wired into the tool surface, dead machines are lint violations
- **Contract docs**: every exported contract symbol must be documented in docs/contracts/, verified mechanically by contracts-lint
- **Seven-part check gate**: biome → tsc → brand-lint → contracts-lint → system-lint → vitest → pi load check
- **System-consistency lint**: system-lint verifies asset interlocks (gate lists ↔ docs, ADR ↔ index, research dirs ↔ five-piece structure, machine reachability, tool surface ↔ docs ↔ tests) — any drift fails the gate, so touching one asset forces global propagation
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
