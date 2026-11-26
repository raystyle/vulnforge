#!/usr/bin/env node
/**
 * SessionEnd hook: mirror the conversation transcript into this project's
 * .claude/sessions/<id>.jsonl (+ INDEX.md row). Bodies are gitignored; the
 * index is the tracked pointer. Opt out with VF_SESSION_ARCHIVE=0 (the
 * transcript can carry pasted secrets — permanent, synced copies may be
 * unwanted).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveSession } from "../../tools/archive-session.ts";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  try {
    if (process.env.VF_SESSION_ARCHIVE === "0") {
      console.error("[vf session-archive] disabled via VF_SESSION_ARCHIVE=0");
      process.exit(0);
    }
    const input = JSON.parse(raw);
    const sessionId = input.session_id;
    const transcriptPath = input.transcript_path;
    const cwd = input.cwd;
    if (typeof sessionId !== "string" || typeof transcriptPath !== "string" || typeof cwd !== "string") {
      process.exit(0);
    }
    // Archive only for sessions whose project is this repo (the hook's home).
    // fileURLToPath (not URL.pathname) — pathname keeps %20-style encodings,
    // so repo paths with spaces or non-ASCII would silently fail the guard.
    const hookDir = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(hookDir, "..", "..");
    const outcome = archiveSession({
      projectRoot: cwd,
      sessionId,
      transcriptPath,
      reason: typeof input.reason === "string" ? input.reason : "other",
      guardRepoRoot: repoRoot,
    });
    if (outcome.archived) {
      console.error(`[vf session-archive] mirrored ${sessionId} (${input.reason}) -> ${outcome.archivePath}`);
    }
  } catch (error) {
    console.error(`[vf session-archive] skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(0);
});
