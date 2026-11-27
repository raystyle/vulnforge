import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type RsTriple, RsTripleSchema } from "./contracts.ts";
import { parseRsScript } from "./script-parse.ts";

/**
 * rs_export: cross-compile an exploit rs script to standalone
 * binaries via cargo zigbuild (pentest_rs `pctl export` precedent —
 * targets incl. musl/windows). The rust-script source carries an inline
 * cargo manifest; zigbuild wants a real crate, so the exporter renders a
 * temporary crate (Cargo.toml + src/main.rs from the script body with the
 * //! header stripped) and builds --target per triple. Artifacts land in
 * <rsRoot>/export/<name>/ with a sha256 manifest.
 */

const VfRustLibPath = fileURLToPath(new URL("../../../vf-rust-lib", import.meta.url)).replaceAll("\\", "/");

const DEFAULT_TRIPLES: readonly string[] = [
  "x86_64-unknown-linux-gnu",
  "x86_64-unknown-linux-musl",
  "x86_64-pc-windows-msvc",
];

export interface RsExportResult {
  exported: Array<{ triple: string; artifact: string; sha256: string }>;
  failed: Array<{ triple: string; reason: string }>;
}

function scriptBodyWithoutHeader(source: string): string {
  const lines = source.split(/\r?\n/);
  const start = (lines[0] ?? "").startsWith("#!") ? 1 : 0;
  let end = start;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (/^\/\/!/.test(line)) {
      end += 1;
      continue;
    }
    if (line.trim().length === 0) {
      end += 1;
      continue;
    }
    break;
  }
  // Also strip the cargo fence block lines (already //!-prefixed, covered
  // above) — the manifest moves to Cargo.toml.
  return lines.slice(end).join("\n");
}

function cargoManifestFromScript(source: string, name: string): string {
  const parsed = parseRsScript(source);
  const deps = parsed.cargoDeps
    .filter((line) => !line.trim().startsWith("[") && !line.trim().startsWith("vf_rust_lib"))
    .map((line) => `    ${line}`)
    .join("\n");
  return [
    "[package]",
    `name = "${name.toLowerCase().replaceAll(/[^a-z0-9_-]/g, "-")}"`,
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    `    vf_rust_lib = { path = "${VfRustLibPath}" }`,
    '    serde_json = "1"',
    deps.length > 0 ? deps : "",
    "",
    "[profile.release]",
    "strip = true",
    "lto = true",
    "",
  ]
    .filter((line) => line.length > 0 || deps.length === 0)
    .join("\n");
}

function spawnCollect(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, output });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(124);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      output += error.message;
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 0));
  });
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export async function runRsExport(options: {
  scriptPath: string;
  scriptName: string;
  exportDir: string;
  targets?: readonly string[];
  timeoutSecs?: number;
}): Promise<RsExportResult> {
  const triples = (options.targets ?? DEFAULT_TRIPLES)
    .map((raw) => RsTripleSchema.safeParse(raw))
    .filter((parsed) => parsed.success)
    .map((parsed) => (parsed as { data: RsTriple }).data);
  const source = readFileSync(options.scriptPath, "utf8");
  const manifest = cargoManifestFromScript(source, options.scriptName);
  const body = scriptBodyWithoutHeader(source);

  const result: RsExportResult = { exported: [], failed: [] };
  for (const triple of triples) {
    const crateDir = join(options.exportDir, ".build", triple);
    mkdirSync(join(crateDir, "src"), { recursive: true });
    writeFileSync(join(crateDir, "Cargo.toml"), manifest);
    writeFileSync(join(crateDir, "src", "main.rs"), body);
    const build = await spawnCollect(
      "cargo",
      ["zigbuild", "--release", "--target", triple],
      crateDir,
      (options.timeoutSecs ?? 600) * 1000,
    );
    if (build.code !== 0) {
      result.failed.push({
        triple,
        reason: `zigbuild exit ${build.code}: ${build.output.split("\n").slice(-6).join(" ").slice(0, 300)}`,
      });
      continue;
    }
    const exe = exe_name(options.scriptName);
    const artifactDir = join(crateDir, "target", triple, "release");
    const artifactPath = join(artifactDir, exe);
    if (!existsSync(artifactPath)) {
      result.failed.push({ triple, reason: `artifact not found at ${artifactPath} (zig build layout changed?)` });
      continue;
    }
    mkdirSync(dirname(join(options.exportDir, options.scriptName, triple)), { recursive: true });
    const dest = join(options.exportDir, options.scriptName, triple, exe);
    mkdirSync(join(options.exportDir, options.scriptName, triple), { recursive: true });
    writeFileSync(dest, readFileSync(artifactPath));
    result.exported.push({ triple, artifact: dest, sha256: sha256File(dest) });
  }
  if (result.exported.length > 0) {
    writeFileSync(
      join(options.exportDir, options.scriptName, "SHA256SUMS"),
      `${result.exported.map((entry) => `${entry.sha256}  ${entry.triple}/${exe_name(options.scriptName)}`).join("\n")}\n`,
    );
  }
  return result;
}

function exe_name(scriptName: string): string {
  // cargo normalizes crate names to lowercase — the artifact follows. The
  // binary extension tracks the TARGET (musl/linux artifacts have no .exe
  // even on a Windows host).
  const base = scriptName.toLowerCase().replaceAll(/[^a-z0-9_-]/g, "-");
  return base;
}
