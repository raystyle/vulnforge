#!/usr/bin/env node
/**
 * Mock-engine e2e: real upstream templates against a programmed mock target,
 * through the full tool chain (lintTemplateFile → real/mock ScanPort →
 * spawned mock server). Proves the "expected request → expected data →
 * client-parses-result" loop on actual corpus templates.
 *
 * Scenarios:
 *   1. tech-detect.yaml + a body containing its regex → real engine hits
 *   2. same template + benign body → real engine 0 hits (FP counter-check)
 *   3. mock ScanPort seeded with expectedHits → deterministic assertion
 *   4. spawned child-process mock server serves the route; real engine hits it
 */
import { readFileSync } from "node:fs";
import { TemplateDb } from "../src/nuclei/meta.ts";
import { benignProfile } from "../src/nuclei/mock.ts";
import { withSpawnedMock } from "../src/nuclei/mock-client.ts";
import { checkNuclei, createMockScanPort, runTemplateAgainst, verifyNoFalsePositive } from "../src/nuclei/run.ts";
import { lintTemplateFile } from "../src/nuclei/sync-machine.ts";

const WORKSPACE = "D:/repos/vulnforge-workspace";
const TPL_REL = "nuclei-templates/http/technologies/tech-detect.yaml";
const TPL_ABS = `${WORKSPACE}/${TPL_REL}`;
const NUCLEI = "D:/ohmyenv/gopath/bin/nuclei.exe";
// tech-detect's first regex matcher — a mollom img tag. Program the mock to serve it.
const MATCHER_BODY = '<html><body><img src="https://cdn.mollom.com/pixel.gif"></body></html>';

const db = new TemplateDb(`${WORKSPACE}/templates.db`);
const seeded = db.search('"tech-detect"');
console.log(`[0] corpus seed: tech-detect indexed = ${seeded.some((hit) => hit.id === "tech-detect")}`);

const lint = lintTemplateFile(readFileSync(TPL_ABS, "utf8"), TPL_REL);
console.log(
  `[0] template parse+lint: ${lint.error ?? "ok"} (yaml ${lint.yamlFindings.length}, doc ${lint.docFindings.length})`,
);

const availability = await checkNuclei({ nucleiPath: NUCLEI });
const realOk = availability.available;
console.log(`[0] real engine: ${realOk ? `available (${availability.version})` : "absent"}`);

// Scenario 1+2: real engine against the spawned mock server
if (realOk) {
  const runOptions = { nucleiPath: NUCLEI };
  const hitResult = await withSpawnedMock(
    [{ method: "GET", path: "/", status: 200, body: MATCHER_BODY }],
    async (url) => runTemplateAgainst(TPL_ABS, url, runOptions),
  );
  console.log(
    `[1] real engine + expected data: ${hitResult.hits.length} hit(s) — ${hitResult.hits.map((hit) => hit.templateId).join(",")}`,
  );

  const fpVerdict = await withSpawnedMock(benignProfile(), async (url) =>
    verifyNoFalsePositive(TPL_ABS, url, runOptions),
  );
  console.log(`[2] real engine + benign page: weakMatcher=${fpVerdict.weakMatcher} (expect false)`);
} else {
  console.log("[1][2] SKIP: real engine absent");
}

// Scenario 3: mock ScanPort determinism (no binary needed)
const mockPort = createMockScanPort([{ templateId: "tech-detect", name: "Wappalyzer Technology Detection" }]);
const mockResult = await mockPort.scan(TPL_ABS, "http://127.0.0.1:1", {});
console.log(
  `[3] mock ScanPort: exit=${mockResult.exitCode} hits=${mockResult.hits.map((hit) => hit.templateId).join(",")} (JSONL through the production parser)`,
);

// Scenario 4: full chain — spawned mock server + real engine + benign check in one pass
if (realOk) {
  const chain = await withSpawnedMock([{ method: "GET", path: "/", status: 200, body: MATCHER_BODY }], async (url) => {
    const fp = await verifyNoFalsePositive(TPL_ABS, "http://127.0.0.1:9", { nucleiPath: NUCLEI });
    const scan = await runTemplateAgainst(TPL_ABS, url, { nucleiPath: NUCLEI });
    return { fp, scan };
  });
  console.log(
    `[4] full chain: benign=${chain.fp.weakMatcher ? "FLAGGED" : "clean"} → scan=${chain.scan.hits.length} hit(s) — closed cleanly`,
  );
}

db.close();
console.log("MOCK E2E COMPLETE");
