/**
 * Parent-side controller for the spawned mock-server child. Callback-driven:
 * start() resolves after the child's ready handshake (never a fixed sleep);
 * withTarget() runs a callback against the live URL and always closes the
 * child afterwards — result callback, then shutdown, no leaked processes.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { type MockRoute, MockRouteSchema } from "./mock.ts";

/** Lifecycle state of the spawned mock child (exhaustive literal union). */
export type MockTargetPhase = "spawning" | "ready" | "closing" | "closed" | "failed";

/** Control-channel contract (child→parent stdio JSON lines). */
export const ControlEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("ready"),
    url: z.url(),
    port: z.number().int().positive().brand<"MockPort">(),
  }),
  z.object({ event: z.literal("closed") }),
  z.object({ event: z.literal("error"), message: z.string() }),
]);
export type ControlEvent = z.infer<typeof ControlEventSchema>;

/** Parent→child ops (start/close), validated before writing to stdin. */
export const ControlOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("start"),
    routes: z.array(MockRouteSchema),
  }),
  z.object({ op: z.literal("close") }),
]);
export type ControlOp = z.infer<typeof ControlOpSchema>;

export interface SpawnedMockTarget {
  url: string;
  port: number;
  phase: MockTargetPhase;
  close(): Promise<void>;
}

const READY_TIMEOUT_MS = 15_000;

export function spawnMockServer(routes: MockRoute[]): Promise<SpawnedMockTarget> {
  // Validate the route payload at the boundary before it crosses the process.
  const startOp: ControlOp = ControlOpSchema.parse({ op: "start", routes });
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
        event = ControlEventSchema.parse(JSON.parse(trimmed));
      } catch {
        return;
      }
      if (event.event === "ready" && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          url: event.url,
          port: event.port,
          phase: "ready",
          close: () =>
            new Promise<void>((resolveClose) => {
              closeResolve = resolveClose;
              child.stdin?.write(`${JSON.stringify({ op: "close" } satisfies ControlOp)}\n`);
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

    child.stdin.write(`${JSON.stringify(startOp)}\n`);
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
