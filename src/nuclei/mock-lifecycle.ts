import { createActor, setup } from "xstate";
import type { ControlEvent } from "./mock-client.ts";

/**
 * Lifecycle state machine for one spawned mock-server child — event-driven
 * per the project rule (no exemptions): every transition is an event,
 * lifecycle is observable and exhaustive.
 */
export const MockLifecycleMachine = setup({
  types: {
    context: {} as { targetUrl: string; port: number },
    events: {} as
      | { type: "SPAWN" }
      | { type: "READY" }
      | { type: "CLOSED" }
      | { type: "CHILD_ERROR"; message: string }
      | { type: "CLOSE_REQUESTED" },
    input: {} as { targetUrl: string; port: number },
  },
}).createMachine({
  id: "mock-lifecycle",
  initial: "spawning",
  context: ({ input }) => ({ targetUrl: input.targetUrl, port: input.port }),
  states: {
    spawning: {
      on: {
        SPAWN: { target: "ready" },
        CHILD_ERROR: { target: "failed" },
      },
    },
    ready: {
      on: {
        CLOSED: { target: "closed" },
        CLOSE_REQUESTED: { target: "closing" },
      },
    },
    closing: {
      on: { CLOSED: { target: "closed" } },
    },
    closed: { type: "final" },
    failed: { type: "final" },
  },
});

/** Compile-time exhaustiveness: every lifecycle event must be mapped. */
export function assertLifecycleEventHandled(event: { type: string }): never {
  switch (event.type) {
    case "SPAWN":
    case "READY":
    case "CLOSED":
    case "CLOSE_REQUESTED":
    case "CHILD_ERROR":
      throw new Error(`unreachable: ${event.type} is handled by the lifecycle machine`);
    default: {
      const unhandled: never = event as never;
      throw new Error(`unhandled lifecycle event: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Phase-reporter: drive the machine from control events, expose the phase. */
export function trackMockLifecycle(initialUrl: string, initialPort: number) {
  const actor = createActor(MockLifecycleMachine, {
    input: { targetUrl: initialUrl, port: initialPort },
  });
  actor.start();
  return {
    phase(): "spawning" | "ready" | "closing" | "closed" | "failed" {
      const value = actor.getSnapshot().value;
      switch (value) {
        case "spawning":
        case "ready":
        case "closing":
        case "closed":
        case "failed":
          return value;
        default:
          return "spawning";
      }
    },
    spawn() {
      actor.send({ type: "SPAWN" });
    },
    controlEvent(evt: ControlEvent) {
      switch (evt.event) {
        case "ready":
          actor.send({ type: "READY" });
          break;
        case "closed":
          actor.send({ type: "CLOSED" });
          break;
        case "error":
          actor.send({ type: "CHILD_ERROR", message: evt.message });
          break;
      }
    },
  };
}
