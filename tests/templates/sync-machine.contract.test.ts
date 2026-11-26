import { describe, expect, it } from "vitest";
import { assertSyncEventHandled, SYNC_EVENT_TYPES, syncMachine } from "../../src/templates/sync-machine.ts";

/**
 * Machine contract: compile-time exhaustiveness lives in
 * assertSyncEventHandled (adding a SyncEvent variant without a switch case
 * fails tsc); this runtime mirror also verifies the machine graph wires
 * every declared event.
 */
describe("sync machine event coverage", () => {
  it("handles every declared event type", () => {
    const json = JSON.stringify(syncMachine);
    for (const eventType of SYNC_EVENT_TYPES) {
      expect(json, `event ${eventType} must appear in the machine definition`).toContain(`"${eventType}"`);
    }
  });

  it("reaches every declared state", () => {
    const states = ["scanning", "indexing", "sealing", "done", "aborted"];
    const json = JSON.stringify(syncMachine);
    for (const state of states) {
      expect(json, `state ${state} must appear in the machine definition`).toContain(`"${state}"`);
    }
  });

  it("guard rejects unknown event types at runtime", () => {
    expect(() => assertSyncEventHandled({ type: "FUTURE_EVENT" } as never)).toThrow(/unhandled sync event/);
  });
});
