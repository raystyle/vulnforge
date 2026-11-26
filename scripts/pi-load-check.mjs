import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "src", "index.ts");
const cli = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");

if (!existsSync(cli)) {
  console.error(`pi CLI entry not found at ${cli} — run npm install first`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [cli, "--no-extensions", "-e", entry, "--help"], {
  cwd: root,
  encoding: "utf8",
  timeout: 60_000,
});

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
const output = `${stdout}\n${stderr}`;

if (result.status !== 0) {
  console.error(`pi load check failed (exit ${result.status}):\n${output}`);
  process.exit(1);
}
if (/[Ee]rror|Cannot find|failed to load/i.test(stderr)) {
  console.error(`pi emitted a load error:\n${stderr}`);
  process.exit(1);
}
console.log("pi load check passed: extension loads without errors");
