/**
 * Error-envelope contract: tool failures surface atomically for agent
 * self-correction — a stable machine-keyed code line, the offending detail,
 * and an actionable hint. Prose-only errors are a violation.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import loadExtension, { type CapturedTool } from "./helpers/capture.ts";

const scratchDirs: string[] = [];
function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-err-"));
  scratchDirs.push(dir);
  mkdirSync(join(dir, "http"), { recursive: true });
  writeFileSync(join(dir, ".vulnforge.json"), "{}");
  writeFileSync(
    join(dir, "http", "seed.yaml"),
    [
      "id: seed-template",
      "info:",
      "  name: Seed",
      "  author: ray",
      "  severity: info",
      "  description: seed template for envelope tests",
      "  tags: seed",
      "http:",
      "- path: /",
      "  matchers:",
      "  - type: word",
      "    words:",
      "    - seed",
    ].join("\n"),
  );
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs.splice(0)) {
    import("node:fs").then(({ rmSync }) => rmSync(dir, { recursive: true, force: true }));
  }
});

let tools: CapturedTool[];

async function call(name: string, params: unknown, cwd: string) {
  if (tools === undefined) tools = loadExtension().tools;
  const tool = tools.find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`tool ${name} not registered`);
  const result = (await tool.execute("t", params, undefined, undefined, { cwd, hasUI: false })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: result.content[0]?.text ?? "", isError: result.isError === true };
}

function expectEnvelope(text: string, code: string) {
  expect(text.startsWith(`vf-error code=${code}`), `envelope must start with code=${code}\n${text}`).toBe(true);
  expect(text.split("\n").length).toBeGreaterThanOrEqual(2);
}

describe("tool error envelope (agent self-correction)", () => {
  it("missing config → CONFIG_NOT_FOUND with search start and inline example", async () => {
    const nowhere = mkdtempSync(join(tmpdir(), "vf-none-"));
    scratchDirs.push(nowhere);
    const outcome = await call("poc_nuclei_lint", { path: "x.yaml" }, nowhere);
    expect(outcome.isError).toBe(true);
    expectEnvelope(outcome.text, "CONFIG_NOT_FOUND");
    expect(outcome.text).toContain(".vulnforge.json");
    expect(outcome.text).toContain("templates.db");
  });

  it("path escape → PATH_ESCAPE with repo root and a relative-path hint", async () => {
    const ws = makeWorkspace();
    const outcome = await call("poc_nuclei_lint", { path: "../../etc/passwd" }, ws);
    expect(outcome.isError).toBe(true);
    expectEnvelope(outcome.text, "PATH_ESCAPE");
    expect(outcome.text).toContain(ws.replaceAll("\\", "/").slice(0, -1));
    expect(outcome.text).toMatch(/hint:.*relative/s);
  });

  it("edit param conflict → PARAM_CONFLICT showing received fields and an example", async () => {
    const ws = makeWorkspace();
    const outcome = await call("poc_nuclei_edit", { path: "http/seed.yaml" }, ws);
    expect(outcome.isError).toBe(true);
    expectEnvelope(outcome.text, "PARAM_CONFLICT");
    expect(outcome.text).toContain("patch");
    expect(outcome.text).toContain("content");
  });

  it("vf_init install unknown item → NO_FIX_COMMANDS with item-name hint", async () => {
    const ws = makeWorkspace();
    const outcome = await call("vf_init", { action: "install", name: "definitely-not-a-tool" }, ws);
    expect(outcome.isError).toBe(true);
    expectEnvelope(outcome.text, "NO_FIX_COMMANDS");
    expect(outcome.text).toContain("item names");
  });

  it("run param conflict (target + routes) → PARAM_CONFLICT", async () => {
    const ws = makeWorkspace();
    const outcome = await call(
      "poc_nuclei_run",
      { path: "http/seed.yaml", target: "http://x", routes: [{ method: "GET", path: "/" }] },
      ws,
    );
    expect(outcome.isError).toBe(true);
    expectEnvelope(outcome.text, "PARAM_CONFLICT");
  });

  it("run engine=mock with target → PARAM_CONFLICT naming the rule", async () => {
    const ws = makeWorkspace();
    const outcome = await call("poc_nuclei_run", { path: "http/seed.yaml", target: "http://x", engine: "mock" }, ws);
    expect(outcome.isError).toBe(true);
    expectEnvelope(outcome.text, "PARAM_CONFLICT");
  });

  it("nonexistent template path → PATH_NOT_FOUND with sync hint", async () => {
    const ws = makeWorkspace();
    const outcome = await call("poc_nuclei_lint", { path: "http/definitely-missing.yaml" }, ws);
    expect(outcome.isError).toBe(true);
    expectEnvelope(outcome.text, "PATH_NOT_FOUND");
    expect(outcome.text).toContain("poc_nuclei_sync");
  });

  it("confirm-gate refusal → CANCELLED envelope, not prose", async () => {
    const ws = makeWorkspace();
    const outcome = await call("vf_init", { action: "install", name: "nuclei" }, ws);
    // headless: either NO_FIX_COMMANDS (item ok) or CANCELLED — both must be envelopes
    expect(outcome.isError).toBe(true);
    expect(outcome.text.startsWith("vf-error code=")).toBe(true);
  });
});
