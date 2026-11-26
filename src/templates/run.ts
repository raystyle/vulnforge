import { spawn } from "node:child_process";

export interface NucleiHit {
  templateId: string;
  infoName: string;
  matchedAt: string;
  type: string;
  raw: Record<string, unknown>;
}

export interface RunResult {
  exitCode: number;
  hits: NucleiHit[];
  rawOutput: string;
  stderr: string;
}

export interface RunOptions {
  nucleiPath?: string;
  timeoutMs?: number;
  /** Extra args injected before the standard scan args (e.g. mock CLI wrappers). */
  nucleiArgs?: string[];
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 16 * 1024 * 1024;

function findNuclei(explicit: string | undefined): string {
  return explicit ?? "nuclei";
}

interface SpawnCollectResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * spawn + manual collection. execFile on Windows can deadlock with Go binaries
 * when the child closes its stdio quickly (observed: nuclei exits in ~200ms,
 * execFile never fires its callback). Collection here is stream-driven.
 */
function spawnCollect(command: string, args: string[], timeoutMs: number): Promise<SpawnCollectResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout: stdout.slice(0, MAX_OUTPUT_CHARS), stderr: stderr.slice(0, 8000), timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      setTimeout(() => child.kill("SIGKILL"), 2000);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += `\nspawn error: ${error.message}`;
      finish(1);
    });
    child.on("close", (code) => {
      finish(code ?? (timedOut ? 124 : 0));
    });
  });
}

function parseJsonlHits(rawOutput: string): NucleiHit[] {
  const hits: NucleiHit[] = [];
  for (const line of rawOutput.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      const id = typeof record["template-id"] === "string" ? record["template-id"] : "";
      if (id.length === 0) continue;
      const info = record.info as { name?: unknown } | undefined;
      hits.push({
        templateId: id,
        infoName: typeof info?.name === "string" ? info.name : "",
        matchedAt: typeof record["matched-at"] === "string" ? record["matched-at"] : "",
        type: typeof record.type === "string" ? record.type : "",
        raw: record,
      });
    } catch {
      // Non-JSON line (banner, warning) — skip.
    }
  }
  return hits;
}

export function runTemplateAgainst(tplPath: string, url: string, options: RunOptions = {}): Promise<RunResult> {
  const nuclei = findNuclei(options.nucleiPath);
  const args = [...(options.nucleiArgs ?? []), "-t", tplPath, "-u", url, "-jsonl", "-no-color", "-silent", "-duc"];
  return spawnCollect(nuclei, args, options.timeoutMs ?? DEFAULT_TIMEOUT_MS).then((result) => ({
    exitCode: result.exitCode,
    hits: parseJsonlHits(result.stdout),
    rawOutput: result.stdout,
    stderr: result.stderr,
  }));
}

export interface BenignVerdict {
  weakMatcher: boolean;
  hits: NucleiHit[];
}

/**
 * False-positive counter-check (upstream honeypot judgement): the template must
 * produce ZERO hits against a benign target. Any hit means a weak matcher.
 */
export async function verifyNoFalsePositive(
  tplPath: string,
  benignUrl: string,
  options: RunOptions = {},
): Promise<BenignVerdict> {
  const result = await runTemplateAgainst(tplPath, benignUrl, options);
  return { weakMatcher: result.hits.length > 0, hits: result.hits };
}

export interface NucleiAvailability {
  available: boolean;
  path?: string | undefined;
  version?: string | undefined;
  reason?: string | undefined;
}

export async function checkNuclei(options: RunOptions = {}): Promise<NucleiAvailability> {
  const nuclei = findNuclei(options.nucleiPath);
  const versionArgs = [...(options.nucleiArgs ?? []), "-version"];
  const result = await spawnCollect(nuclei, versionArgs, 20_000);
  if (result.exitCode !== 0 && result.stdout.length === 0) {
    return {
      available: false,
      reason: `nuclei not runnable (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}: ${result.stderr.slice(0, 200)}). Install: go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`,
    };
  }
  const output = `${result.stdout}${result.stderr}`;
  const match = /Nuclei Engine Version: (\S+)/.exec(output);
  return { available: true, path: nuclei, version: match?.[1] };
}
