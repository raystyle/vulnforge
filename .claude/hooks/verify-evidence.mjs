#!/usr/bin/env node
/**
 * Stop hook: when a turn ends with src/tests/tools changes newer than the
 * last gate run, remind (observe mode — never block) that npm run check must
 * pass with fresh evidence before ship.
 *
 * Input (stdin JSON): { stop_hook_active, ... }
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const CODE_DIRS = ["src", "tests", "tools"].map((dir) => join(ROOT, dir));
const GATE_MARKERS = [join(ROOT, ".git", "HEAD")];

function newestMtime(dir, best = 0) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return best;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        best = newestMtime(full, best);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs") || entry.name.endsWith(".json")) {
        const mtime = statSync(full).mtimeMs;
        if (mtime > best) best = mtime;
      }
    } catch {
      // unreadable entry — skip
    }
  }
  return best;
}

function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    raw += chunk;
  });
  process.stdin.on("end", () => {
    let active = false;
    try {
      const input = JSON.parse(raw);
      active = input.stop_hook_active === true;
    } catch {
      // ignore unparsable input
    }
    if (active) {
      // A continuation of an already-stopped turn — do not nag again.
      process.exit(0);
    }
    const newestCode = Math.max(...CODE_DIRS.map((dir) => newestMtime(dir)));
    const lastGate = Math.max(...GATE_MARKERS.map((marker) => (existsSync(marker) ? statSync(marker).mtimeMs : 0)));
    if (newestCode <= lastGate) {
      process.exit(0);
    }
    process.stdout.write(
      `[vf stop-hook observe] src/tests/tools changed after the last gate run. Run \`npm run check\` and record evidence before shipping. (observe mode — not blocking)`,
    );
    process.exit(0);
  });
}

main();
