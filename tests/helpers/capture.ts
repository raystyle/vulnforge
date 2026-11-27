import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../../src/index.ts";

export interface CapturedTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
}

export interface CapturedCommand {
  name: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

export interface SentMessage {
  text: string;
  options: Record<string, unknown>;
}

type SettledHandler = () => void;

export class CapturePi {
  readonly tools: CapturedTool[] = [];
  readonly commands: CapturedCommand[] = [];
  readonly onCalls: Array<{ event: string; handler: SettledHandler }> = [];
  readonly sentMessages: SentMessage[] = [];

  registerTool(tool: CapturedTool): void {
    this.tools.push(tool);
  }

  registerCommand(name: string, def: { handler: CapturedCommand["handler"] }): void {
    this.commands.push({ name, handler: def.handler });
  }

  on(event: string, handler: SettledHandler): void {
    this.onCalls.push({ event, handler });
  }

  sendUserMessage(text: string, options: Record<string, unknown>): void {
    this.sentMessages.push({ text, options });
  }

  emitSettled(): void {
    for (const call of this.onCalls) {
      if (call.event === "agent_settled") call.handler();
    }
  }
}

export default function loadExtension(): {
  tools: CapturedTool[];
  commands: CapturedCommand[];
  onCalls: Array<{ event: string; handler: SettledHandler }>;
  sentMessages: SentMessage[];
  emitSettled: () => void;
} {
  const pi = new CapturePi();
  extension(pi as unknown as ExtensionAPI);
  return {
    tools: pi.tools,
    commands: pi.commands,
    onCalls: pi.onCalls,
    sentMessages: pi.sentMessages,
    emitSettled: () => pi.emitSettled(),
  };
}
