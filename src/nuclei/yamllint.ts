import { parseDocument } from "yaml";

export interface YamlLintFinding {
  level: "error" | "warning";
  rule: string;
  message: string;
  line: number;
}

interface CollectionLike {
  flow?: boolean;
  items?: unknown[];
  range?: [number, number] | null;
}

function isCollectionLike(value: unknown): value is CollectionLike {
  return typeof value === "object" && value !== null && Array.isArray((value as CollectionLike).items);
}

/**
 * YAML lint checks aligned with the upstream .yamllint rules the template repo
 * uses: syntax validity with line/col, flow-style ban, comment spacing,
 * empty-line budget, and trailing spaces. Pure TypeScript — replaces the
 * Python yamllint dependency for cross-platform work.
 */
export function lintYaml(source: string, fileName: string): YamlLintFinding[] {
  const findings: YamlLintFinding[] = [];

  const doc = parseDocument(source, { strict: false });
  if (doc.errors.length > 0) {
    for (const error of doc.errors.slice(0, 5)) {
      const pos = error.linePos?.[0];
      findings.push({
        level: "error",
        rule: "yaml/syntax",
        message: `${fileName}: ${error.message.split("\n")[0] ?? "invalid YAML"}`,
        line: pos?.line ?? 1,
      });
    }
    return findings;
  }

  collectFlow(doc.contents, source, fileName, findings);

  const lines = source.split("\n");
  let emptyRun = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      emptyRun += 1;
      if (emptyRun > 5) {
        findings.push({
          level: "error",
          rule: "yaml/empty-lines",
          message: `${fileName}:${index + 1}: more than 5 consecutive empty lines`,
          line: index + 1,
        });
      }
      continue;
    }
    emptyRun = 0;
    if (/\s+$/.test(line)) {
      findings.push({
        level: "warning",
        rule: "yaml/trailing-spaces",
        message: `${fileName}:${index + 1}: trailing spaces`,
        line: index + 1,
      });
    }
    if (/\S\s{2,}#/.test(line)) {
      findings.push({
        level: "warning",
        rule: "yaml/comment-spacing",
        message: `${fileName}:${index + 1}: use a single space before # comments`,
        line: index + 1,
      });
    }
  }

  return findings;
}

function collectFlow(node: unknown, source: string, fileName: string, findings: YamlLintFinding[]): void {
  if (!isCollectionLike(node)) return;
  if (node.flow === true) {
    const kind = "key" in node ? "mapping {}" : "sequence []";
    findings.push({
      level: "error",
      rule: "yaml/flow-style",
      message: `${fileName}: flow style ${kind} forbidden — use block style`,
      line: node.range?.[0] !== undefined && node.range?.[0] !== null ? lineOf(source, node.range[0]) : 1,
    });
  }
  for (const item of node.items ?? []) {
    if (isCollectionLike(item)) collectFlow(item, source, fileName, findings);
    else if (typeof item === "object" && item !== null && "value" in item)
      collectFlow((item as { value?: unknown }).value, source, fileName, findings);
  }
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index++) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}
