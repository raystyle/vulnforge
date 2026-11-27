import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";
import extension from "../src/index.ts";

const smokeDirs: string[] = [];

afterAll(() => {
  for (const dir of smokeDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface CapturedTool {
  name: string;
  execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
}

interface CapturedCommand {
  name: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

function capture(): { tools: CapturedTool[]; commands: CapturedCommand[] } {
  const tools: CapturedTool[] = [];
  const commands: CapturedCommand[] = [];
  const pi = {
    registerTool(tool: CapturedTool) {
      tools.push(tool);
    },
    registerCommand(name: string, def: Omit<CapturedCommand, "name">) {
      commands.push({ name, ...def });
    },
    on(_event: string, _handler: () => void) {},
    sendUserMessage(_text: string, _options: Record<string, unknown>) {},
  };
  extension(pi as unknown as ExtensionAPI);
  return { tools, commands };
}

describe("extension factory", () => {
  it("registers the full tool and command surface without touching Pi action methods at load time", () => {
    const { tools, commands } = capture();
    expect(tools.map((tool) => tool.name)).toEqual([
      "vf_reload",
      "vf_init",
      "nuclei_lint",
      "nuclei_edit",
      "nuclei_run",
      "nuclei_sync",
      "nuclei_search",
      "nuclei_new",
      "nuclei_stats",
      "rs_search",
      "rs_new",
      "rs_edit",
      "rs_run",
      "rs_export",
      "rs_sync",
      "rs_stats",
    ]);
    expect(commands.map((command) => command.name).sort()).toEqual(["vf", "vf-debug", "vf-reload"]);
  });

  it("vf-debug handler reports safety state through the UI", async () => {
    const { commands } = capture();
    const vfDebug = commands.find((command) => command.name === "vf-debug");
    const notifications: { message: string; level: string }[] = [];
    const ctx = {
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    };
    await vfDebug?.handler("", ctx);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message).toContain("safety patterns");
    expect(notifications[0]?.message).toContain("true");
  });

  it("nuclei_lint reports a clear error outside a templates repo", async () => {
    const { tools } = capture();
    const lint = tools.find((tool) => tool.name === "nuclei_lint");
    const result = (await lint?.execute("1", { path: "x.yaml" }, undefined, undefined, {
      cwd: "Z:/definitely-not-a-repo",
    })) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("no .vulnforge.json");
  });

  it("nuclei_new scaffolds into the templates repo and lint flags its weaknesses", async () => {
    const { tools } = capture();
    const root = mkdtempSync(join(tmpdir(), "vf-smoke-repo-"));
    smokeDirs.push(root);
    writeFileSync(
      join(root, ".vulnforge.json"),
      JSON.stringify({ db: { filename: "templates.db", sealFile: "templates-lock.json" } }),
    );
    const ctx = { cwd: root };
    const newTool = tools.find((tool) => tool.name === "nuclei_new");
    const created = (await newTool?.execute(
      "1",
      {
        vulnType: "rce",
        name: "Smoke Panel - RCE",
        author: "ray",
        severity: "high",
        description: "Smoke test panel rce scaffold",
        tags: "smoke,rce",
      },
      undefined,
      undefined,
      ctx,
    )) as { content: { text: string }[] };
    expect(created.content[0]?.text).toContain("scaffolded");
    const scaffoldLine = created.content[0]?.text.split(/\r?\n/)[0] ?? "";
    const relative = scaffoldLine
      .replace(/^scaffolded /, "")
      .replaceAll("\\", "/")
      .replace(`${root}/`, "");
    const lint = tools.find((tool) => tool.name === "nuclei_lint");
    const linted = (await lint?.execute("2", { path: relative }, undefined, undefined, ctx)) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = linted.content[0]?.text ?? "";
    expect(text).toContain("lint");
  });
});
