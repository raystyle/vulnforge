import { z } from "zod";

/**
 * Scaffold + run/safety contracts (branded). Previously loose interfaces —
 * now zod schemas with branded domain values, decoded at tool boundaries.
 */

/** Named template ids (project discipline: lowercase kebab, ≤5 segments). */
export const ScaffoldIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "scaffold id must be lowercase kebab-case")
  .brand<"ScaffoldId">();
export type ScaffoldId = z.infer<typeof ScaffoldIdSchema>;

export const VulnTypeSchema = z.enum(["detect", "rce", "sqli", "lfi", "panel"]);
export type VulnType = z.infer<typeof VulnTypeSchema>;

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type ScaffoldSeverity = z.infer<typeof SeveritySchema>;

export const ScaffoldInputSchema = z.object({
  vulnType: VulnTypeSchema,
  name: z.string().min(1),
  author: z.string().min(1),
  severity: SeveritySchema,
  description: z.string().min(1),
  tags: z.string().min(1),
  cveId: z
    .string()
    .regex(/^CVE-\d{4}-\d{4,}$/, "cveId must look like CVE-2026-1234")
    .optional(),
});

export const EngineModeSchema = z.enum(["real", "mock"]);
export type EngineMode = z.infer<typeof EngineModeSchema>;

/** Remote-target URL contract: http/https only, has a host. */
export const RemoteTargetSchema = z
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), "remote target must be http(s)")
  .brand<"RemoteTarget">();
export type RemoteTarget = z.infer<typeof RemoteTargetSchema>;

/** Runtime-checked constructors for tool boundaries. */
export function scaffoldId(raw: string): ScaffoldId {
  return ScaffoldIdSchema.parse(raw) as ScaffoldId; // brand-allow: constructor exit
}

export function remoteTarget(raw: string): RemoteTarget {
  return RemoteTargetSchema.parse(raw) as RemoteTarget; // brand-allow: constructor exit
}
