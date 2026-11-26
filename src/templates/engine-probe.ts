import { createActor, setup } from "xstate";
import type { NucleiAvailability } from "./run.ts";

/**
 * Engine-probe state machine for the real scan path (event-driven per the
 * project rule, no exemptions): probing → available | unavailable, with
 * re-probe allowed from either terminal for environment changes mid-session.
 */
export const EngineProbeMachine = setup({
  types: {
    context: {} as { lastVersion?: string | undefined; lastReason?: string | undefined },
    events: {} as
      | { type: "PROBE_RESULT"; available: true; version: string }
      | { type: "PROBE_RESULT"; available: false; reason: string }
      | { type: "REPROBE" },
    input: {} as Record<string, never>,
  },
}).createMachine({
  id: "engine-probe",
  initial: "probing",
  context: () => ({}),
  states: {
    probing: {
      on: {
        PROBE_RESULT: [
          { guard: ({ event }) => event.available === true, target: "available" },
          { target: "unavailable" },
        ],
      },
    },
    available: {
      on: { REPROBE: { target: "probing", reenter: true } },
    },
    unavailable: {
      on: { REPROBE: { target: "probing", reenter: true } },
    },
  },
});

/** Compile-time exhaustiveness for probe events. */
export function assertEngineProbeEventHandled(event: { type: string }): never {
  switch (event.type) {
    case "PROBE_RESULT":
    case "REPROBE":
      throw new Error(`unreachable: ${event.type} is handled by the engine probe machine`);
    default: {
      const unhandled: never = event as never;
      throw new Error(`unhandled engine-probe event: ${JSON.stringify(unhandled)}`);
    }
  }
}

export interface EngineProbeState {
  phase: "probing" | "available" | "unavailable";
  availability?: NucleiAvailability | undefined;
}

/** Drive the probe machine from a checkNuclei result. */
export function probeEngine(availability: NucleiAvailability): EngineProbeState {
  const actor = createActor(EngineProbeMachine, { input: {} });
  actor.start();
  if (availability.available) {
    actor.send({ type: "PROBE_RESULT", available: true, version: availability.version ?? "unknown" });
  } else {
    actor.send({
      type: "PROBE_RESULT",
      available: false,
      reason: availability.reason ?? "unknown",
    });
  }
  const snapshot = actor.getSnapshot();
  const lastVersion = snapshot.context.lastVersion;
  const lastReason = snapshot.context.lastReason;
  return {
    phase: snapshot.value as EngineProbeState["phase"],
    availability: {
      available: snapshot.value === "available",
      ...(lastVersion !== undefined ? { version: lastVersion } : {}),
      ...(lastReason !== undefined ? { reason: lastReason } : {}),
    },
  };
}
