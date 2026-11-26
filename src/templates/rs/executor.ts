import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createActor } from "xstate";
import type { AgentResult } from "./contracts.ts";
import { parseAgentResult } from "./contracts.ts";
import { type RsExecuteContext, RsExecuteMachine } from "./execute-machine.ts";
import { parseRsScript } from "./script-parse.ts";

/**
 * The executor: spawn rust-script, stream-collect stdout/stderr (the
 * Windows execFile-deadlock lesson — spawn + streams, never execFile on Go
 * or Rust binaries), enforce the timeout with a process kill backstop, and
 * drive the whole flow through the RsExecuteMachine (lint → spawn → parse).
 */

export interface RsRunOptions {
  scriptPath: string;
  args: string[];
  /** Deadline in seconds; the child gets SIGKILL after it. */
  timeoutSecs?: number;
  /** Binary override (config tools.rustScriptPath); empty = PATH probe. */
  rustScriptPath?: string;
  /** Env passthrough (e.g. PI_TIMEOUT_SECS for in-process timeouts). */
  env?: Record<string, string>;
}

export interface RsRunOutcome {
  phase: "done" | "failed";
  result?: AgentResult | undefined;
  context: RsExecuteContext;
  wallMs: number;
}

function spawnCollect(
  command: string,
  args: string[],
  options: { timeoutMs: number; env?: Record<string, string> },
): Promise<{ code: number; output: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, output: `${stdout}${error.message}`, stderr, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, output: stdout, stderr, timedOut });
    });
  });
}

/** Resolve the rust-script binary: explicit path wins, then PATH probe. */
async function resolveRustScript(explicit?: string): Promise<string> {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const probe = await spawnCollect("rust-script", ["--version"], { timeoutMs: 15_000 });
  if (probe.code === 0) return "rust-script";
  throw new Error("rust-script not found on PATH (install: cargo install rust-script) or set tools.rustScriptPath");
}

export async function runRsScript(options: RsRunOptions): Promise<RsRunOutcome> {
  const started = Date.now();
  const timeoutMs = (options.timeoutSecs ?? 300) * 1000;
  const actor = createActor(RsExecuteMachine, { input: { label: options.scriptPath } });
  actor.start();

  // Phase 1: advisory lint over the //! header (run proceeds on warnings,
  // hard-fails only when the script has no vulnerability-identifier name).
  const source = readFileSync(options.scriptPath, "utf8");
  const parsed = parseRsScript(source);
  const findings = parsed.lintIssues.map((issue) => `${issue.rule}: ${issue.message}`);
  if (parsed.meta.name.length === 0) {
    actor.send({ type: "LINT_FAIL", findings });
    return { phase: "failed", context: actor.getSnapshot().context, wallMs: Date.now() - started };
  }
  actor.send({ type: "LINT_OK", findings });

  // Phase 2: spawn rust-script (stream collection, timeout kill backstop).
  const binary = await resolveRustScript(options.rustScriptPath);
  const env: Record<string, string> = {
    VF_TIMEOUT_SECS: String(options.timeoutSecs ?? 300),
    // The crate path the generated cargo block referenced may differ per
    // machine — the executor re-resolves and lets rust-script's cache see
    // a stable identity through the same absolute path.
    VF_RUST_LIB_PATH: fileURLToPath(new URL("../../vf-rust-lib", import.meta.url)).replaceAll("\\", "/"),
    ...(options.env ?? {}),
  };
  const run = await spawnCollect(binary, [options.scriptPath, ...options.args], { timeoutMs, env });
  if (run.timedOut) {
    actor.send({
      type: "SPAWN_DONE",
      exitCode: 124,
      output: `${run.output}\nTIMEOUT after ${options.timeoutSecs ?? 300}s`,
    });
    return { phase: "failed", context: actor.getSnapshot().context, wallMs: Date.now() - started };
  }
  if (run.code !== 0) {
    actor.send({ type: "SPAWN_DONE", exitCode: run.code, output: run.stderr || run.output });
    return { phase: "failed", context: actor.getSnapshot().context, wallMs: Date.now() - started };
  }
  actor.send({ type: "SPAWN_DONE", exitCode: run.code, output: run.output });

  // Phase 3: the AgentResult single-line contract.
  try {
    const result = parseAgentResult(run.output);
    actor.send({ type: "PARSE_DONE", result });
    return { phase: "done", result, context: actor.getSnapshot().context, wallMs: Date.now() - started };
  } catch (error) {
    actor.send({ type: "PARSE_FAIL", message: (error as Error).message });
    return { phase: "failed", context: actor.getSnapshot().context, wallMs: Date.now() - started };
  }
}
