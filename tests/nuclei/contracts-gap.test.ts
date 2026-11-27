import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { assertEngineProbeEventHandled, EngineProbeMachine, probeEngine } from "../../src/nuclei/engine-probe.ts";
import { checkNuclei } from "../../src/nuclei/run.ts";
import {
  EngineModeSchema,
  RemoteTargetSchema,
  remoteTarget,
  ScaffoldIdSchema,
  ScaffoldInputSchema,
  scaffoldId,
  VulnTypeSchema,
} from "../../src/nuclei/scaffold-contract.ts";

describe("engine-probe state machine (event-driven)", () => {
  it("probing → PROBE_RESULT(available) → available", () => {
    const actor = createActor(EngineProbeMachine, { input: {} });
    actor.start();
    actor.send({ type: "PROBE_RESULT", available: true, version: "3.11.1" });
    expect(actor.getSnapshot().value).toBe("available");
  });

  it("probing → PROBE_RESULT(unavailable) → unavailable", () => {
    const actor = createActor(EngineProbeMachine, { input: {} });
    actor.start();
    actor.send({ type: "PROBE_RESULT", available: false, reason: "not installed" });
    expect(actor.getSnapshot().value).toBe("unavailable");
  });

  it("REPROBE returns either terminal state to probing", () => {
    const actor = createActor(EngineProbeMachine, { input: {} });
    actor.start();
    actor.send({ type: "PROBE_RESULT", available: false, reason: "x" });
    actor.send({ type: "REPROBE" });
    expect(actor.getSnapshot().value).toBe("probing");
  });

  it("probeEngine maps a real checkNuclei result through the machine", async () => {
    const availability = await checkNuclei();
    const state = probeEngine(availability);
    expect(["available", "unavailable", "probing"]).toContain(state.phase);
  });

  it("guard rejects unknown probe event types", () => {
    expect(() => assertEngineProbeEventHandled({ type: "FUTURE" } as never)).toThrow(/unhandled engine-probe event/);
  });
});

describe("scaffold / engine contracts (branded)", () => {
  it("ScaffoldIdSchema accepts kebab-case and rejects uppercase", () => {
    expect(ScaffoldIdSchema.safeParse("acme-panel-rce").success).toBe(true);
    expect(ScaffoldIdSchema.safeParse("ACME_Panel").success).toBe(false);
    expect(scaffoldId("acme-panel-rce")).toBe("acme-panel-rce");
  });

  it("VulnTypeSchema and EngineModeSchema are strict enums", () => {
    expect(VulnTypeSchema.safeParse("rce").success).toBe(true);
    expect(VulnTypeSchema.safeParse("ssrf").success).toBe(false);
    expect(EngineModeSchema.safeParse("mock").success).toBe(true);
    expect(EngineModeSchema.safeParse("realx").success).toBe(false);
  });

  it("ScaffoldInputSchema validates the full tool payload shape", () => {
    const good = {
      vulnType: "rce",
      name: "ACME Panel - RCE",
      author: "ray",
      severity: "high",
      description: "desc",
      tags: "t",
      cveId: "CVE-2026-1234",
    };
    expect(ScaffoldInputSchema.safeParse(good).success).toBe(true);
    expect(ScaffoldInputSchema.safeParse({ ...good, cveId: "CVE-26-1" }).success).toBe(false);
  });

  it("RemoteTargetSchema accepts http(s) URLs and rejects ftp", () => {
    expect(RemoteTargetSchema.safeParse("http://lab:8080").success).toBe(true);
    expect(RemoteTargetSchema.safeParse("https://example.com").success).toBe(true);
    expect(RemoteTargetSchema.safeParse("ftp://files").success).toBe(false);
    expect(remoteTarget("http://lab:8080")).toBe("http://lab:8080");
  });
});
