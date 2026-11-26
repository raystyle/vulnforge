import { describe, expect, it } from "vitest";
import { renderTrace, traceByFile, traceIntent } from "./intent-trace.ts";

function entry(type: string, content: unknown, timestamp: string) {
  return JSON.stringify({ type, timestamp, message: { content }, uuid: crypto.randomUUID() });
}

const transcript = [
  entry("user", "给工具加上品牌契约", "2026-11-26T01:00:00.000Z"),
  entry("assistant", [{ type: "thinking", thinking: "Plan: add zod brands in meta.ts" }], "2026-11-26T01:00:05.000Z"),
  entry(
    "assistant",
    [{ type: "tool_use", name: "Edit", input: { file_path: "D:\\repos\\vulnforge\\src\\templates\\meta.ts" } }],
    "2026-11-26T01:00:10.000Z",
  ),
  entry("user", [{ type: "tool_result", content: "ok" }], "2026-11-26T01:00:11.000Z"),
  entry("user", "状态机也要无豁免覆盖", "2026-11-26T02:00:00.000Z"),
  entry("assistant", [{ type: "thinking", thinking: "Wrap tool bodies with machine" }], "2026-11-26T02:00:05.000Z"),
  entry(
    "assistant",
    [
      {
        type: "tool_use",
        name: "Write",
        input: { file_path: "D:\\repos\\vulnforge\\src\\templates\\tool-machine.ts" },
      },
    ],
    "2026-11-26T02:00:10.000Z",
  ),
  entry("assistant", [{ type: "text", text: "done" }], "2026-11-26T02:00:12.000Z"),
  entry(
    "assistant",
    [{ type: "tool_use", name: "Edit", input: { file_path: "D:\\repos\\vulnforge\\src\\templates\\meta.ts" } }],
    "2026-11-26T03:00:00.000Z",
  ),
  // tool_result with embedded XML should not count as a user prompt
  entry(
    "user",
    [{ type: "tool_result", content: "<system-reminder>noise</system-reminder>" }],
    "2026-11-26T03:00:01.000Z",
  ),
].join("\n");

describe("intent trace", () => {
  it("extracts file events with nearest user prompt and thinking intent", () => {
    const events = traceIntent(transcript);
    expect(events).toHaveLength(3);
    const metaFirst = events.find((event) => event.file.endsWith("meta.ts") && event.kind === "edit");
    expect(metaFirst?.userPrompt).toContain("品牌契约");
    expect(metaFirst?.intent).toContain("zod brands");
    const machine = events.find((event) => event.file.endsWith("tool-machine.ts"));
    expect(machine?.kind).toBe("write");
    expect(machine?.userPrompt).toContain("状态机");
  });

  it("groups by file with counts, span, and unique prompts", () => {
    const traces = traceByFile(traceIntent(transcript));
    const meta = traces.find((trace) => trace.file.endsWith("meta.ts"));
    expect(meta?.edits).toBe(2);
    expect(meta?.prompts).toHaveLength(2);
    expect(meta?.firstTimestamp.startsWith("2026-11-26T01")).toBe(true);
  });

  it("tool_result and XML-ish payloads are not user prompts", () => {
    const events = traceIntent(transcript);
    const last = events[events.length - 1];
    // the trailing edit has no new user prompt — carries the last real one
    expect(last?.userPrompt).toContain("状态机");
  });

  it("renders a report with file headers and event lines", () => {
    const report = renderTrace(traceByFile(traceIntent(transcript)));
    expect(report).toContain("intent trace — 2 file(s), 3 file-events");
    expect(report).toContain("meta.ts (2 change(s))");
    expect(report).toContain("intent:");
  });

  it("forward-slash-normalizes windows paths for grouping", () => {
    const traces = traceByFile(traceIntent(transcript));
    expect(traces.every((trace) => !trace.file.includes("\\"))).toBe(true);
  });
});
