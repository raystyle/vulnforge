import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import {
  assertLifecycleEventHandled,
  MockLifecycleMachine,
  trackMockLifecycle,
} from "../../src/templates/mock-lifecycle.ts";

describe("MockLifecycleMachine (event-driven lifecycle)", () => {
  it("spawning → SPAWN → ready → CLOSED → closed", () => {
    const actor = createActor(MockLifecycleMachine, { input: { targetUrl: "http://127.0.0.1:1", port: 1 } });
    actor.start();
    expect(actor.getSnapshot().value).toBe("spawning");
    actor.send({ type: "SPAWN" });
    expect(actor.getSnapshot().value).toBe("ready");
    actor.send({ type: "CLOSED" });
    expect(actor.getSnapshot().value).toBe("closed");
  });

  it("spawning → CHILD_ERROR → failed (terminal)", () => {
    const actor = createActor(MockLifecycleMachine, { input: { targetUrl: "http://127.0.0.1:1", port: 1 } });
    actor.start();
    actor.send({ type: "CHILD_ERROR", message: "spawn broke" });
    expect(actor.getSnapshot().value).toBe("failed");
  });

  it("ready → CLOSE_REQUESTED → closing → CLOSED → closed", () => {
    const actor = createActor(MockLifecycleMachine, { input: { targetUrl: "http://127.0.0.1:1", port: 1 } });
    actor.start();
    actor.send({ type: "SPAWN" });
    actor.send({ type: "CLOSE_REQUESTED" });
    expect(actor.getSnapshot().value).toBe("closing");
    actor.send({ type: "CLOSED" });
    expect(actor.getSnapshot().value).toBe("closed");
  });

  it("phase reporter maps control events to lifecycle states", () => {
    const t = trackMockLifecycle("http://127.0.0.1:2", 2);
    expect(t.phase()).toBe("spawning");
    t.spawn();
    expect(t.phase()).toBe("ready");
    t.controlEvent({ event: "closed" });
    expect(t.phase()).toBe("closed");
  });

  it("control error event transitions to failed via the reporter", () => {
    const t = trackMockLifecycle("http://127.0.0.1:4", 4);
    t.controlEvent({ event: "error", message: "child died" });
    expect(t.phase()).toBe("failed");
  });

  it("guard rejects unknown lifecycle event types", () => {
    expect(() => assertLifecycleEventHandled({ type: "FUTURE" } as never)).toThrow(/unhandled lifecycle event/);
  });
});
