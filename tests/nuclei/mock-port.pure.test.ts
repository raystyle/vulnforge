import { describe, expect, it } from "vitest";
import { createMockScanPort, parseJsonlHits, verifyNoFalsePositive } from "../../src/nuclei/run.ts";

const URL_A = "http://127.0.0.1:1";

describe("createMockScanPort (in-process mock)", () => {
  it("emits hits through the production JSONL parser", async () => {
    const scanPort = createMockScanPort([
      { templateId: "acme-panel-rce", name: "ACME Panel - RCE", matchedAt: `${URL_A}/exec` },
    ]);
    const result = await scanPort.scan("tpl.yaml", URL_A, {});
    expect(result.exitCode).toBe(0);
    expect(result.hits.map((hit) => hit.templateId)).toEqual(["acme-panel-rce"]);
    expect(result.hits[0]?.infoName).toBe("ACME Panel - RCE");
    expect(result.hits[0]?.matchedAt).toBe(`${URL_A}/exec`);
  });

  it("returns zero hits for empty findings (benign counter-check stays green)", async () => {
    const scanPort = createMockScanPort([]);
    const verdict = await verifyNoFalsePositive("tpl.yaml", URL_A, { scanPort });
    expect(verdict.weakMatcher).toBe(false);
    expect(verdict.hits).toHaveLength(0);
  });

  it("flags a weak matcher when injected findings hit the benign target", async () => {
    const scanPort = createMockScanPort([{ templateId: "generic-error-page" }]);
    const verdict = await verifyNoFalsePositive("tpl.yaml", URL_A, { scanPort });
    expect(verdict.weakMatcher).toBe(true);
    expect(verdict.hits.map((hit) => hit.templateId)).toEqual(["generic-error-page"]);
  });

  it("mock output is line-delimited JSON compatible with the real parser", async () => {
    const scanPort = createMockScanPort([{ templateId: "a" }, { templateId: "b" }]);
    const result = await scanPort.scan("t.yaml", URL_A, {});
    const lines = result.rawOutput.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(parseJsonlHits(result.rawOutput).map((hit) => hit.templateId)).toEqual(["a", "b"]);
  });
});
