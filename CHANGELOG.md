# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project skeleton: package manifest, TypeScript config, Biome config, Vitest config.
- `src/safety.ts` with `isDangerousCommand()` and the dangerous-command pattern list (product safety red line).
- `src/index.ts` extension entry registering the `/vf-debug` command.
- Test layers: `tests/safety.pure.test.ts` (pure), `tests/index.smoke.test.ts` (factory smoke); `load` layer runs via `scripts/pi-load-check.mjs` in `npm run check`.
