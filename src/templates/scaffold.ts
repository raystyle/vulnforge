export type VulnType = "detect" | "rce" | "sqli" | "lfi" | "panel";

export interface ScaffoldInput {
  vulnType: VulnType;
  name: string;
  author: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  description: string;
  tags: string;
  cveId?: string | undefined;
}

const PROOF = "NUCLEI_PROOF_9f2c1a";

export function templateIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(" ", "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function infoBlock(input: ScaffoldInput): string {
  const lines = [
    `id: ${templateIdFromName(input.name)}`,
    "info:",
    `  name: ${input.name}`,
    `  author: ${input.author}`,
    `  severity: ${input.severity}`,
    `  description: ${input.description}`,
    `  tags: ${input.tags}`,
  ];
  if (input.cveId) {
    lines.push("  classification:", `    cve-id: ${input.cveId}`);
  }
  return lines.join("\n");
}

/** Generate a template skeleton for the given vulnerability type. */
export function skeletonFor(input: ScaffoldInput): string {
  const header = infoBlock(input);
  switch (input.vulnType) {
    case "rce":
      return `${header}
http:
  - method: POST
    path:
      - "{{BaseURL}}/exec"
    body: "cmd=echo ${PROOF}"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "${PROOF}"
        part: body
      - type: status
        status:
          - 200
`;
    case "sqli":
      return `${header}
http:
  - method: POST
    path:
      - "{{BaseURL}}/search"
    body: "q=1' AND 1=1-- -"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "application-specific SQL error text"
        part: body
      - type: status
        status:
          - 200
`;
    case "lfi":
      return `${header}
http:
  - method: GET
    path:
      - "{{BaseURL}}/view?file=../../../etc/passwd"
    matchers:
      - type: regex
        regex:
          - "root:.*?:[0-9]*:[0-9]*:"
        part: body
`;
    case "panel":
      return `${header}
http:
  - method: GET
    path:
      - "{{BaseURL}}/"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "<title>Exact Product Panel</title>"
        part: body
      - type: status
        status:
          - 200
`;
    case "detect":
      return `${header}
http:
  - method: GET
    path:
      - "{{BaseURL}}/"
    matchers-condition: and
    matchers:
      - type: word
        words:
          - "Exact application identifier string"
        part: body
      - type: status
        status:
          - 200
`;
  }
}

/** Target directory in the template repo for a scaffolded template. */
export function targetDirectory(input: ScaffoldInput): string {
  if (input.cveId) return "http/cves";
  if (input.vulnType === "panel" || input.vulnType === "detect") return "http/exposures";
  return "http/vulnerabilities";
}

export const VULN_TYPES: readonly VulnType[] = ["detect", "rce", "sqli", "lfi", "panel"];
