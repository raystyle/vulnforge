import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { benignProfile, startMockTarget } from "../../src/templates/mock.ts";
import { checkNuclei, runTemplateAgainst, verifyNoFalsePositive } from "../../src/templates/run.ts";

const HIT_TEMPLATE = `
id: acme-panel-rce
info:
  name: ACME Panel - Remote Code Execution
  author: ray
  severity: critical
  description: ACME Panel before 2.1 allows unauthenticated command execution via the exec endpoint.
  tags: cve,rce,acme
  classification:
    cve-id: CVE-2026-1234
http:
  - method: GET
    path:
      - "{{BaseURL}}/exec"
    matchers:
      - type: word
        words:
          - "ACME_PANEL_EXEC_OK_9f2c1a"
        part: body
`;

const WEAK_TEMPLATE = `
id: generic-error-page
info:
  name: Generic Error Page
  author: ray
  severity: info
  description: Detects generic error pages present on nearly every server.
  tags: generic
http:
  - method: GET
    path:
      - "{{BaseURL}}/"
    matchers:
      - type: word
        words:
          - "Welcome"
        part: body
`;

const tempDirs: string[] = [];
let nucleiAvailable = false;
let NUCLEI = process.env.VULNFORGE_TEST_NUCLEI ?? "";

/** Discover the nuclei binary from `go env GOPATH` — no hardcoded machine paths. */
function discoverNuclei(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("go", ["env", "GOPATH"], { windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(new Error(`go env GOPATH failed: ${error.message}`));
        return;
      }
      const gopath = stdout.trim();
      const suffix = process.platform === "win32" ? "nuclei.exe" : "nuclei";
      resolve(join(gopath, "bin", suffix));
    });
  });
}

beforeAll(async () => {
  if (NUCLEI.length === 0) {
    NUCLEI = await discoverNuclei();
  }
  const availability = await checkNuclei({ nucleiPath: NUCLEI });
  nucleiAvailable = availability.available;
  if (!nucleiAvailable) {
    console.warn(`SKIP runtime nuclei tests: ${availability.reason}`);
  }
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("nuclei runtime (real binary + mock target)", () => {
  it("detects the vulnerability on the programmed target", { timeout: 120_000 }, async ({ skip }) => {
    if (!nucleiAvailable) skip();
    const dir = mkdtempSync(join(tmpdir(), "vf-run-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "tpl"), { recursive: true });
    const tplPath = join(dir, "tpl", "acme.yaml");
    writeFileSync(tplPath, HIT_TEMPLATE);
    const target = await startMockTarget([
      {
        method: "GET",
        path: "/exec",
        status: 200,
        body: "ACME_PANEL_EXEC_OK_9f2c1a output follows",
      },
    ]);
    try {
      const result = await runTemplateAgainst(tplPath, target.url, { nucleiPath: NUCLEI });
      expect(result.hits.map((hit) => hit.templateId)).toEqual(["acme-panel-rce"]);
      expect(result.hits[0]?.matchedAt).toContain("/exec");
    } finally {
      await target.close();
    }
  });

  it("produces zero hits when the vulnerable path is absent", { timeout: 120_000 }, async ({ skip }) => {
    if (!nucleiAvailable) skip();
    const dir = mkdtempSync(join(tmpdir(), "vf-run-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "tpl"), { recursive: true });
    const tplPath = join(dir, "tpl", "acme.yaml");
    writeFileSync(tplPath, HIT_TEMPLATE);
    const target = await startMockTarget([{ method: "GET", path: "*", status: 200, body: "nothing relevant here" }]);
    try {
      const result = await runTemplateAgainst(tplPath, target.url, { nucleiPath: NUCLEI });
      expect(result.hits).toHaveLength(0);
    } finally {
      await target.close();
    }
  });

  it("flags a weak matcher via the benign-profile counter-check", { timeout: 120_000 }, async ({ skip }) => {
    if (!nucleiAvailable) skip();
    const dir = mkdtempSync(join(tmpdir(), "vf-run-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "tpl"), { recursive: true });
    const tplPath = join(dir, "tpl", "weak.yaml");
    writeFileSync(tplPath, WEAK_TEMPLATE);
    const benign = await startMockTarget(benignProfile());
    try {
      const verdict = await verifyNoFalsePositive(tplPath, benign.url, { nucleiPath: NUCLEI });
      expect(verdict.weakMatcher).toBe(true);
      expect(verdict.hits.map((hit) => hit.templateId)).toEqual(["generic-error-page"]);
    } finally {
      await benign.close();
    }
  });
});
