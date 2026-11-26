import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { archiveSession, indexLine, sessionArchiveDir } from "../src/claude/archive-session.ts";

const scratch: string[] = [];
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-sess-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("archiveSession (SessionEnd transcript mirror)", () => {
  it("copies the transcript into .claude/sessions/<id>.jsonl and appends an index row", () => {
    const project = makeProject();
    const transcript = join(project, "source-session.jsonl");
    writeFileSync(transcript, ['{"type":"user","message":"hi"}', '{"type":"assistant","message":"yo"}'].join("\n"));
    const outcome = archiveSession({
      projectRoot: project,
      sessionId: "abc-123",
      transcriptPath: transcript,
      reason: "prompt_input_exit",
    });
    expect(existsSync(join(project, ".claude", "sessions", "abc-123.jsonl"))).toBe(true);
    const stored = readFileSync(join(project, ".claude", "sessions", "abc-123.jsonl"), "utf8");
    expect(stored).toContain('"hi"');
    const index = readFileSync(join(project, ".claude", "sessions", "INDEX.md"), "utf8");
    expect(index).toContain("abc-123");
    expect(outcome.archived).toBe(true);
  });

  it("is a no-op (archived=false) when the transcript file is absent", () => {
    const project = makeProject();
    const outcome = archiveSession({
      projectRoot: project,
      sessionId: "gone",
      transcriptPath: join(project, "does-not-exist.jsonl"),
      reason: "clear",
    });
    expect(outcome.archived).toBe(false);
    expect(existsSync(join(project, ".claude", "sessions"))).toBe(false);
  });

  it("skips (archived=false) when the project root is outside this repo (foreign projects untouched)", () => {
    const foreign = makeProject();
    const transcript = join(foreign, "t.jsonl");
    writeFileSync(transcript, "{}");
    const outcome = archiveSession({
      projectRoot: foreign,
      sessionId: "x",
      transcriptPath: transcript,
      reason: "other",
      guardRepoRoot: "D:/repos/vulnforge",
    });
    expect(outcome.archived).toBe(false);
  });

  it("re-archiving the same session replaces the copy and does not duplicate index rows", () => {
    const project = makeProject();
    const transcript = join(project, "source-session.jsonl");
    writeFileSync(transcript, '{"v":1}');
    const input = { projectRoot: project, sessionId: "dup-1", transcriptPath: transcript, reason: "other" as const };
    archiveSession(input);
    archiveSession(input);
    const index = readFileSync(join(project, ".claude", "sessions", "INDEX.md"), "utf8");
    expect(index.match(/dup-1/g) ?? []).toHaveLength(1);
  });

  it("sessionArchiveDir derives .claude/sessions from a project root", () => {
    expect(sessionArchiveDir("D:/repos/vulnforge").replaceAll("\\", "/")).toBe("D:/repos/vulnforge/.claude/sessions");
  });

  it("indexLine formats one row: date, id, reason", () => {
    const line = indexLine({ sessionId: "s1", reason: "clear", isoDate: "2026-11-26T13:00:00Z" });
    expect(line).toContain("s1");
    expect(line).toContain("clear");
    expect(line).toContain("2026-11-26");
  });
});
