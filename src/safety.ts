export const DANGEROUS_PATTERNS: readonly string[] = [
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

export function isDangerousCommand(command: string): boolean {
  const normalized = command.toLowerCase().trim();
  return DANGEROUS_PATTERNS.some((pattern) => normalized.includes(pattern));
}
