import { assign, createActor, setup } from "xstate";

/**
 * Minimal event-driven machine every single-step tool runs through (no
 * exemption per the state-machine rule): idle → START → executing →
 * SUCCEED | FAIL → done | failed. Gives every tool an observable,
 * exhaustive lifecycle without inventing per-tool transitions.
 */
export const ToolExecutionMachine = setup({
  types: {
    context: {} as { label: string; error?: string | undefined },
    events: {} as { type: "START" } | { type: "SUCCEED" } | { type: "FAIL"; error: string },
    input: {} as { label: string },
  },
}).createMachine({
  id: "tool-execution",
  initial: "idle",
  context: ({ input }) => ({ label: input.label }),
  states: {
    idle: {
      on: { START: { target: "executing" } },
    },
    executing: {
      on: {
        SUCCEED: { target: "done" },
        FAIL: {
          target: "failed",
          actions: assign({ error: ({ event }) => event.error }),
        },
      },
    },
    done: { type: "final" },
    failed: { type: "final" },
  },
});

/** Compile-time exhaustiveness: every tool-execution event must be mapped. */
export function assertToolExecutionEventHandled(event: { type: string }): never {
  switch (event.type) {
    case "START":
    case "SUCCEED":
    case "FAIL":
      throw new Error(`unreachable: ${event.type} is handled by the tool-execution machine`);
    default: {
      const unhandled: never = event as never;
      throw new Error(`unhandled tool-execution event: ${JSON.stringify(unhandled)}`);
    }
  }
}

export type ToolMachineObservation = { phase: "idle" | "executing" | "done" | "failed"; error?: string | undefined };

/**
 * Drive a tool body through the machine: START → run → SUCCEED (no isError)
 * or FAIL (isError or throw). Thrown errors are reported as failed and
 * rethrown so the framework keeps its own error path. `observe` receives
 * each phase transition for logging/testing.
 */
export async function runWithToolMachine<T extends { isError?: boolean | undefined }>(
  label: string,
  body: () => Promise<T>,
  observe?: (state: ToolMachineObservation) => void,
): Promise<T> {
  const actor = createActor(ToolExecutionMachine, { input: { label } });
  actor.start();
  actor.send({ type: "START" });
  observe?.({ phase: "executing" });
  try {
    const result = await body();
    if (result.isError === true) {
      actor.send({ type: "FAIL", error: "tool returned isError" });
      observe?.({ phase: "failed", error: "tool returned isError" });
    } else {
      actor.send({ type: "SUCCEED" });
      observe?.({ phase: "done" });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    actor.send({ type: "FAIL", error: message });
    observe?.({ phase: "failed", error: message });
    throw error;
  }
}

/**
 * Wrap a tool execute function so every call runs through the machine,
 * labelled with the tool name for observability. Signature-preserving via
 * generic identity: the returned function keeps the argument tuple and
 * return type of the input.
 */
export function withToolMachine<F extends (...args: never[]) => Promise<{ isError?: boolean | undefined }>>(
  label: string,
  execute: F,
): F {
  return ((...args: Parameters<F>) => runWithToolMachine(label, () => execute(...args))) as unknown as F;
}
