/**
 * Parent-side controller for the spawned mock-server child. Callback-driven:
 * start() resolves after the child's ready handshake (never a fixed sleep);
 * withTarget() runs a callback against the live URL and always closes the
 * child afterwards — result callback, then shutdown, no leaked processes.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { MockRoute } from "./mock.ts";

export interface SpawnedMockTarget {
  url: string;
  port: number;
  close(): Promise<void>;
}

const READY_TIMEOUT_MS = 15_000;

interface ControlEvent {
  event?: string;
  url?: string;
  port?: number;
  message?: string;
}

export function spawnMockServer(routes: MockRoute[]): Promise<SpawnedMockTarget> {
  return new Promise((resolve, reject) => {
    const serverEntry = join(import.meta.dirname, "mock-server.ts");
    // execArg mirrors this process's TS loader so the .ts child runs directly.
    const child: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", serverEntry], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (child.stdin === null || child.stdout === null) {
      reject(new Error("mock-server child spawned without stdio"));
      child.kill();
      return;
    }
    let settled = false;
    let url = "";
    let port = 0;
    let closeResolve: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("mock-server ready handshake timed out"));
    }, READY_TIMEOUT_MS);

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line: string) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      let event: ControlEvent;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (event.event === "ready" && !settled) {
        settled = true;
        clearTimeout(timer);
        url = typeof event.url === "string" ? event.url : "";
        port = typeof event.port === "number" ? event.port : 0;
        resolve({
          url,
          port,
          close: () =>
            new Promise<void>((resolveClose) => {
              closeResolve = resolveClose;
              child.stdin?.write(`${JSON.stringify({ op: "close" })}\n`);
            }),
        });
      } else if (event.event === "closed") {
        clearTimeout(timer);
        closeResolve?.();
        closeResolve = undefined;
      } else if (event.event === "error" && !settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`mock-server error: ${event.message ?? "unknown"}`));
      }
    });
    child.on("exit", () => {
      clearTimeout(timer);
      closeResolve?.();
      closeResolve = undefined;
      if (!settled) {
        settled = true;
        reject(new Error("mock-server exited before ready"));
      }
    });

    child.stdin.write(`${JSON.stringify({ op: "start", routes })}\n`);
  });
}

/**
 * Start the spawned mock, run `body(url)`, then always close the child and
 * return the body's result. The scan callback is the driver; teardown is
 * guaranteed on success, failure, and throw.
 */
export async function withSpawnedMock<T>(routes: MockRoute[], body: (url: string) => Promise<T>): Promise<T> {
  const target = await spawnMockServer(routes);
  try {
    return await body(target.url);
  } finally {
    await target.close();
  }
}
