#!/usr/bin/env node
/**
 * Stop hook: when a turn ends with uncommitted src/tests/scripts changes and
 * the last change predates the last check-gate run, remind (observe mode —
 * never block) that npm run check must pass with fresh evidence before ship.
 *
 * Input (stdin JSON): { stop_hook_active, transcript_path, ... }
 * Output: exit 0 with optional JSON { decision: "block", reason } — we only
 * observe for now, printing the reminder as plain text for the transcript.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const GATE_MARKERS = [join(ROOT, "node_modules", ".cache"), join(ROOT, ".git", "HEAD")];
const CODE_DIRS = ["src", "tests", "scripts"].map((dir) => join(ROOT, dir));

function newestMtime(dir, best = 0) {
  if (!existsSync(dir)) return best;
  const entries = execFileSync("cmd.exe", ["/d", "/s", "/c", `dir /s /b "${dir.replaceAll("/", "\\")}"`], {
    encoding: "utf8",
    windowsHide: true,
  })
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  for (const entry of entries) {
    try {
      const mtime = statSync(entry).mtimeMs;
      if (mtime > best) best = mtime;
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
      `[vf stop-hook observe] src/tests/scripts changed after the last gate run. Run \`npm run check\` and record evidence before shipping. (observe mode — not blocking)`,
    );
    process.exit(0);
  });
}

main();
