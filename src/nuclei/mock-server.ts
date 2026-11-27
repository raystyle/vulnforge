/**
 * Spawned mock-server child: a standalone 127.0.0.1 HTTP target controlled by
 * a parent process. Used when the mock target must live outside the caller's
 * lifetime (long scans, parallel tools, Pi sessions closing mid-scan).
 *
 * Protocol (lines on stdio):
 *   parent → child (one JSON per line):  { op: "start", routes } | { op: "close" }
 *   child → parent (one JSON per line):  { event: "ready", url, port } | { event: "closed" }
 *
 * Child exits when stdin closes (parent died) or after a "close" op —
 * callback-driven lifecycle on both ends, no orphaned listeners.
 */
import { createInterface } from "node:readline";
import { type MockRoute, type MockTarget, startMockTarget } from "./mock.ts";

let active: MockTarget | undefined;
let closing = false;

function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handleStart(routes: MockRoute[]): Promise<void> {
  if (active !== undefined) {
    send({ event: "ready", url: active.url, port: active.port, reused: true });
    return;
  }
  active = await startMockTarget(routes);
  send({ event: "ready", url: active.url, port: active.port });
}

async function handleClose(): Promise<void> {
  if (closing) return;
  closing = true;
  if (active !== undefined) {
    await active.close();
    active = undefined;
  }
  send({ event: "closed" });
  process.exit(0);
}

process.stdin.setEncoding("utf8");
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let message: { op?: string; routes?: MockRoute[] };
  try {
    message = JSON.parse(trimmed);
  } catch {
    send({ event: "error", message: "unparsable control line" });
    return;
  }
  if (message.op === "start") {
    handleStart(message.routes ?? []).catch((error: unknown) => {
      send({ event: "error", message: (error as Error).message });
    });
  } else if (message.op === "close") {
    handleClose().catch(() => process.exit(1));
  }
});
lines.on("close", () => {
  // Parent died — tear down so the port never leaks.
  if (!closing) {
    closing = true;
    if (active !== undefined) {
      void active.close().then(() => process.exit(0));
    } else {
      process.exit(0);
    }
  }
});
