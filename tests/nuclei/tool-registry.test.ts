import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openTemplatesRepo, type TemplatesRepo } from "../../src/nuclei/config.ts";
import { errResult, resolveInsideRepo, textResult } from "../../src/nuclei/tool-registry.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): { root: string; repo: TemplatesRepo } {
  const dir = mkdtempSync(join(tmpdir(), "vf-reg-"));
  scratch.push(dir);
  writeFileSync(join(dir, ".vulnforge.json"), "{}");
  return { root: dir, repo: openTemplatesRepo(dir) };
}

describe("tool-registry shared helpers", () => {
  it("textResult wraps text with optional isError", () => {
    const ok = textResult("hello");
    expect(ok.content[0]?.text).toBe("hello");
    expect((ok as { isError?: boolean }).isError).toBeUndefined();
    const bad = textResult("nope", true);
    expect((bad as { isError?: boolean }).isError).toBe(true);
  });

  it("errResult renders the three-line vf-error envelope", () => {
    const result = errResult("PATH_ESCAPE", "detail here", "do this instead");
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBe("vf-error code=PATH_ESCAPE\ndetail here\nhint: do this instead");
    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it("resolveInsideRepo resolves relative paths inside the repo root", () => {
    const { root, repo } = makeRepo();
    const abs = resolveInsideRepo(repo, "rust-scripts/x.rs");
    expect(abs.replaceAll("\\", "/").startsWith(root.replaceAll("\\", "/"))).toBe(true);
  });

  it("resolveInsideRepo throws PATH_ESCAPE with repo root for escapes", () => {
    const { repo } = makeRepo();
    expect(() => resolveInsideRepo(repo, "../../etc/passwd")).toThrow(/vf-error code=PATH_ESCAPE/);
  });
});
