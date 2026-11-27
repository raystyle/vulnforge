import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { parseAgentResult } from "../../../src/templates/rs/contracts.ts";
import { assertRsExecuteEventHandled, RsExecuteMachine } from "../../../src/templates/rs/execute-machine.ts";
import { oobEnvFor, runRsScript } from "../../../src/templates/rs/executor.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const GOOD_SCRIPT = [
  "#!/usr/bin/env rust-script",
  "//! name: CVE-2026-1234",
  "//! description: demo exploit",
  "//! version: 1.0.0",
  "//! args: <name>",
  "//! keywords: demo",
  "//!",
  "//! ```cargo",
  "//! [dependencies]",
  "//! ```",
  'fn main() { println!("{}", r#"{"success":true,"action":"demo","data":{"hello":"vf"},"next_suggestion":"done"}"#); }',
].join("\n");

describe("rs execute-machine (event-driven)", () => {
  it("linting → LINT_OK → spawning → SPAWN_DONE → parsing → PARSE_DONE → done", () => {
    const actor = createActor(RsExecuteMachine, { input: { label: "CVE-2026-1234" } });
    actor.start();
    expect(actor.getSnapshot().value).toBe("linting");
    actor.send({ type: "LINT_OK", findings: [] });
    expect(actor.getSnapshot().value).toBe("spawning");
    actor.send({ type: "SPAWN_DONE", exitCode: 0, output: '{"success":true}' });
    expect(actor.getSnapshot().value).toBe("parsing");
    actor.send({ type: "PARSE_DONE", result: { success: true } });
    expect(actor.getSnapshot().value).toBe("done");
  });

  it("linting → LINT_FAIL → failed with lint findings", () => {
    const actor = createActor(RsExecuteMachine, { input: { label: "x" } });
    actor.start();
    actor.send({ type: "LINT_FAIL", findings: ["metadata: //! name header missing"] });
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("failed");
    expect(snapshot.context.lintFindings.join(" ")).toContain("name header missing");
  });

  it("spawning → SPAWN_DONE(nonzero) → failed with exit code + stderr detail", () => {
    const actor = createActor(RsExecuteMachine, { input: { label: "x" } });
    actor.start();
    actor.send({ type: "LINT_OK", findings: [] });
    actor.send({ type: "SPAWN_DONE", exitCode: 101, output: "error: unresolved import" });
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("failed");
    expect(snapshot.context.exitCode).toBe(101);
  });

  it("parsing → PARSE_FAIL → failed with envelope error", () => {
    const actor = createActor(RsExecuteMachine, { input: { label: "x" } });
    actor.start();
    actor.send({ type: "LINT_OK", findings: [] });
    actor.send({ type: "SPAWN_DONE", exitCode: 0, output: "garbage" });
    actor.send({ type: "PARSE_FAIL", message: "no JSON line" });
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("failed");
    expect(snapshot.context.reason).toContain("no JSON line");
  });

  it("guard rejects unknown event types", () => {
    expect(() => assertRsExecuteEventHandled({ type: "FUTURE" } as never)).toThrow(/unhandled rs-execute event/);
  });
});

describe("parseAgentResult", () => {
  it("extracts the last JSON line and validates the contract", () => {
    const result = parseAgentResult('noise\n{"success":true,"action":"probe","data":{"k":1}}');
    expect(result.success).toBe(true);
    expect(result.action).toBe("probe");
  });

  it("throws a descriptive envelope error for no JSON", () => {
    expect(() => parseAgentResult("just text")).toThrow(/AgentResult envelope missing/);
  });
});

describe("runRsScript (real rust-script runtime)", () => {
  it("runs the demo script end-to-end and returns the AgentResult envelope", { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-rsrun-"));
    scratch.push(dir);
    const scriptsDir = join(dir, "rust-scripts");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, "CVE-2026-1234.rs"), GOOD_SCRIPT);
    const outcome = await runRsScript({
      scriptPath: join(scriptsDir, "CVE-2026-1234.rs"),
      args: [],
      timeoutSecs: 90,
    });
    expect(outcome.phase).toBe("done");
    expect(outcome.result?.success).toBe(true);
    expect(outcome.result?.action).toBe("demo");
  });
});

describe("oobEnvFor (workspace oob section to VF_OOB_* passthrough)", () => {
  it("always sets the provider; only non-empty facts ride along", () => {
    expect(oobEnvFor({ provider: "interactsh", server: "", pollHost: "", domain: "", pollUrl: "" })).toEqual({
      VF_OOB_PROVIDER: "interactsh",
    });
  });

  it("maps every non-empty fact to its env var", () => {
    expect(
      oobEnvFor({
        provider: "dnslog",
        server: "oast.fun",
        pollHost: "polling.oastify.com",
        domain: "dns.lab",
        pollUrl: "http://dns.lab/api?domain={host}",
      }),
    ).toEqual({
      VF_OOB_PROVIDER: "dnslog",
      VF_OOB_SERVER: "oast.fun",
      VF_OOB_POLL_HOST: "polling.oastify.com",
      VF_OOB_DOMAIN: "dns.lab",
      VF_OOB_POLL_URL: "http://dns.lab/api?domain={host}",
    });
  });
});
