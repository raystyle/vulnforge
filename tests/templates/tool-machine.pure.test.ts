import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import {
  assertToolExecutionEventHandled,
  runWithToolMachine,
  ToolExecutionMachine,
  withToolMachine,
} from "../../src/templates/tool-machine.ts";

describe("tool-execution state machine (event-driven, minimal)", () => {
  it("idle → START → executing → SUCCEED → done", () => {
    const actor = createActor(ToolExecutionMachine, { input: { label: "vf_test" } });
    actor.start();
    expect(actor.getSnapshot().value).toBe("idle");
    actor.send({ type: "START" });
    expect(actor.getSnapshot().value).toBe("executing");
    actor.send({ type: "SUCCEED" });
    expect(actor.getSnapshot().value).toBe("done");
  });

  it("executing → FAIL(error) → failed with the error in context", () => {
    const actor = createActor(ToolExecutionMachine, { input: { label: "vf_test" } });
    actor.start();
    actor.send({ type: "START" });
    actor.send({ type: "FAIL", error: "boom" });
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("failed");
    expect(snapshot.context.error).toBe("boom");
  });

  it("guard rejects unknown event types", () => {
    expect(() => assertToolExecutionEventHandled({ type: "FUTURE" } as never)).toThrow(
      /unhandled tool-execution event/,
    );
  });

  it("runWithToolMachine: success result passes through and reports done", async () => {
    const phases: string[] = [];
    const value = await runWithToolMachine(
      "vf_test",
      async () => ({ content: [], isError: false }),
      (state) => phases.push(state.phase),
    );
    expect(value.isError).toBe(false);
    expect(phases).toEqual(["executing", "done"]);
  });

  it("runWithToolMachine: isError result reports failed with no error detail", async () => {
    const phases: string[] = [];
    await runWithToolMachine(
      "vf_test",
      async () => ({ content: [], isError: true }),
      (state) => phases.push(state.phase),
    );
    expect(phases).toEqual(["executing", "failed"]);
  });

  it("runWithToolMachine: thrown error reports failed with the message and rethrows", async () => {
    const phases: string[] = [];
    const errors: (string | undefined)[] = [];
    await expect(
      runWithToolMachine(
        "vf_test",
        async () => {
          throw new Error("engine blew up");
        },
        (state) => {
          phases.push(state.phase);
          errors.push(state.error);
        },
      ),
    ).rejects.toThrow("engine blew up");
    expect(phases).toEqual(["executing", "failed"]);
    expect(errors).toEqual([undefined, "engine blew up"]);
  });

  it("withToolMachine: wraps an execute fn, preserves args and return value", async () => {
    const calls: unknown[][] = [];
    const wrapped = withToolMachine("vf_test", async (...args: unknown[]) => {
      calls.push(args);
      return { content: [{ type: "text" as const, text: "ok" }], isError: false };
    });
    const ctx = { cwd: "/tmp", hasUI: false };
    const result = await wrapped("call-1", { a: 1 }, undefined, undefined, ctx);
    expect(result.content[0]?.text).toBe("ok");
    expect(calls[0]?.[0]).toBe("call-1");
    expect(calls[0]?.[4]).toBe(ctx);
  });
});
