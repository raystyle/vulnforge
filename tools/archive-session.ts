import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Incremental mirror: append only the bytes the archive has not seen yet.
 * The transcript is append-only JSONL, so a byte-offset cursor is sound;
 * a full copy would re-write the whole file on every SessionEnd (22MB at
 * ~1h scale, growing linearly). On size regression (source truncated or
 * replaced), fall back to a full rewrite.
 */
function appendTail(sourcePath: string, archivePath: string): void {
  const sourceSize = statSync(sourcePath).size;
  if (!existsSync(archivePath)) {
    writeFileSync(archivePath, readFileSync(sourcePath));
    return;
  }
  const archivedSize = statSync(archivePath).size;
  if (sourceSize === archivedSize) return;
  if (sourceSize < archivedSize) {
    // source was reset (e.g. /clear) — replace the archive wholesale
    writeFileSync(archivePath, readFileSync(sourcePath));
    return;
  }
  const handle = readFileSync(sourcePath);
  appendFileSync(archivePath, handle.subarray(archivedSize));
}

/**
 * SessionEnd transcript mirror: copy the conversation JSONL into the
 * project's .claude/sessions/ so session records live with the project
 * (the global ~/.claude store ages out after cleanupPeriodDays). The
 * INDEX.md is the git-tracked pointer; the .jsonl bodies are gitignored.
 */
export interface ArchiveInput {
  projectRoot: string;
  sessionId: string;
  transcriptPath: string;
  reason: string;
  /** When set, archive only if projectRoot is inside this repo. */
  guardRepoRoot?: string;
}

export interface ArchiveOutcome {
  archived: boolean;
  archivePath?: string;
  reason?: string;
}

export function sessionArchiveDir(projectRoot: string): string {
  return join(projectRoot, ".claude", "sessions");
}

export function indexLine(input: { sessionId: string; reason: string; isoDate: string }): string {
  return `| ${input.isoDate.slice(0, 10)} | ${input.sessionId} | ${input.reason} |`;
}

export function archiveSession(input: ArchiveInput): ArchiveOutcome {
  const { projectRoot, sessionId, transcriptPath, reason } = input;
  if (input.guardRepoRoot !== undefined) {
    const root = input.guardRepoRoot.replaceAll("\\", "/").replace(/\/$/, "");
    const candidate = projectRoot.replaceAll("\\", "/");
    if (candidate !== root && !candidate.startsWith(`${root}/`)) {
      return { archived: false, reason: "project outside the guarded repo" };
    }
  }
  if (!existsSync(transcriptPath)) {
    return { archived: false, reason: "transcript missing" };
  }
  const dir = sessionArchiveDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const archivePath = join(dir, `${sessionId}.jsonl`);
  appendTail(transcriptPath, archivePath);

  const indexPath = join(dir, "INDEX.md");
  const line = indexLine({ sessionId, reason, isoDate: new Date().toISOString() });
  let indexText: string;
  if (existsSync(indexPath)) {
    const existing = readFileSync(indexPath, "utf8");
    // replace an existing row for this session (re-archive), else append
    const rows = existing
      .split("\n")
      .filter((row) => row.length > 0 && !(row.includes(`| ${sessionId} |`) || row.includes(`| ${sessionId}|`)));
    indexText = [...rows, line].join("\n") + "\n";
  } else {
    indexText = ["# Sessions — 会话归档索引（jsonl 实体不进 git，--resume <path> 可恢复）", "", line].join("\n") + "\n";
  }
  writeFileSync(indexPath, indexText);
  return { archived: true, archivePath };
}
