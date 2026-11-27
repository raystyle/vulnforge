import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findTemplatesRoot,
  loadConfig,
  parseConfig,
  piDataDir,
  resolveLayeredConfig,
} from "../../src/templates/config.ts";

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

describe("parseConfig rs section", () => {
  it("defaults rs.scriptsDir to rust-scripts with empty exportTargets", () => {
    const config = parseConfig("{}");
    expect(config.rs.scriptsDir).toBe("rust-scripts");
    expect(config.rs.exportTargets).toEqual([]);
  });

  it("accepts explicit rs section values", () => {
    const config = parseConfig(
      JSON.stringify({
        rs: { scriptsDir: "exploits", exportTargets: ["x86_64-unknown-linux-musl", "x86_64-pc-windows-msvc"] },
      }),
    );
    expect(config.rs.scriptsDir).toBe("exploits");
    expect(config.rs.exportTargets).toHaveLength(2);
  });

  it("rejects a non-string scriptsDir", () => {
    expect(() => parseConfig(JSON.stringify({ rs: { scriptsDir: 5 } }))).toThrow(/invalid .vulnforge.json/);
  });
});

describe("parseConfig oob section", () => {
  it("defaults to interactsh with empty passthrough facts", () => {
    const config = parseConfig("{}");
    expect(config.oob.provider).toBe("interactsh");
    expect(config.oob.server).toBe("");
    expect(config.oob.pollHost).toBe("");
    expect(config.oob.domain).toBe("");
    expect(config.oob.pollUrl).toBe("");
  });

  it("accepts an explicit oob section", () => {
    const config = parseConfig(
      JSON.stringify({
        oob: {
          provider: "dnslog",
          server: "oast.fun",
          pollHost: "polling.oastify.com",
          domain: "dns.lab",
          pollUrl: "http://dns.lab/api?domain={host}",
        },
      }),
    );
    expect(config.oob.provider).toBe("dnslog");
    expect(config.oob.server).toBe("oast.fun");
    expect(config.oob.pollHost).toBe("polling.oastify.com");
    expect(config.oob.domain).toBe("dns.lab");
    expect(config.oob.pollUrl).toBe("http://dns.lab/api?domain={host}");
  });

  it("rejects an unknown provider", () => {
    expect(() => parseConfig(JSON.stringify({ oob: { provider: "burpcollab" } }))).toThrow(/oob\.provider must be/);
  });

  it("rejects non-string fact fields", () => {
    expect(() => parseConfig(JSON.stringify({ oob: { server: 5 } }))).toThrow(/oob\.server must be a string/);
    expect(() => parseConfig(JSON.stringify({ oob: { pollUrl: true } }))).toThrow(/oob\.pollUrl must be a string/);
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

  it("refuses markers more than one level above a git root (planted home/drive config)", () => {
    const base = mkdtempSync(join(tmpdir(), "vf-plant-"));
    // victim repo nested one level inside base; marker planted at base = TWO levels above the repo
    mkdirSync(join(base, "workdir", "repo", ".git"), { recursive: true });
    writeFileSync(join(base, ".vulnforge.json"), "{}");
    expect(() => findTemplatesRoot(join(base, "workdir", "repo", "sub"))).toThrow(/not trusted/);
  });

  it("trusts the direct parent of a git root (the workspace position)", () => {
    const outer = mkdtempSync(join(tmpdir(), "vf-parent-"));
    mkdirSync(join(outer, "repo", ".git"), { recursive: true });
    writeFileSync(join(outer, ".vulnforge.json"), "{}");
    expect(findTemplatesRoot(join(outer, "repo", "sub"))).toBe(outer);
  });

  it("nested clone inside a git workspace still finds the workspace marker", () => {
    const outer = mkdtempSync(join(tmpdir(), "vf-ws2-"));
    // workspace is a git repo with the marker; corpus is a nested clone
    mkdirSync(join(outer, ".git"), { recursive: true });
    writeFileSync(join(outer, ".vulnforge.json"), "{}");
    mkdirSync(join(outer, "nuclei-templates", ".git"), { recursive: true });
    expect(findTemplatesRoot(join(outer, "nuclei-templates", "http"))).toBe(outer);
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

describe("layered config resolution", () => {
  const REAL_PI_DIR = process.env.PI_CODING_AGENT_DIR;

  afterEach(() => {
    if (REAL_PI_DIR === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = REAL_PI_DIR;
    }
  });

  it("prefers the workspace marker when present", () => {
    const repo = makeRepo();
    const resolved = resolveLayeredConfig(join(repo, "http", "cves"));
    expect(resolved.layer).toBe("workspace");
    expect(resolved.root).toBe(repo);
  });

  it("falls back to the pi data dir global config when no workspace marker exists", () => {
    const noMarker = mkdtempSync(join(tmpdir(), "vf-nolayer-"));
    const piDir = mkdtempSync(join(tmpdir(), "vf-pidir-"));
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "vulnforge.json"), JSON.stringify({ rs: { scriptsDir: "global-scripts" } }));
    process.env.PI_CODING_AGENT_DIR = piDir;
    const resolved = resolveLayeredConfig(join(noMarker, "sub"));
    expect(resolved.layer).toBe("global");
    expect(resolved.root).toBe(piDir);
    expect(resolved.config.rs.scriptsDir).toBe("global-scripts");
  });

  it("throws the workspace diagnostic when both layers are absent", () => {
    const noMarker = mkdtempSync(join(tmpdir(), "vf-nolayer2-"));
    const piDir = mkdtempSync(join(tmpdir(), "vf-pidir2-"));
    process.env.PI_CODING_AGENT_DIR = piDir;
    expect(() => resolveLayeredConfig(join(noMarker, "sub"))).toThrow(/no \.vulnforge\.json/);
  });

  it("global config parses through the same boundary (bad sections rejected)", () => {
    const piDir = mkdtempSync(join(tmpdir(), "vf-pidir3-"));
    writeFileSync(join(piDir, "vulnforge.json"), JSON.stringify({ oob: { provider: "bogus" } }));
    process.env.PI_CODING_AGENT_DIR = piDir;
    const noMarker = mkdtempSync(join(tmpdir(), "vf-nolayer3-"));
    expect(() => resolveLayeredConfig(join(noMarker, "sub"))).toThrow(/oob\.provider must be/);
  });

  it("piDataDir honors PI_CODING_AGENT_DIR over the homedir default", () => {
    process.env.PI_CODING_AGENT_DIR = "D:/custom/pi";
    expect(piDataDir()).toBe("D:/custom/pi");
    delete process.env.PI_CODING_AGENT_DIR;
    expect(piDataDir()).toBe(join(homedir(), ".pi", "agent"));
  });
});
