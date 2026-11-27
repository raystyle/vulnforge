import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { parseRsScript } from "./script-parse.ts";

/**
 * exploit rs contract chain: a structured patch over the `//!` metadata
 * header or a whole-body replacement. The edit applies only when the
 * resulting script still passes the header contract — invalid edits are
 * rejected and nothing is written (the nuclei_edit pattern).
 */
const METADATA_KEYS = ["description", "description_en", "version", "args", "keywords", "codes"] as const;
type MetadataKey = (typeof METADATA_KEYS)[number];

export const RsPatchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("metadata"),
    patch: z.object({
      description: z.string().min(1).optional(),
      description_en: z.string().min(1).optional(),
      version: z
        .string()
        .regex(/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/, "semver")
        .optional(),
      args: z.string().min(1).optional(),
      keywords: z.string().min(1).optional(),
      codes: z.string().min(1).optional(),
    }),
  }),
  z.object({
    kind: z.literal("body"),
    content: z.string().min(1),
  }),
]);
export type RsPatch = z.infer<typeof RsPatchSchema>;

export class RsEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RsEditError";
  }
}

export function validateRsPatch(raw: unknown): RsPatch {
  const parsed = RsPatchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RsEditError(`invalid rs patch: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  const patch = parsed.data;
  if (patch.kind === "metadata" && Object.keys(patch.patch).length === 0) {
    throw new RsEditError("metadata patch is empty — provide at least one field");
  }
  return patch;
}

const KEY_TO_HEADER: Record<MetadataKey, string> = {
  description: "description",
  description_en: "description_en",
  version: "version",
  args: "args",
  keywords: "keywords",
  codes: "codes",
};

export interface RsEditOutcome {
  applied: string[];
  lintIssues: string[];
}

function replaceHeaderLine(source: string, key: string, value: string): string {
  const lines = source.split(/\r?\n/);
  const pattern = new RegExp(`^//!\\s*${key}:`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i] ?? "")) {
      lines[i] = `//! ${key}: ${value}`;
      return lines.join("\n");
    }
  }
  // header key absent — insert after the name line (or at the top after shebang)
  const insertAt = lines.findIndex((line) => /^\/\/!\s*name:/.test(line)) + 1 || 1;
  lines.splice(insertAt, 0, `//! ${key}: ${value}`);
  return lines.join("\n");
}

export function applyRsEdit(filePath: string, patch: RsPatch): RsEditOutcome {
  const source = readFileSync(filePath, "utf8");
  if (patch.kind === "body") {
    const parsed = parseRsScript(patch.content);
    if (parsed.meta.name.length === 0) {
      throw new RsEditError(
        "content has no //! name header — refusing to write (the name is the vulnerability identifier)",
      );
    }
    writeFileSync(filePath, patch.content);
    return { applied: ["body"], lintIssues: parsed.lintIssues.map((issue) => `${issue.rule}: ${issue.message}`) };
  }
  let updated = source;
  const applied: string[] = [];
  for (const [key, value] of Object.entries(patch.patch)) {
    const headerKey = KEY_TO_HEADER[key as MetadataKey];
    if (headerKey === undefined) throw new RsEditError(`unknown metadata key: ${key}`);
    updated = replaceHeaderLine(updated, headerKey, String(value));
    applied.push(key);
  }
  const parsed = parseRsScript(updated);
  if (parsed.meta.name.length === 0) {
    throw new RsEditError("edits lost the //! name header — refusing to write");
  }
  writeFileSync(filePath, updated);
  return { applied, lintIssues: parsed.lintIssues.map((issue) => `${issue.rule}: ${issue.message}`) };
}
