import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findTemplatesRoot, loadConfig, parseConfig } from "../../src/templates/config.ts";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-tpl-"));
  mkdirSync(join(dir, "http", "cves"), { recursive: true });
  writeFileSync(
    join(dir, ".vulnforge.json"),
    JSON.stringify({ db: { filename: "templates.db", sealFile: "templates-lock.json" } }),
  );
  return dir;
}

describe("parseConfig", () => {
  it("returns defaults for an empty object", () => {
    const config = parseConfig("{}");
    expect(config.db.filename).toBe("templates.db");
    expect(config.db.sealFile).toBe("templates-lock.json");
  });

  it("accepts explicit db filenames", () => {
    const config = parseConfig(JSON.stringify({ db: { filename: "x.db", sealFile: "y.json" } }));
    expect(config.db.filename).toBe("x.db");
    expect(config.db.sealFile).toBe("y.json");
  });

  it("rejects invalid JSON with a clear error", () => {
    expect(() => parseConfig("{")).toThrow(/invalid \.vulnforge\.json/);
  });

  it("rejects non-object JSON", () => {
    expect(() => parseConfig("[]")).toThrow(/expected an object/);
  });
});

describe("findTemplatesRoot", () => {
  it("finds the marker from a nested directory", () => {
    const repo = makeRepo();
    expect(findTemplatesRoot(join(repo, "http", "cves"))).toBe(repo);
  });

  it("finds the workspace marker from inside a nested git clone (corpus with own .git)", () => {
    const repo = makeRepo();
    // upstream corpus layout: workspace/.vulnforge.json + workspace/nuclei-templates/.git
    mkdirSync(join(repo, "nuclei-templates", ".git"), { recursive: true });
    expect(findTemplatesRoot(join(repo, "nuclei-templates", "http", "cves"))).toBe(repo);
  });

  it("throws a diagnostic error when no marker exists up to the filesystem root", () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-empty-"));
    expect(() => findTemplatesRoot(join(dir, "sub"))).toThrow(/no \.vulnforge\.json/);
    // the error must expose the search start and an inline minimal config (no
    // repo-docs pointer — installed extensions have no docs/ directory)
    try {
      findTemplatesRoot(join(dir, "sub"));
    } catch (error) {
      expect((error as Error).message).toContain(dir);
      expect((error as Error).message).toContain("Create .vulnforge.json");
      expect((error as Error).message).toContain("templates.db");
    }
  });

  it("prefers the nearest marker when several exist up the chain", () => {
    const outer = makeRepo();
    const inner = mkdtempSync(join(outer, "inner-"));
    writeFileSync(join(inner, ".vulnforge.json"), "{}");
    expect(findTemplatesRoot(join(inner, "sub"))).toBe(inner);
  });
});

describe("loadConfig", () => {
  it("reads the marker from the root", () => {
    const repo = makeRepo();
    const config = loadConfig(repo);
    expect(config.db.filename).toBe("templates.db");
  });
});
