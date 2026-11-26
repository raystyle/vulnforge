#!/usr/bin/env node
/**
 * SessionEnd hook: mirror the conversation transcript into this project's
 * .claude/sessions/<id>.jsonl (+ INDEX.md row). The global ~/.claude store
 * ages out; the project copy survives. Bodies are gitignored; the index is
 * the tracked pointer.
 */
import { dirname, resolve } from "node:path";
import { archiveSession } from "../../tools/archive-session.ts";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw);
    const sessionId = input.session_id;
    const transcriptPath = input.transcript_path;
    const cwd = input.cwd;
    if (typeof sessionId !== "string" || typeof transcriptPath !== "string" || typeof cwd !== "string") {
      process.exit(0);
    }
    // Archive only for sessions whose project is this repo (the hook's home).
    const hookDir = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
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
