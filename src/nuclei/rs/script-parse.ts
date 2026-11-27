import { createHash } from "node:crypto";
import type { RsSource } from "./contracts.ts";

/**
 * Parse a rust-script exploit source: the contiguous `//!` metadata run
 * (shebang allowed before it), the ```` ```cargo ```` dependency block inside
 * that run, and advisory lint issues (agent-friendly, run proceeds — the
 * pi-rs-plugins precedent). The script name IS the vulnerability identifier.
 */
export interface ParsedRsScript {
  meta: {
    name: string;
    description: string;
    descriptionEn: string;
    version: string;
    args: string;
    keywords: string[];
    codes: string;
  };
  cargoDeps: string[];
  lintIssues: Array<{ rule: "metadata" | "envelope" | "args"; message: string }>;
  sha256: string;
}

const HEADER_LINE = /^\/\/!\s*([\w-]+):\s*(.*)$/;
const CARGO_OPEN = /^\/\/!\s*```cargo$/;
const CARGO_CLOSE = /^\/\/!\s*```$/;

export function parseRsScript(source: string): ParsedRsScript {
  const lines = source.split(/\r?\n/);
  const start = (lines[0] ?? "").startsWith("#!") ? 1 : 0;
  const header: Record<string, string> = {};
  const cargoDeps: string[] = [];
  let inCargo = false;
  for (const rawLine of lines.slice(start)) {
    if (inCargo) {
      if (CARGO_CLOSE.test(rawLine)) {
        inCargo = false;
        continue;
      }
      const dep = rawLine.replace(/^\/\/!\s?/, "");
      if (dep.trim().length > 0 && !dep.trim().startsWith("#")) cargoDeps.push(dep.trim());
      continue;
    }
    if (CARGO_OPEN.test(rawLine)) {
      inCargo = true;
      continue;
    }
    if (/^\/\/!\s*$/.test(rawLine)) continue; // bare comment line inside the run
    const match = HEADER_LINE.exec(rawLine);
    if (!match) break; // metadata lines are a contiguous run at the top
    header[match[1] ?? ""] = (match[2] ?? "").trim();
  }

  const keywords = (header["keywords"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const lintIssues: ParsedRsScript["lintIssues"] = [];
  if ((header["name"] ?? "").length === 0) {
    lintIssues.push({
      rule: "metadata",
      message: "//! name: header missing — the script name is the vulnerability identifier",
    });
  }
  if ((header["description"] ?? "").length === 0) {
    lintIssues.push({ rule: "metadata", message: "//! description: header missing (search metadata)" });
  }
  if ((header["args"] ?? "").length === 0) {
    lintIssues.push({ rule: "args", message: "//! args: header missing (introspection for callers)" });
  }
  if (!/"success"/.test(source) || !/\bprintln!/.test(source)) {
    lintIssues.push({
      rule: "envelope",
      message: 'no println! of an AgentResult JSON — output must be one {"success":..} line',
    });
  }

  return {
    meta: {
      name: header["name"] ?? "",
      description: header["description"] ?? "",
      descriptionEn: header["description_en"] ?? "",
      version: header["version"] ?? "1.0.0",
      args: header["args"] ?? "",
      keywords,
      codes: header["codes"] ?? "",
    },
    cargoDeps,
    lintIssues,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
}

/** Source rank for the three-way merge: project wins, then global, then bundled. */
export function sourceRank(source: RsSource): number {
  switch (source) {
    case "project":
      return 0;
    case "global":
      return 1;
    case "bundled":
      return 2;
  }
}
