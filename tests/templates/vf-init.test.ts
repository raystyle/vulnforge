import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import loadExtension from "../helpers/capture.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function call(name: string, params: unknown, cwd: string) {
  const tools = loadExtension().tools;
  const tool = tools.find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`tool ${name} not registered`);
  const result = (await tool.execute("t", params, undefined, undefined, { cwd, hasUI: false })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: result.content[0]?.text ?? "", isError: result.isError === true };
}

describe("vf_init --init (config generation)", () => {
  it("generates a lint-valid skeleton in an empty workspace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-init-"));
    scratch.push(dir);
    const outcome = await call("vf_init", { action: "init" }, dir);
    expect(outcome.isError).toBe(false);
    const marker = join(dir, ".vulnforge.json");
    expect(existsSync(marker)).toBe(true);
    const text = readFileSync(marker, "utf8");
    expect(text).toContain('"rust-scripts"');
    expect(text).toContain("templates.db");
  });

  it("re-init without force is an idempotent no-op", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-init-"));
    scratch.push(dir);
    await call("vf_init", { action: "init" }, dir);
    const marker = join(dir, ".vulnforge.json");
    const before = readFileSync(marker, "utf8");
    const outcome = await call("vf_init", { action: "init" }, dir);
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain("already exists");
    expect(readFileSync(marker, "utf8")).toBe(before);
  });

  it("force without UI is refused (destructive, confirm-gated)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-init-"));
    scratch.push(dir);
    await call("vf_init", { action: "init" }, dir);
    const outcome = await call("vf_init", { action: "init", force: true }, dir);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("CANCELLED");
  });
});
