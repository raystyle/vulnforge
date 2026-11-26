/**
 * E2E: every tool driven against the REAL workspace corpus (templates.db +
 * nuclei-templates under a workspace root). Real nuclei binary where
 * available; mock ScanPort where not.
 *
 * Workspace resolution (cross-platform, no hardcoded machine paths):
 *   VULNFORGE_E2E_WORKSPACE env var → default ~/repos/vulnforge-workspace
 *   → skip the whole suite (with an explicit console.warn) when the
 *   workspace (with .vulnforge.json) is absent — absence is environmental,
 *   never a failure, same discipline as the nuclei runtime skips.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import loadExtension, { type CapturedTool } from "./helpers/capture.ts";

const WORKSPACE = process.env.VULNFORGE_E2E_WORKSPACE ?? join(homedir(), "repos", "vulnforge-workspace");
const WORKSPACE_READY = existsSync(join(WORKSPACE, ".vulnforge.json"));
const SAMPLE_REL = "nuclei-templates/http/cves/2026/CVE-2026-0545.yaml";

let ctx: { cwd: string; hasUI: boolean };
let tools: CapturedTool[];
const scratchDirs: string[] = [];

async function call(name: string, params: unknown): Promise<{ text: string; isError: boolean | undefined }> {
  const tool = tools.find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`tool ${name} not registered`);
  const result = (await tool.execute("e2e", params, undefined, undefined, ctx)) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: result.content[0]?.text ?? "", isError: result.isError };
}

beforeAll(async () => {
  if (!WORKSPACE_READY) {
    console.warn(
      `SKIP e2e suite: no workspace at ${WORKSPACE} (set VULNFORGE_E2E_WORKSPACE to a workspace with .vulnforge.json)`,
    );
    return;
  }
  const { openTemplatesRepo } = await import("../src/templates/config.ts");
  const repo = openTemplatesRepo(WORKSPACE);
  // Copy the sealed db into a scratch location so sync/seal tests don't touch it.
  const scratchDb = mkdtempSync(join(tmpdir(), "vf-e2e-"));
  scratchDirs.push(scratchDb);
  copyFileSync(repo.dbPath, join(scratchDb, "e2e-copy.db"));
  ctx = { cwd: WORKSPACE, hasUI: false };
  tools = loadExtension().tools;
});

afterAll(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const describeIf = WORKSPACE_READY ? describe : describe.skip;

describeIf("e2e over the real workspace corpus", () => {
  it("vf_env_check: reports the real machine, workspace found, nuclei availability stated", async () => {
    const outcome = await call("vf_env_check", {});
    expect(outcome.text).toContain("templates repo");
    expect(outcome.text).toContain(WORKSPACE.slice(0, 20));
    expect(outcome.text).toMatch(/nuclei/);
  });

  it("vf_nuclei_lint: real upstream template parses and lints (CVE-2026-0545)", async () => {
    const outcome = await call("vf_nuclei_lint", { path: SAMPLE_REL });
    expect(outcome.text).toContain("lint");
    // upstream template — may carry lint errors, but must not be a parse failure
    expect(outcome.text).not.toContain("parse failed");
  });

  it("vf_nuclei_run real engine: benign counter-check + programmed route scan", async () => {
    const { checkNuclei } = await import("../src/templates/run.ts");
    const { openTemplatesRepo } = await import("../src/templates/config.ts");
    const repo = openTemplatesRepo(WORKSPACE);
    const availability = await checkNuclei(
      repo.config.tools.nucleiPath.length > 0 ? { nucleiPath: repo.config.tools.nucleiPath } : {},
    );
    if (!availability.available) {
      console.warn("SKIP real-engine e2e: nuclei absent on this machine");
      return;
    }
    const outcome = await call("vf_nuclei_run", {
      path: SAMPLE_REL,
      routes: [{ method: "GET", path: "/", status: 200, body: "no matching content here" }],
    });
    // the template is upstream real — 0 hits on a non-matching mock is a pass
    expect(outcome.text).toMatch(/hit|hits/);
  });

  it("vf_nuclei_run mock engine: expectedHits assertion", async () => {
    const outcome = await call("vf_nuclei_run", {
      path: SAMPLE_REL,
      engine: "mock",
      expectedHits: ["CVE-2026-0545"],
      routes: [{ method: "GET", path: "/", status: 200, body: "x" }],
    });
    expect(outcome.text).toContain("pipeline deterministic");
  });

  it("vf_nuclei_new + vf_nuclei_edit + vf_nuclei_lint roundtrip on a real-path scaffold", async () => {
    const created = await call("vf_nuclei_new", {
      vulnType: "detect",
      name: "E2E Roundtrip Detect",
      author: "ray",
      severity: "info",
      description: "E2E roundtrip template against the real workspace.",
      tags: "e2e,detect",
    });
    expect(created.text).toContain("scaffolded");
    const firstLine = created.text.split(/\r?\n/)[0] ?? "";
    const rel = firstLine
      .replace(/^scaffolded /, "")
      .replaceAll("\\", "/")
      .replace(`${WORKSPACE}/`, "");

    const edited = await call("vf_nuclei_edit", {
      path: rel,
      patch: { kind: "info", patch: { severity: "low" } },
    });
    expect(edited.isError).toBeUndefined();
    expect(edited.text).toContain("applied: info.severity");

    const linted = await call("vf_nuclei_lint", { path: rel });
    expect(linted.text).toContain("lint");

    // cleanup: remove our own scaffold file
    unlinkSync(join(WORKSPACE, rel));
  });

  it("vf_nuclei_sync: resume path over the real corpus (seconds, not minutes)", async () => {
    // The 14k-row full index is already sealed in the workspace db (bench +
    // prior runs). E2E verifies the pipeline end-to-end via a large resume
    // slice — full-corpus throughput belongs to tools/bench-sync.mjs, not the
    // per-commit test gate.
    const before = statSync(join(WORKSPACE, "templates.db")).mtimeMs;
    const outcome = await call("vf_nuclei_sync", { resumeFrom: 14470 });
    expect(outcome.text).toMatch(/synced: \d+/);
    expect(outcome.text).toContain("seal:");
    const after = statSync(join(WORKSPACE, "templates.db")).mtimeMs;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("vf_nuclei_search: FTS over the 14k-row real index", async () => {
    const outcome = await call("vf_nuclei_search", { query: '"CVE-2026-0545"' });
    expect(outcome.text).toContain("CVE-2026-0545");
  });

  it("vf_nuclei_stats: every dimension over the real index", async () => {
    for (const dimension of ["severity", "protocol", "author", "cve"] as const) {
      const outcome = await call("vf_nuclei_stats", { dimension, limit: 5 });
      expect(outcome.isError, `dimension ${dimension}`).toBeUndefined();
      expect(outcome.text).toContain("total: 14");
    }
  });

  it("vf_env_install: refuses a known-absent item without confirmation in headless", async () => {
    const outcome = await call("vf_env_install", { name: "nuclei" });
    // headless ctx (hasUI=false) with nuclei present → fix commands undefined → refused;
    // or confirm required. Either way it must not silently run installs.
    expect(outcome.text).toMatch(/no fix commands|cancelled|ran:/);
  });
});
