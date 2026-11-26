/**
 * Intent trace: reconstruct the per-file modification trajectory from a
 * session transcript. For every Edit/Write on a file, capture the nearest
 * preceding user prompt (the request driving the change) and the nearest
 * preceding thinking block (the plan behind it), producing a timeline of
 * "why this file changed, when, and in which order".
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface TraceEvent {
  timestamp: string;
  kind: "edit" | "write";
  file: string;
  tool: string;
  /** Nearest user text prompt at or before the edit. */
  userPrompt: string;
  /** Nearest assistant thinking text at or before the edit. */
  intent: string;
  turnIndex: number;
}

export interface FileTrace {
  file: string;
  edits: number;
  firstTimestamp: string;
  lastTimestamp: string;
  /** Chronological list of prompts that drove changes to this file. */
  prompts: string[];
  events: TraceEvent[];
}

interface RawEntry {
  type?: string;
  timestamp?: string;
  message?: { content?: unknown };
  uuid?: string;
}

function textOf(content: unknown): {
  text: string | undefined;
  thinking: string | undefined;
  toolUses: { name: string; input: Record<string, unknown> }[];
} {
  const result: {
    text: string | undefined;
    thinking: string | undefined;
    toolUses: { name: string; input: Record<string, unknown> }[];
  } = { text: undefined, thinking: undefined, toolUses: [] };
  if (typeof content === "string") {
    result.text = content;
    return result;
  }
  if (!Array.isArray(content)) return result;
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") result.text = block.text;
    if (block?.type === "thinking") result.thinking = block.thinking ?? block.text;
    if (block?.type === "tool_use") result.toolUses.push({ name: block.name, input: block.input ?? {} });
  }
  return result;
}

function compact(text: string | undefined, max = 220): string | undefined {
  if (text === undefined) return undefined;
  const cleaned = text.replaceAll(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Parse a transcript and emit the chronological intent trace. */
export function traceIntent(transcriptJsonl: string): TraceEvent[] {
  const lines = transcriptJsonl.split("\n").filter((line) => line.length > 0);
  const events: TraceEvent[] = [];
  let lastUserPrompt: string | undefined;
  let lastThinking: string | undefined;
  let turnIndex = 0;
  for (const line of lines) {
    let entry: RawEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "user") {
      const { text } = textOf(entry.message?.content);
      if (text !== undefined && text.length > 0 && !text.startsWith("<")) {
        lastUserPrompt = text;
        turnIndex += 1;
      }
      continue;
    }
    if (entry.type !== "assistant") continue;
    const { thinking, toolUses } = textOf(entry.message?.content);
    if (thinking !== undefined && thinking.length > 0) lastThinking = thinking;
    for (const use of toolUses) {
      if (!FILE_TOOLS.has(use.name)) continue;
      const file = use.input["file_path"] ?? use.input["notebook_path"];
      if (typeof file !== "string") continue;
      events.push({
        timestamp: entry.timestamp ?? "",
        kind: use.name === "Write" ? "write" : "edit",
        file: String(file).replaceAll("\\", "/"),
        tool: use.name,
        userPrompt: compact(lastUserPrompt) ?? "(no captured prompt)",
        intent: compact(lastThinking, 260) ?? "(no captured thinking)",
        turnIndex,
      });
    }
  }
  return events;
}

/** Group the trace by file — the modification trajectory per file. */
export function traceByFile(events: TraceEvent[]): FileTrace[] {
  const map = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const bucket = map.get(event.file);
    if (bucket === undefined) map.set(event.file, [event]);
    else bucket.push(event);
  }
  return [...map.values()].map((fileEvents) => {
    const first = fileEvents[0];
    const last = fileEvents[fileEvents.length - 1];
    if (first === undefined || last === undefined) throw new Error("unreachable: empty file bucket");
    return {
      file: first.file,
      edits: fileEvents.length,
      firstTimestamp: first.timestamp,
      lastTimestamp: last.timestamp,
      prompts: [...new Set(fileEvents.map((event) => event.userPrompt))],
      events: fileEvents,
    };
  });
}

/** Render a human-readable trajectory report grouped by file. */
export function renderTrace(traces: FileTrace[], opts: { limit?: number } = {}): string {
  const sorted = [...traces].sort((a, b) => b.edits - a.edits);
  const selected = opts.limit !== undefined ? sorted.slice(0, opts.limit) : sorted;
  const lines: string[] = [
    `intent trace — ${traces.length} file(s), ${traces.reduce((sum, t) => sum + t.edits, 0)} file-events`,
  ];
  for (const trace of selected) {
    lines.push("");
    lines.push(`## ${trace.file} (${trace.edits} change(s))`);
    lines.push(`span: ${trace.firstTimestamp} → ${trace.lastTimestamp}`);
    for (const prompt of trace.prompts.slice(0, 5)) {
      lines.push(`- prompt: ${prompt}`);
    }
    if (trace.prompts.length > 5) lines.push(`- …and ${trace.prompts.length - 5} more prompt(s)`);
    for (const event of trace.events.slice(0, 8)) {
      lines.push(`  [${event.timestamp.slice(11, 19)}] ${event.kind} (${event.tool}) turn ${event.turnIndex}`);
      lines.push(`    intent: ${event.intent}`);
    }
    if (trace.events.length > 8) lines.push(`  …and ${trace.events.length - 8} more event(s)`);
  }
  return lines.join("\n");
}

/** CLI: node tools/intent-trace.mjs <transcript.jsonl> [--limit N] [--file <path-filter>] */
export function main(argv: string[]): number {
  const input = argv.find((arg) => !arg.startsWith("--"));
  if (input === undefined) {
    console.error("usage: intent-trace <transcript.jsonl> [--limit N] [--file <substr>]");
    return 1;
  }
  const limitFlag = argv.indexOf("--limit");
  const limit = limitFlag !== -1 ? Number(argv[limitFlag + 1]) : undefined;
  const fileFlag = argv.indexOf("--file");
  const fileFilter = fileFlag !== -1 ? argv[fileFlag + 1] : undefined;
  const transcript = readFileSync(input, "utf8");
  const events = traceIntent(transcript);
  const traces = traceByFile(events).filter(
    (trace) => fileFilter === undefined || trace.file.includes(fileFilter.replaceAll("\\", "/")),
  );
  console.log(renderTrace(traces, limit !== undefined ? { limit } : {}));
  return 0;
}

// direct run: node --experimental-strip-types tools/intent-trace.ts <transcript.jsonl>
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
