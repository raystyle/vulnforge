import { describe, expect, it } from "vitest";
import loadExtension from "./helpers/capture.ts";

describe("vf_reload registration and wiring", () => {
  it("registers the tool, the command, and the settled handler chain", () => {
    const pi = loadExtension();
    const tool = pi.tools.find((entry) => entry.name === "vf_reload");
    expect(tool).toBeDefined();
    const command = pi.commands.find((entry) => entry.name === "vf-reload");
    expect(command).toBeDefined();
    expect(pi.onCalls.map((call) => call.event)).toContain("agent_settled");
    expect(pi.sentMessages.length).toBe(0);
  });

  it("execute terminates the run and dispatches /vf-reload on settle", async () => {
    const pi = loadExtension();
    const tool = pi.tools.find((entry) => entry.name === "vf_reload");
    if (tool === undefined) throw new Error("vf_reload not registered");
    const result = (await tool.execute("t", {}, undefined, undefined, { cwd: process.cwd(), hasUI: false })) as {
      terminate?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.terminate).toBe(true);
    expect(result.content[0]?.text).toContain("Reload requested");
    // settle fires the pending intent → the /vf-reload command is sent
    pi.emitSettled();
    expect(pi.sentMessages).toEqual([{ text: "/vf-reload", options: { expandPromptTemplates: true } }]);
    // idempotent: a second settle with no pending intent sends nothing
    pi.emitSettled();
    expect(pi.sentMessages).toHaveLength(1);
  });

  it("second vf_reload call reports already-pending without terminate", async () => {
    const pi = loadExtension();
    const tool = pi.tools.find((entry) => entry.name === "vf_reload");
    if (tool === undefined) throw new Error("vf_reload not registered");
    await tool.execute("t", { reason: "first" }, undefined, undefined, { cwd: process.cwd(), hasUI: false });
    const second = (await tool.execute("t", {}, undefined, undefined, {
      cwd: process.cwd(),
      hasUI: false,
    })) as { terminate?: boolean; isError?: boolean; content: Array<{ text: string }> };
    expect(second.terminate).toBeUndefined();
    expect(second.content[0]?.text).toContain("already pending");
  });
});
