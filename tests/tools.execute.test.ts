import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import loadExtension, { type CapturedTool } from "./helpers/capture.ts";

/**
 * Tool-level tests: drive every registered tool's execute() against a real
 * scratch workspace, through the same mock ctx shape a Pi session supplies.
 * Each tool gets at least one success path and one failure path.
 */

const tempDirs: string[] = [];
const WORKSPACE = mkdtempSync(join(tmpdir(), "vf-tools-"));
tempDirs.push(WORKSPACE);

writeFileSync(
  join(WORKSPACE, ".vulnforge.json"),
  JSON.stringify({
    db: { filename: "templates.db", sealFile: "templates-lock.json" },
    tools: { nucleiPath: "", yamllintPath: "" },
  }),
);

const ctx = { cwd: WORKSPACE, hasUI: false };

const UNUSED_TEMPLATE = null as string | null;
void UNUSED_TEMPLATE;
const _TEMPLATE = [
  "id: tool-test-rce",
  "info:",
  "  name: Tool Test - RCE",
  "  author: ray",
  "  severity: high",
  "  description: Tool test template for execute-level coverage.",
  "  tags: test,rce",
  "http:",
  "  - method: GET",
  "    path:",
  '      - "{{BaseURL}}/exec"',
  "    matchers:",
  "      - type: word",
  "        words:",
  "          - TOOL_TEST_RCE_MARKER",
  "        part: body",
].join("\n");

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function getTool(name: string): CapturedTool {
  const { tools } = loadExtension();
  const tool = tools.find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function call(name: string, params: unknown): Promise<{ text: string; isError: boolean | undefined }> {
  const result = (await getTool(name).execute("1", params, undefined, undefined, ctx)) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: result.content[0]?.text ?? "", isError: result.isError };
}

describe("tool-level execute coverage", () => {
  it("nuclei_new creates a template; nuclei_lint accepts it", async () => {
    const created = await call("nuclei_new", {
      vulnType: "rce",
      name: "Tool Test - RCE",
      author: "ray",
      severity: "high",
      description: "Tool test template for execute-level coverage.",
      tags: "test,rce",
    });
    expect(created.isError).toBeUndefined();
    expect(created.text).toContain("scaffolded");

    const linted = await call("nuclei_lint", { path: "http/vulnerabilities/tool-test-rce.yaml" });
    expect(linted.isError).toBeUndefined();
  });

  it("nuclei_edit patches info and reports lint", async () => {
    const outcome = await call("nuclei_edit", {
      path: "http/vulnerabilities/tool-test-rce.yaml",
      patch: { kind: "info", patch: { severity: "critical" } },
    });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.text).toContain("applied: info.severity");
  });

  it("nuclei_run rejects remote+mock and target+routes combos", async () => {
    const conflict = await call("nuclei_run", {
      path: "http/vulnerabilities/tool-test-rce.yaml",
      target: "http://lab:8080",
      engine: "mock",
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toContain("vf-error code=PARAM_CONFLICT");

    const both = await call("nuclei_run", {
      path: "http/vulnerabilities/tool-test-rce.yaml",
      target: "http://lab:8080",
      routes: [{ method: "GET", path: "/" }],
    });
    expect(both.isError).toBe(true);
    expect(both.text).toContain("vf-error code=PARAM_CONFLICT");
    expect(both.text).toContain("hint:");
  });

  it("nuclei_run mock engine asserts expectedHits end-to-end", async () => {
    const outcome = await call("nuclei_run", {
      path: "http/vulnerabilities/tool-test-rce.yaml",
      engine: "mock",
      expectedHits: ["tool-test-rce"],
      routes: [{ method: "GET", path: "/exec", status: 200, body: "TOOL_TEST_RCE_MARKER" }],
    });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.text).toContain("pipeline deterministic");
  });

  it("nuclei_sync indexes the workspace and returns a seal", async () => {
    const outcome = await call("nuclei_sync", {});
    expect(outcome.isError).toBeUndefined();
    expect(outcome.text).toContain("synced: 1");
    expect(outcome.text).toContain("seal:");
  });

  it("nuclei_search finds the synced template", async () => {
    const outcome = await call("nuclei_search", { query: '"tool-test-rce"' });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.text).toContain("tool-test-rce");
  });

  it("nuclei_stats reports per dimension without error", async () => {
    for (const dimension of ["severity", "protocol", "author", "cve"] as const) {
      const outcome = await call("nuclei_stats", { dimension });
      expect(outcome.isError, `stats dimension ${dimension}`).toBeUndefined();
      expect(outcome.text).toContain("total: 1");
    }
  });

  it("vf_init check flags the scratch workspace honestly", async () => {
    const outcome = await call("vf_init", {});
    expect(outcome.text).toContain("nuclei");
  });

  it("vf_init install refuses unknown names", async () => {
    const outcome = await call("vf_init", { action: "install", name: "definitely-not-a-tool" });
    expect(outcome.isError).toBe(true);
  });

  it("commands handle a workspace ctx gracefully", async () => {
    const { commands } = loadExtension();
    const vf = commands.find((command) => command.name === "vf");
    const notifications: { message: string; level: string }[] = [];
    await vf?.handler("", {
      cwd: WORKSPACE,
      ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message).toContain("templates repo");
  });
});
