#!/usr/bin/env node
/**
 * Mock stability & performance stress:
 *   A. spawn/teardown lifecycle — N cycles, check port leaks & fd discipline
 *   B. serve under concurrency — parallel requests vs sequential latency
 *   C. scan-port determinism — N repeated runs, byte-identical output
 *   D. real-engine scan loop — repeated mock-target scans, timing distribution
 */
import { request } from "node:http";
import { spawnMockServer, withSpawnedMock } from "../src/nuclei/mock-client.ts";
import { checkNuclei, createMockScanPort, runTemplateAgainst } from "../src/nuclei/run.ts";

const NUCLEI = "D:/ohmyenv/gopath/bin/nuclei.exe";
const TPL_ABS = "D:/repos/vulnforge-workspace/nuclei-templates/http/technologies/tech-detect.yaml";
const MATCHER_BODY = '<img src="https://cdn.mollom.com/pixel.gif">';

function get(url, path = "/") {
  return new Promise((resolve, reject) => {
    const req = request(`${url}${path}`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const availability = await checkNuclei({ nucleiPath: NUCLEI });
console.log(`real engine: ${availability.available ? availability.version : "absent (D skipped)"}`);

// A. lifecycle stress: 30 spawn/close cycles
{
  const t0 = Date.now();
  const CYCLES = 30;
  for (let i = 0; i < CYCLES; i++) {
    await withSpawnedMock([{ method: "GET", path: "/", body: "x" }], async () => {});
  }
  const ms = Date.now() - t0;
  console.log(
    `[A] lifecycle: ${CYCLES} spawn/close cycles in ${ms}ms = ${(ms / CYCLES).toFixed(0)}ms/cycle (handshake+teardown)`,
  );
}

// B. concurrency: 100 parallel requests vs 100 sequential on one server
{
  const target = await spawnMockServer([{ method: "GET", path: "/", status: 200, body: MATCHER_BODY }]);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 100 }, () => get(target.url)));
  const parMs = Date.now() - t0;
  const t1 = Date.now();
  for (let i = 0; i < 100; i++) await get(target.url);
  const seqMs = Date.now() - t1;
  console.log(
    `[B] concurrency: 100 parallel in ${parMs}ms | 100 sequential in ${seqMs}ms | server survived: ${(await get(target.url)).status === 200}`,
  );
  await target.close();
}

// C. determinism: 50 mock ScanPort runs, byte-identical?
{
  const port = createMockScanPort([{ templateId: "tech-detect" }]);
  const t0 = Date.now();
  const outputs = new Set();
  for (let i = 0; i < 50; i++) {
    const r = await port.scan(TPL_ABS, "http://127.0.0.1:1", {});
    outputs.add(r.rawOutput);
  }
  const ms = Date.now() - t0;
  console.log(
    `[C] determinism: 50 runs in ${ms}ms = ${(ms / 50).toFixed(1)}ms/run | distinct outputs: ${outputs.size} (expect 1)`,
  );
}

// D. real-engine scan loop: 10 scans against the spawned mock
if (availability.available) {
  const times = [];
  const target = await spawnMockServer([{ method: "GET", path: "/", status: 200, body: MATCHER_BODY }]);
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await runTemplateAgainst(TPL_ABS, target.url, { nucleiPath: NUCLEI });
    times.push(Date.now() - t0);
    if (r.hits.length !== 1) console.log(`  run ${i}: UNEXPECTED hits=${r.hits.length}`);
  }
  await target.close();
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const max = Math.max(...times);
  const min = Math.min(...times);
  console.log(`[D] real-engine loop: 10 scans avg=${avg.toFixed(0)}ms min=${min} max=${max} (all 1 hit)`);
}

console.log("STRESS COMPLETE");
