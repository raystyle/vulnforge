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

  it("throws when no marker exists up to the filesystem root", () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-empty-"));
    expect(() => findTemplatesRoot(join(dir, "sub"))).toThrow(/no \.vulnforge\.json/);
  });

  it("throws when leaving a git repo without finding a marker", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".git"), { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), "vf-outside-"));
    mkdirSync(join(outside, ".git"), { recursive: true });
    writeFileSync(join(outside, "project", ""), "");
    // Start inside the outside repo (marker absent) — walk stops at its .git.
    expect(() => findTemplatesRoot(join(outside, "project"))).toThrow(/no \.vulnforge\.json/);
  });
});

describe("loadConfig", () => {
  it("reads the marker from the root", () => {
    const repo = makeRepo();
    const config = loadConfig(repo);
    expect(config.db.filename).toBe("templates.db");
  });
});
