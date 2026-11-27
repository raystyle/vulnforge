import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { lintDocument, type TemplateInfo } from "./lint.ts";
import { lintYaml } from "./yamllint.ts";

export const MatcherPatchSchema = z.object({
  index: z.number().int().min(0),
  words: z.array(z.string()).optional(),
  regex: z.array(z.string()).optional(),
  part: z.string().optional(),
  condition: z.string().optional(),
  status: z.array(z.number().int()).optional(),
});

export const InfoPatchSchema = z.object({
  name: z.string().min(1).optional(),
  author: z.string().optional(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]).optional(),
  description: z.string().optional(),
  tags: z.string().optional(),
  reference: z.array(z.string()).optional(),
  classification: z
    .object({
      "cve-id": z.string().optional(),
      "cwe-id": z.string().optional(),
    })
    .optional(),
});

export const EditPatchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("info"), patch: InfoPatchSchema }),
  z.object({
    kind: z.literal("matcher"),
    requestIndex: z.number().int().min(0).default(0),
    matcherIndex: z.number().int().min(0),
    patch: z.object({
      words: z.array(z.string()).optional(),
      regex: z.array(z.string()).optional(),
      part: z.string().optional(),
      condition: z.string().optional(),
      status: z.array(z.number().int()).optional(),
    }),
  }),
  z.object({
    kind: z.literal("path"),
    requestIndex: z.number().int().min(0).default(0),
    paths: z.array(z.string()).min(1),
  }),
]);

export type EditPatch = z.infer<typeof EditPatchSchema>;
export type InfoPatch = z.infer<typeof InfoPatchSchema>;
export type MatcherPatch = z.infer<typeof MatcherPatchSchema>;

/** Pi tool boundary: validate an untyped patch payload against EditPatchSchema. */
export function validateEditPatch(raw: unknown): EditPatch {
  return EditPatchSchema.parse(raw);
}

export interface EditOutcome {
  updatedYaml: string;
  applied: string[];
  lintFindings: Array<{ level: string; rule: string; message: string }>;
  lintErrors: number;
}

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function applyInfoPatch(doc: Record<string, unknown>, patch: InfoPatch, applied: string[]): void {
  const info = asRecord(doc.info);
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  for (const [key, value] of entries) {
    info[key] = value as unknown;
    applied.push(`info.${key}`);
  }
  doc.info = info;
}

function httpRequests(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const requests = doc.http;
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new EditError("template has no http request block to edit");
  }
  return requests.map((request) => asRecord(request));
}

function applyMatcherPatch(
  doc: Record<string, unknown>,
  requestIndex: number,
  matcherIndex: number,
  patch: Record<string, unknown>,
  applied: string[],
): void {
  const requests = httpRequests(doc);
  const request = requests[requestIndex];
  if (request === undefined) {
    throw new EditError(`request index ${requestIndex} out of range (0..${requests.length - 1})`);
  }
  const matchers = Array.isArray(request.matchers) ? (request.matchers as unknown[]) : undefined;
  if (matchers === undefined) {
    throw new EditError(`request ${requestIndex} has no matchers block`);
  }
  const matcher = asRecord(matchers[matcherIndex]);
  if (Object.keys(matcher).length === 0 && matchers[matcherIndex] === undefined) {
    throw new EditError(`matcher index ${matcherIndex} out of range (0..${matchers.length - 1})`);
  }
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  for (const [key, value] of entries) {
    matcher[key] = value as unknown;
    applied.push(`http[${requestIndex}].matchers[${matcherIndex}].${key}`);
  }
  matchers[matcherIndex] = matcher;
  request.matchers = matchers;
  doc.http = requests;
}

function applyPathPatch(doc: Record<string, unknown>, requestIndex: number, paths: string[], applied: string[]): void {
  const requests = httpRequests(doc);
  const request = requests[requestIndex];
  if (request === undefined) {
    throw new EditError(`request index ${requestIndex} out of range (0..${requests.length - 1})`);
  }
  request.path = paths;
  doc.http = requests;
  applied.push(`http[${requestIndex}].path`);
}

/**
 * Apply a validated edit patch to a template file and rewrite it: parse →
 * mutate → stringify (block style, quotes preserved via yaml lib) → lint the
 * result. Contract violations (empty name, bad severity) throw EditError.
 */
export function applyEdit(absolutePath: string, relativePath: string, raw: EditPatch): EditOutcome {
  const source = readFileSync(absolutePath, "utf8");
  let doc: unknown;
  try {
    doc = parse(source);
  } catch (error) {
    throw new EditError(`template YAML is invalid: ${(error as Error).message.split("\n")[0]}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new EditError("template is not a YAML mapping");
  }
  const record = asRecord(doc);
  const applied: string[] = [];
  if (raw.kind === "info") {
    applyInfoPatch(record, raw.patch, applied);
  } else if (raw.kind === "matcher") {
    applyMatcherPatch(record, raw.requestIndex, raw.matcherIndex, raw.patch as Record<string, unknown>, applied);
  } else {
    applyPathPatch(record, raw.requestIndex, raw.paths, applied);
  }

  const updatedYaml = stringify(record, { lineWidth: 0, defaultStringType: "PLAIN" });
  const yamlFindings = lintYaml(updatedYaml, relativePath);
  const docFindings = lintDocument(record as unknown as TemplateInfo);
  const allFindings = [
    ...yamlFindings.map((finding) => ({
      level: finding.level,
      rule: finding.rule,
      message: finding.message,
    })),
    ...docFindings.map((finding) => ({
      level: finding.level,
      rule: finding.rule,
      message: finding.message,
    })),
  ];
  writeFileSync(absolutePath, updatedYaml);
  return {
    updatedYaml,
    applied,
    lintFindings: allFindings,
    lintErrors: allFindings.filter((finding) => finding.level === "error").length,
  };
}

/**
 * Whole-document mode: replace the file content, but only if the new content
 * passes the parse contract and yaml lint (structural doc lint reported, not
 * blocking — same discipline as vf_nuclei_lint).
 */
export function applyContent(absolutePath: string, relativePath: string, content: string): EditOutcome {
  const yamlFindings = lintYaml(content, relativePath);
  const yamlErrors = yamlFindings.filter((finding) => finding.level === "error");
  if (yamlErrors.length > 0) {
    throw new EditError(`content fails yaml lint: ${yamlErrors.map((finding) => finding.message).join("; ")}`);
  }
  let doc: unknown;
  try {
    doc = parse(content);
  } catch (error) {
    throw new EditError(`content is not valid YAML: ${(error as Error).message.split("\n")[0]}`);
  }
  const record = asRecord(doc);
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new EditError("content has no template id — refusing to write");
  }
  const info = asRecord(record.info);
  const name = info.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new EditError("content has no info.name — refusing to write");
  }
  const docFindings = lintDocument(record as unknown as TemplateInfo);
  writeFileSync(absolutePath, content);
  return {
    updatedYaml: content,
    applied: ["(whole document)"],
    lintFindings: [...yamlFindings, ...docFindings].map((finding) => ({
      level: finding.level,
      rule: finding.rule,
      message: finding.message,
    })),
    lintErrors:
      yamlFindings.filter((finding) => finding.level === "error").length +
      docFindings.filter((finding) => finding.level === "error").length,
  };
}
