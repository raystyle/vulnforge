import { z } from "zod";

/**
 * Env contracts (branded): the seven mirror dimensions, tool names, and
 * acceptance enums that env.ts previously kept as loose strings.
 */

/** Mirror dimension whitelist — the groupBy-style contract for mirror checks. */
export const MirrorKindSchema = z.enum(["npm", "bun", "pip", "uv", "cargo", "rustup", "fnm-node"]);
export type MirrorKind = z.infer<typeof MirrorKindSchema>;

/** Env-check item names (the tool-install whitelist). */
export const EnvToolNameSchema = z.enum([
  "pi",
  "winget",
  "node",
  "fnm",
  "bun",
  "uv",
  "go",
  "rust",
  "msvc",
  "zig",
  "java",
  "dotnet",
  "rust-script",
  "cargo-zigbuild",
  "nuclei",
  "yamllint",
  "templates repo",
  "mock target",
]);
export type EnvToolName = z.infer<typeof EnvToolNameSchema>;

/** A single env-check result row, decoded at the boundary. */
export const EnvCheckItemSchema = z.object({
  name: EnvToolNameSchema,
  ok: z.boolean(),
  detail: z.string(),
  fix: z.string().optional(),
  managedBy: z.string().optional(),
});
export type EnvCheckItem = z.infer<typeof EnvCheckItemSchema>;

export const EnvAcceptanceSchema = z.object({
  passed: z.boolean().brand<"EnvPassed">(),
  blocking: z.array(z.object({ name: EnvToolNameSchema, detail: z.string() })),
  mirrorGaps: z.array(z.object({ name: z.string(), detail: z.string() })),
});
export type EnvAcceptance = z.infer<typeof EnvAcceptanceSchema>;

/** Runtime-checked constructors for tool boundaries. */
export function envToolName(raw: string): EnvToolName {
  return EnvToolNameSchema.parse(raw) as EnvToolName; // brand-allow: constructor exit
}
