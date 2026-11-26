#!/usr/bin/env node
/**
 * PreToolUse guard: deny Bash/PowerShell commands that match the dangerous
 * pattern list (same list the extension enforces in Pi sessions). Read-only
 * probe commands pass through to the normal permission flow.
 *
 * Input (stdin JSON): { tool_name, tool_input: { command } }
 * Output: exit 0 = no decision; JSON permissionDecision deny = block.
 */

const DANGEROUS_PATTERNS = [
  "rm -rf",
  "rm -fr",
  "git push --force",
  "git push -f",
  "git reset --hard",
  "git clean -f",
  "drop table",
  "delete from",
  "truncate table",
  "shutdown",
  "taskkill",
  "stop-process",
  "remove-item -recurse",
  "format c:",
  "mkfs",
  "dd if=",
  "curl -o- | sh",
  "curl -o- | bash",
  "wget -qo- | sh",
  "wget -qo- | bash",
  "iex (",
  "invoke-expression",
];

const READ_ONLY_PREFIXES = [
  "ls",
  "cat ",
  "head ",
  "tail ",
  "grep ",
  "rg ",
  "git status",
  "git diff",
  "git log",
  "git show",
  "node --version",
  "npm view ",
  "npm ls",
];

function isReadOnly(command) {
  return READ_ONLY_PREFIXES.some((prefix) => command.startsWith(prefix));
}

function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    raw += chunk;
  });
  process.stdin.on("end", () => {
    let toolName = "";
    let command = "";
    try {
      const input = JSON.parse(raw);
      toolName = typeof input.tool_name === "string" ? input.tool_name : "";
      command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
    } catch {
      // unparsable input — nothing to guard
    }
    if (toolName !== "Bash" && toolName !== "PowerShell") {
      process.exit(0);
    }
    const lowered = command.toLowerCase().trim();
    const hit = DANGEROUS_PATTERNS.find((pattern) => lowered.includes(pattern));
    if (hit === undefined) {
      process.exit(0);
    }
    if (isReadOnly(lowered)) {
      process.exit(0);
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Dangerous pattern "${hit}" matches. If this is intentional, ask the user to run it directly or adjust the guard.`,
        },
      }),
    );
    process.exit(0);
  });
}

main();
