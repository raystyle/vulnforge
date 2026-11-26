import { z } from "zod";

/**
 * rs-domain branded contracts. The materialized library is one exploit rs
 * per vulnerability: the script name IS the vulnerability identifier
 * (CVE-id or a stable alias like "thinkphp-5-rce") — no paths, no spaces.
 */
export const ScriptNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "script name must be a vulnerability identifier (kebab/CVE form)")
  .brand<"ScriptName">();
export type ScriptName = z.infer<typeof ScriptNameSchema>;

export function scriptName(raw: string): ScriptName {
  return ScriptNameSchema.parse(raw) as ScriptName; // brand-allow: constructor exit
}

/** Where a script comes from; earlier sources win on name conflicts. */
export const RsSourceSchema = z.enum(["project", "global", "bundled"]);
export type RsSource = z.infer<typeof RsSourceSchema>;

/** cargo zigbuild export target (rust triple). */
export const RsTripleSchema = z
  .string()
  .regex(/^[a-z0-9_-]+-[a-z0-9_-]+-[a-z0-9_-]+$/, "expected a rust triple")
  .brand<"RsTriple">();
export type RsTriple = z.infer<typeof RsTripleSchema>;

export const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/;

export const RsMetaSchema = z.object({
  name: ScriptNameSchema,
  description: z.string().min(1),
  descriptionEn: z.string(),
  version: z.string().regex(SEMVER_RE, "version must be semver"),
  keywords: z.array(z.string()),
  args: z.string(),
  /** Declared error codes, "E_CODE=meaning; ..." form. */
  codes: z.string(),
  file: z.string().min(1),
  source: RsSourceSchema,
  faces: z.array(z.string()),
  dangerous: z.boolean(),
  sha256: z.string().length(64),
});
export type RsMeta = z.infer<typeof RsMetaSchema>;

/**
 * Script-level result envelope (distinct from the tool-level vf-error):
 * exactly one line of stdout, success OR failure both as data.
 */
export const AgentResultSchema = z
  .object({
    success: z.boolean(),
    action: z.string().optional(),
    data: z.unknown().optional(),
    error: z.string().optional(),
    /** Next-step suggestion: in-domain attack-chain pointer (what to do next). NEVER tool usage — that is vf-error hint territory. */
    next_suggestion: z.string().optional(),
  })
  .refine((value) => value.success || value.error !== undefined, {
    message: "failed results must carry an error code",
  })
  .refine((value) => !value.success || value.action !== undefined, {
    message: "successful results must name their action",
  });
export type AgentResult = z.infer<typeof AgentResultSchema>;

/** Parse the single expected AgentResult JSON line from script output. */
export function parseAgentResult(output: string): AgentResult {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const jsonLines = lines.filter((line) => line.startsWith("{"));
  if (jsonLines.length === 0) {
    throw new Error(
      'AgentResult envelope missing: script printed no JSON line (expected {"success":..,"action"/"error":..,"next_suggestion":..})',
    );
  }
  const parsed = AgentResultSchema.safeParse(JSON.parse(jsonLines[jsonLines.length - 1] ?? ""));
  if (!parsed.success) {
    throw new Error(`AgentResult envelope invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}
