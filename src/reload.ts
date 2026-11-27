/**
 * The reload intent machine: an agent-requested runtime reload that must
 * defer until the current run settles (Pi refuses reloads mid-run). The
 * tool sets the intent and terminates the run; agent_settled dispatches
 * the /vf-reload command which performs ctx.reload().
 */
import { createActor, setup } from "xstate";

export type ReloadEvent = { type: "REQUEST"; reason: string } | { type: "DISPATCH" } | { type: "RESET" };

export interface ReloadContext {
  reason: string;
}

export const ReloadIntentMachine = setup({
  types: {
    context: {} as ReloadContext,
    events: {} as ReloadEvent,
  },
}).createMachine({
  id: "reload-intent",
  initial: "idle",
  context: { reason: "" },
  states: {
    idle: {
      on: {
        REQUEST: {
          target: "pending",
          actions: ({ event, context }) => {
            context.reason = event.reason;
          },
        },
      },
    },
    pending: {
      on: {
        DISPATCH: "dispatched",
        RESET: {
          target: "idle",
          actions: ({ context }) => {
            context.reason = "";
          },
        },
      },
    },
    dispatched: {
      // Terminal for this session: reload replaces the whole module, so a
      // dispatched intent never needs to cycle back.
    },
  },
});

/** Compile-time exhaustiveness: a new ReloadEvent variant without a
 * handler below fails tsc (pi-extension rule: switch all cases + never). */
export function assertReloadIntentHandled(event: ReloadEvent): never {
  switch (event.type) {
    case "REQUEST":
    case "DISPATCH":
    case "RESET":
      break;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
  throw new Error(`unhandled reload event: ${JSON.stringify(event)}`);
}

export interface ReloadIntent {
  /** Request a reload; false when one is already pending (first wins). */
  request(reason: string): boolean;
  /** Atomically claim a pending intent for dispatch; false when none. */
  takePending(): boolean;
  /** Current phase (idle | pending | dispatched) — observability. */
  phase(): string;
}

export function createReloadIntent(): ReloadIntent {
  const actor = createActor(ReloadIntentMachine);
  actor.start();
  return {
    request(reason) {
      if (actor.getSnapshot().status !== "active") actor.start();
      if (actor.getSnapshot().value !== "idle") return false;
      actor.send({ type: "REQUEST", reason });
      return true;
    },
    takePending() {
      if (actor.getSnapshot().value !== "pending") return false;
      actor.send({ type: "DISPATCH" });
      return true;
    },
    phase() {
      return String(actor.getSnapshot().value);
    },
  };
}
