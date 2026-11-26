import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectFiles, DEFAULT_SYNC_FILTER, type SyncFilter } from "../../src/templates/sync-machine.ts";

function filterWith(corpusDir: string): SyncFilter {
  return { ...DEFAULT_SYNC_FILTER, corpusDir };
}

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-collect-"));
  scratch.push(dir);
  mkdirSync(join(dir, "rust-scripts"), { recursive: true });
  writeFileSync(join(dir, "rust-scripts", "CVE-2026-1234.rs"), "// exploit");
  writeFileSync(join(dir, "rust-scripts", "notes.md"), "not a script");
  writeFileSync(join(dir, "tpl.yaml"), "id: x");
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "nested", "deep.rs"), "// deep");
  return dir;
}

describe("collectFiles with configurable extensions", () => {
  it("default keeps the yaml behavior (backward compatible)", () => {
    const dir = makeTree();
    const files = collectFiles(dir, filterWith(""));
    expect(files).toEqual(["tpl.yaml"]);
  });

  it('extensions=[".rs"] collects rust scripts, not yaml or md', () => {
    const dir = makeTree();
    const files = collectFiles(dir, filterWith("rust-scripts"), [".rs"]);
    expect(files).toEqual(["CVE-2026-1234.rs"]);
  });

  it("corpusDir scoping + extensions combine", () => {
    const dir = makeTree();
    const files = collectFiles(dir, filterWith(""), [".rs"]);
    expect(files.sort()).toEqual(["nested/deep.rs", "rust-scripts/CVE-2026-1234.rs"]);
  });
});
