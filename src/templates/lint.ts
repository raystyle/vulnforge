export interface TemplateInfo {
  id?: unknown;
  info?: {
    name?: unknown;
    author?: unknown;
    severity?: unknown;
    description?: unknown;
    tags?: unknown;
    classification?: {
      cve_id?: unknown;
      cwe_id?: unknown;
    };
  };
  workflows?: unknown;
  workflow?: unknown;
  http?: Array<{
    matchers?: Array<{
      type?: unknown;
      words?: unknown;
      regex?: unknown;
      dsl?: unknown;
      condition?: unknown;
    }>;
    matchers_condition?: unknown;
  }>;
  network?: unknown[];
  dns?: unknown[];
  ssl?: unknown[];
  file?: unknown[];
}

export interface LintFinding {
  level: "error" | "warning" | "info";
  rule: string;
  message: string;
}

const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);

const WEAK_WORDS = [
  "error",
  "admin",
  "login",
  "dashboard",
  "unauthorized",
  "forbidden",
  "not found",
  "welcome",
  "403",
  "404",
  "500",
  "success",
  "failed",
];

const PROOF_MARKERS = ["{{randstr}}", "rand_base", "randstr"];

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function checkStructure(doc: TemplateInfo): LintFinding[] {
  const findings: LintFinding[] = [];
  const id = asString(doc.id);
  if (!id) {
    findings.push({ level: "error", rule: "structure/missing-id", message: "template id is required" });
  } else {
    if (id !== id.toLowerCase()) {
      findings.push({ level: "error", rule: "structure/id-case", message: "template id must be lowercase" });
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      findings.push({ level: "error", rule: "structure/id-format", message: "template id must be kebab-case" });
    }
    if (id.split("-").length > 5) {
      findings.push({
        level: "warning",
        rule: "structure/id-length",
        message: "template id should stay at 3-4 words",
      });
    }
  }

  const info = doc.info ?? {};
  const name = asString(info.name);
  if (!name || name.length === 0) {
    findings.push({ level: "error", rule: "structure/missing-name", message: "info.name is required" });
  }
  const author = asString(info.author);
  if (!author || author.length === 0) {
    findings.push({ level: "error", rule: "structure/missing-author", message: "info.author is required" });
  } else if (author.includes(" ") && !author.includes(",")) {
    findings.push({
      level: "warning",
      rule: "structure/author-format",
      message: "multiple authors are comma-separated, no spaces",
    });
  }
  const severity = asString(info.severity);
  if (!severity) {
    findings.push({ level: "error", rule: "structure/missing-severity", message: "info.severity is required" });
  } else if (!SEVERITIES.has(severity)) {
    findings.push({
      level: "error",
      rule: "structure/severity-enum",
      message: `info.severity must be one of: ${[...SEVERITIES].join("/")}`,
    });
  }
  const description = asString(info.description);
  if (!description || description.length < 10) {
    findings.push({
      level: "error",
      rule: "structure/missing-description",
      message: "info.description is required (at least a sentence)",
    });
  }
  const tags = asString(info.tags);
  if (!tags) {
    findings.push({ level: "warning", rule: "structure/missing-tags", message: "info.tags improve searchability" });
  }
  return findings;
}

interface MatcherSummary {
  total: number;
  weakHits: string[];
  hasProof: boolean;
  multiLayer: boolean;
}

function summarizeMatchers(doc: TemplateInfo): MatcherSummary {
  const requests = Array.isArray(doc.http) ? doc.http : [];
  const matchers = requests.flatMap((request) => (Array.isArray(request?.matchers) ? request.matchers : []));
  const weakHits: string[] = [];
  let hasProof = false;
  for (const matcher of matchers) {
    const words = Array.isArray(matcher?.words) ? matcher.words : [];
    for (const word of words) {
      const text = asString(word) ?? "";
      const lowered = text.toLowerCase();
      const weak = WEAK_WORDS.find((candidate) => lowered === candidate);
      if (weak && !weakHits.includes(weak)) weakHits.push(weak);
    }
    const allText = [
      ...(Array.isArray(matcher?.words) ? matcher.words : []),
      ...(Array.isArray(matcher?.regex) ? matcher.regex : []),
      ...(Array.isArray(matcher?.dsl) ? matcher.dsl : []),
    ]
      .map((value) => asString(value) ?? "")
      .join("\n");
    if (PROOF_MARKERS.some((marker) => allText.includes(marker))) hasProof = true;
  }
  const multiLayer = requests.some((request) => Array.isArray(request?.matchers) && request.matchers.length >= 2);
  return { total: matchers.length, weakHits, hasProof, multiLayer };
}

export function checkWeakMatchers(doc: TemplateInfo): LintFinding[] {
  const findings: LintFinding[] = [];
  const summary = summarizeMatchers(doc);
  if (summary.weakHits.length > 0) {
    findings.push({
      level: "error",
      rule: "matcher/weak-word",
      message: `weak matcher words (false-positive prone): ${summary.weakHits.join(", ")}`,
    });
  }
  // Workflow templates orchestrate other templates; they carry no matchers by
  // design (engine WorkflowProtocol semantics) and need a workflows block instead.
  const isWorkflow = doc.workflows !== undefined || doc.workflow !== undefined;
  if (summary.total === 0 && isWorkflow) {
    findings.push({
      level: "info",
      rule: "workflow/no-matchers",
      message: "workflow template: subtemplates are referenced in the workflows block; matcher analysis not applicable",
    });
    return findings;
  }
  if (summary.total === 0) {
    findings.push({ level: "error", rule: "matcher/missing", message: "template has no matchers" });
  } else {
    if (!summary.multiLayer) {
      findings.push({
        level: "warning",
        rule: "matcher/single-layer",
        message:
          "single matcher only — prefer multi-layer verification (application id + version + vulnerability proof, matchers-condition: and)",
      });
    }
    if (!summary.hasProof) {
      findings.push({
        level: "info",
        rule: "matcher/no-proof-marker",
        message: "no exploitation proof marker ({{randstr}}) — version-only detection cannot confirm the vulnerability",
      });
    }
  }
  return findings;
}

export function lintDocument(doc: TemplateInfo): LintFinding[] {
  return [...checkStructure(doc), ...checkWeakMatchers(doc)];
}
