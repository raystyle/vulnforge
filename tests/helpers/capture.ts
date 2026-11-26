import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../../src/index.ts";

export interface CapturedTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    id: string,
    params: unknown,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<unknown>;
}

export interface CapturedCommand {
  name: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

export class CapturePi {
  readonly tools: CapturedTool[] = [];
  readonly commands: CapturedCommand[] = [];

  registerTool(tool: CapturedTool): void {
    this.tools.push(tool);
  }

  registerCommand(name: string, def: { handler: CapturedCommand["handler"] }): void {
    this.commands.push({ name, handler: def.handler });
  }
}

export default function loadExtension(): { tools: CapturedTool[]; commands: CapturedCommand[] } {
  const pi = new CapturePi();
  extension(pi as unknown as ExtensionAPI);
  return { tools: pi.tools, commands: pi.commands };
}
