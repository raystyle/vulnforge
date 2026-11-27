import { setup } from "xstate";

/**
 * The exploit_rs_execute domain state machine (event-driven, mandatory):
 * linting (//! header advisory) → spawning (rust-script) → parsing
 * (AgentResult single-line contract) → done | failed. Every transition is
 * an event; failures carry their findings/context for the envelope.
 */
export interface RsExecuteContext {
  label: string;
  lintFindings: string[];
  exitCode?: number | undefined;
  output?: string | undefined;
  reason?: string | undefined;
  result?: unknown | undefined;
}

export type RsExecuteEvent =
  | { type: "LINT_OK"; findings: string[] }
  | { type: "LINT_FAIL"; findings: string[] }
  | { type: "SPAWN_DONE"; exitCode: number; output: string }
  | { type: "PARSE_DONE"; result: unknown }
  | { type: "PARSE_FAIL"; message: string };

export const RsExecuteMachine = setup({
  types: {
    context: {} as RsExecuteContext,
    events: {} as RsExecuteEvent,
    input: {} as { label: string },
  },
}).createMachine({
  id: "rs-execute",
  initial: "linting",
  context: ({ input }) => ({ label: input.label, lintFindings: [] }),
  states: {
    linting: {
      on: {
        LINT_OK: {
          target: "spawning",
          actions: ({ context, event }) => {
            context.lintFindings = event.findings;
          },
        },
        LINT_FAIL: {
          target: "failed",
          actions: ({ context, event }) => {
            context.lintFindings = event.findings;
            context.reason = "lint findings blocked the run";
          },
        },
      },
    },
    spawning: {
      on: {
        SPAWN_DONE: [
          {
            guard: ({ event }) => event.exitCode === 0,
            target: "parsing",
            actions: ({ context, event }) => {
              context.output = event.output;
              context.exitCode = event.exitCode;
            },
          },
          {
            target: "failed",
            actions: ({ context, event }) => {
              context.exitCode = event.exitCode;
              context.output = event.output;
              context.reason = `rust-script exited ${event.exitCode}`;
            },
          },
        ],
      },
    },
    parsing: {
      on: {
        PARSE_DONE: {
          target: "done",
          actions: ({ context, event }) => {
            context.result = event.result;
          },
        },
        PARSE_FAIL: {
          target: "failed",
          actions: ({ context, event }) => {
            context.reason = event.message;
          },
        },
      },
    },
    done: { type: "final" },
    failed: { type: "final" },
  },
});

/** Compile-time exhaustiveness: every rs-execute event must be mapped. */
export function assertRsExecuteEventHandled(event: { type: string }): never {
  switch (event.type) {
    case "LINT_OK":
    case "LINT_FAIL":
    case "SPAWN_DONE":
    case "PARSE_DONE":
    case "PARSE_FAIL":
      throw new Error(`unreachable: ${event.type} is handled by the rs-execute machine`);
    default: {
      const unhandled: never = event as never;
      throw new Error(`unhandled rs-execute event: ${JSON.stringify(unhandled)}`);
    }
  }
}
