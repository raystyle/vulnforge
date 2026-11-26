import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { checkNuclei } from "./run.ts";

export interface EnvCheckItem {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string | undefined;
  /** Set when the tool lives under a managed root (e.g. ohmyenv) — excluded from the system-toolchain group. */
  managedBy?: string | undefined;
}

export type Platform = "windows" | "linux" | "macos";

export type PackageManager = "winget" | "brew" | "apt" | "none";

function detectPlatform(): Platform {
  if (platform() === "win32") return "windows";
  if (platform() === "darwin") return "macos";
  return "linux";
}

function runCapture(command: string, args: string[], timeoutMs = 15_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output: output.slice(0, 2000) });
    };
    const timer = setTimeout(() => {
      child.kill();
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

/** Resolve the first PATH hit for a command ('' when absent). */
async function resolveCommandPath(command: string): Promise<string> {
  const finder = detectPlatform() === "windows" ? "where" : "which";
  const result = await runCapture(finder, [command], 10_000);
  if (result.code !== 0) return "";
  return result.output.split("\n")[0]?.trim() ?? "";
}

export interface ManagedRoot {
  root: string;
  label: string;
}

function classifyManaged(path: string, managedRoots: ManagedRoot[]): string | undefined {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  for (const entry of managedRoots) {
    if (normalized.startsWith(entry.root.replaceAll("\\", "/").toLowerCase())) {
      return entry.label;
    }
  }
  return undefined;
}

/** Managed roots: repo config `env.managedRoots`, env var fallback. */
export function loadManagedRoots(cwd: string): ManagedRoot[] {
  const fromEnv = process.env.VULNFORGE_MANAGED_ROOTS;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
      .split(";")
      .filter((entry) => entry.trim().length > 0)
      .map((entry) => ({ root: entry.trim(), label: "env" }));
  }
  try {
    const { openTemplatesRepo } = require("./config.ts") as {
      openTemplatesRepo: (start: string) => { root: string };
    };
    const repo = openTemplatesRepo(cwd);
    const raw = readFileSync(join(repo.root, ".vulnforge.json"), "utf8");
    const parsed = JSON.parse(raw) as { env?: { managedRoots?: unknown } };
    const roots = parsed.env?.managedRoots;
    if (Array.isArray(roots)) {
      return roots
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => ({ root: entry.trim(), label: "ohmyenv" }));
    }
  } catch {
    // no repo or no config — no classification
  }
  return [];
}

// ---------------------------------------------------------------------------
// China mirror registry — detection and per-platform fix commands.
// ---------------------------------------------------------------------------

export interface MirrorCheckItem {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string | undefined;
}

function fileContains(path: string, needle: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, "utf8").includes(needle);
  } catch {
    return false;
  }
}

/** npm: registry in ~/.npmrc; bun: install config; config content check. */
async function checkNpmMirror(): Promise<MirrorCheckItem> {
  const npmrc = join(homedir(), ".npmrc");
  if (fileContains(npmrc, "npmmirror.com")) {
    return { name: "npm mirror", ok: true, detail: "npmmirror configured" };
  }
  const npmRegistry = await runCapture("npm", ["config", "get", "registry"], 10_000);
  if (npmRegistry.code === 0 && npmRegistry.output.includes("npmmirror.com")) {
    return { name: "npm mirror", ok: true, detail: "npmmirror via npm config" };
  }
  return {
    name: "npm mirror",
    ok: false,
    detail: "registry not mirrored (slow/timeout in CN)",
    fix: "npm config set registry https://registry.npmmirror.com",
  };
}

async function checkBunMirror(): Promise<MirrorCheckItem> {
  const bunfig = join(homedir(), ".bunfig.toml");
  if (fileContains(bunfig, "npmmirror.com")) {
    return { name: "bun mirror", ok: true, detail: "npmmirror in ~/.bunfig.toml" };
  }
  const bunWhich = await resolveCommandPath("bun");
  if (bunWhich.length === 0) {
    return { name: "bun mirror", ok: true, detail: "bun absent — skipped" };
  }
  return {
    name: "bun mirror",
    ok: false,
    detail: "no npmmirror in ~/.bunfig.toml",
    fix: "printf '[install]\nregistry = \"https://registry.npmmirror.com\"\n' >> ~/.bunfig.toml",
  };
}

async function checkPipMirror(): Promise<MirrorCheckItem> {
  const pipConfLinux = join(homedir(), ".config", "pip", "pip.conf");
  const pipConfWin = join(homedir(), "AppData", "Roaming", "pip", "pip.ini");
  const pipConfMac = join(homedir(), ".pip", "pip.conf");
  for (const candidate of [pipConfWin, pipConfLinux, pipConfMac]) {
    if (fileContains(candidate, "tuna") || fileContains(candidate, "aliyun")) {
      return { name: "pip mirror", ok: true, detail: candidate };
    }
  }
  const pipConfig = await runCapture("pip", ["config", "get", "global.index-url"], 10_000);
  if (pipConfig.code === 0 && (pipConfig.output.includes("tuna") || pipConfig.output.includes("aliyun"))) {
    return { name: "pip mirror", ok: true, detail: "mirror via pip config" };
  }
  return {
    name: "pip mirror",
    ok: false,
    detail: "default PyPI (slow in CN)",
    fix: "pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple",
  };
}

async function checkUvMirror(): Promise<MirrorCheckItem> {
  const uvTomlLinux = join(homedir(), ".config", "uv", "uv.toml");
  const uvTomlWin = join(homedir(), "AppData", "Roaming", "uv", "uv.toml");
  for (const candidate of [uvTomlWin, uvTomlLinux]) {
    if (fileContains(candidate, "tuna") || fileContains(candidate, "aliyun")) {
      return { name: "uv mirror", ok: true, detail: candidate };
    }
  }
  const uvEnv = process.env.UV_INDEX_URL ?? "";
  if (uvEnv.includes("tuna") || uvEnv.includes("aliyun")) {
    return { name: "uv mirror", ok: true, detail: `UV_INDEX_URL=${uvEnv}` };
  }
  return {
    name: "uv mirror",
    ok: false,
    detail: "no mirror configured",
    fix: "powershell -c \"[Environment]::SetEnvironmentVariable('UV_INDEX_URL','https://pypi.tuna.tsinghua.edu.cn/simple','User')\" (win) or export UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple (posix)",
  };
}

function checkCargoMirror(): MirrorCheckItem {
  const configToml = join(homedir(), ".cargo", "config.toml");
  const configLegacy = join(homedir(), ".cargo", "config");
  for (const candidate of [configToml, configLegacy]) {
    if (fileContains(candidate, "rsproxy")) {
      return { name: "cargo mirror", ok: true, detail: candidate };
    }
  }
  return {
    name: "cargo mirror",
    ok: false,
    detail: "crates.io direct (slow in CN)",
    fix: "Add to ~/.cargo/config.toml:\n[source.crates-io]\nreplace-with = 'rsproxy-sparse'\n[source.rsproxy-sparse]\nregistry = 'sparse+https://rsproxy.cn/index/'",
  };
}

function checkRustupMirror(): MirrorCheckItem {
  const dist = process.env.RUSTUP_DIST_SERVER ?? "";
  if (dist.includes("rsproxy.cn")) {
    return { name: "rustup mirror", ok: true, detail: `RUSTUP_DIST_SERVER=${dist}` };
  }
  return {
    name: "rustup mirror",
    ok: false,
    detail: "default dist server",
    fix: "setx RUSTUP_DIST_SERVER https://rsproxy.cn (win) or export RUSTUP_DIST_SERVER=https://rsproxy.cn (posix)",
  };
}

function checkFnmMirror(): MirrorCheckItem {
  const nodeDistMirror = process.env.FNM_NODE_DIST_MIRROR ?? process.env.NODE_DIST_MIRROR ?? "";
  if (nodeDistMirror.includes("npmmirror")) {
    return { name: "fnm node mirror", ok: true, detail: `NODE_DIST_MIRROR=${nodeDistMirror}` };
  }
  return {
    name: "fnm node mirror",
    ok: false,
    detail: "default nodejs.org dist",
    fix: "setx FNM_NODE_DIST_MIRROR https://npmmirror.com/mirrors/node (win) or export FNM_NODE_DIST_MIRROR=https://npmmirror.com/mirrors/node (posix)",
  };
}

export async function checkMirrors(): Promise<MirrorCheckItem[]> {
  return [
    await checkNpmMirror(),
    await checkBunMirror(),
    await checkPipMirror(),
    await checkUvMirror(),
    checkCargoMirror(),
    checkRustupMirror(),
    checkFnmMirror(),
  ];
}

// ---------------------------------------------------------------------------
// Per-platform install command matrix.
// ---------------------------------------------------------------------------

export interface PlatformCommands {
  wingetOrBrewOrApt: PackageManager;
  node: string;
  fnm: string;
  bun: string;
  uv: string;
  go: string;
  rustup: string;
  zig: string;
  java: string;
  dotnet: string;
}

async function detectPackageManager(): Promise<PackageManager> {
  const os = detectPlatform();
  if (os === "windows") {
    const winget = await resolveCommandPath("winget");
    return winget.length > 0 ? "winget" : "none";
  }
  if (os === "macos") {
    const brew = await resolveCommandPath("brew");
    return brew.length > 0 ? "brew" : "none";
  }
  const apt = await resolveCommandPath("apt");
  return apt.length > 0 ? "apt" : "none";
}

export async function platformCommands(): Promise<PlatformCommands> {
  const pkg = await detectPackageManager();
  const os = detectPlatform();
  if (os === "windows") {
    return {
      wingetOrBrewOrApt: pkg,
      node: "winget install Schniz.fnm && fnm install --use 22",
      fnm: "winget install Schniz.fnm",
      bun: 'powershell -c "irm bun.sh/install.ps1 | iex"',
      uv: 'powershell -c "irm astral.sh/uv/install.ps1 | iex"',
      // Official Go channel: msi from the China mirror (golang.google.cn), PATH configured by installer.
      go: 'powershell -c "irm https://golang.google.cn/dl/go1.27.4.windows-amd64.msi -OutFile $env:TEMP\\go.msi; msiexec /i $env:TEMP\\go.msi /qn"',
      // Java multi-version: Temurin 21 daily + JDK 8 legacy (deserialization) — MSI per user guide.
      java: "winget install -e --id EclipseAdoptium.Temurin.21.JDK && winget install -e --id EclipseAdoptium.Temurin.8.JDK",
      dotnet: "winget install Microsoft.DotNet.SDK.10 && winget install Microsoft.DotNet.SDK.11",
      rustup: "winget install -e --id Rustlang.Rustup",
      zig: "winget install -e --id zig.zig",
    };
  }
  if (os === "macos") {
    return {
      wingetOrBrewOrApt: pkg,
      node: "brew install fnm && fnm install --use 22",
      fnm: "brew install fnm",
      bun: "brew install oven-sh/bun/bun",
      uv: "brew install uv",
      // Official Go guidance: prebuilt tarball from the China mirror, never brew/apt.
      go: "curl -fsSL -o /tmp/go.tgz https://golang.google.cn/dl/go1.27.4.darwin-arm64.tar.gz && sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tgz && echo 'export PATH=$PATH:/usr/local/go/bin:$(go env GOPATH)/bin' >> ~/.zshrc",
      // Java multi-version via SDKMAN (linux/mac canonical per user guide).
      java: "curl -s 'https://get.sdkman.io' | bash && sdk install java 21.0.x-tem && sdk install java 8.0.x-tem",
      dotnet:
        "curl -sSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin --channel 10.0 && bash /dev/stdin --channel 11.0",
      rustup: "curl --proto '=https' --tlsv1.2 -sSf https://rsproxy.cn/rustup-init.sh | sh",
      zig: "brew install zig",
    };
  }
  return {
    wingetOrBrewOrApt: pkg,
    node: "curl -fsSL https://fnm.vercel.app/install | bash && fnm install --use 22",
    fnm: "curl -fsSL https://fnm.vercel.app/install | bash",
    bun: "curl -fsSL https://bun.sh/install | bash",
    uv: "curl -LsSf https://astral.sh/uv/install.sh | sh",
    // Official Go guidance: prebuilt tarball from the China mirror, never apt (stale, unsupported).
    go: "curl -fsSL -o /tmp/go.tgz https://golang.google.cn/dl/go1.27.4.linux-amd64.tar.gz && sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tgz && echo 'export PATH=$PATH:/usr/local/go/bin:$(go env GOPATH)/bin' >> ~/.bashrc",
    // Java multi-version via SDKMAN (linux/mac canonical per user guide).
    java: "curl -s 'https://get.sdkman.io' | bash && sdk install java 21.0.x-tem && sdk install java 8.0.x-tem",
    dotnet:
      "curl -sSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin --channel 10.0 && bash /dev/stdin --channel 11.0",
    rustup: "curl --proto '=https' --tlsv1.2 -sSf https://rsproxy.cn/rustup-init.sh | sh",
    zig: pkg === "apt" ? "sudo apt install -y zig" : "zig: install from https://ziglang.org/download/ (no apt)",
  };
}

async function checkCommand(
  name: string,
  command: string,
  versionArgs: string[],
  versionPattern: RegExp,
  fix: string,
  managedRoots: ManagedRoot[],
): Promise<EnvCheckItem> {
  const path = await resolveCommandPath(command);
  const result = await runCapture(command, versionArgs);
  if (result.code !== 0 || path.length === 0) {
    return { name, ok: false, detail: "not installed or not on PATH", fix };
  }
  const match = versionPattern.exec(result.output);
  const firstLine = result.output.split("\n")[0] ?? "";
  const managed = classifyManaged(path, managedRoots);
  return {
    name,
    ok: true,
    detail: match?.[1] ?? (firstLine.length > 0 ? firstLine.slice(0, 60) : "present"),
    ...(managed ? { managedBy: managed } : {}),
  };
}

const GO_FIX = "go env -w GO111MODULE=on\ngo env -w GOPROXY=https://goproxy.cn,direct";
const MSVC_FIX =
  'winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"';

/** The pi version this extension is developed and tested against. */
export const EXPECTED_PI_VERSION = "1.5.0";

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function versionSatisfies(actual: string, expected: string): boolean {
  const a = parseVersion(actual);
  const b = parseVersion(expected);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

/** pi install + version alignment against the extension's expected version. */
async function checkPiItem(managedRoots: ManagedRoot[]): Promise<EnvCheckItem> {
  const piPath = await resolveCommandPath("pi");
  if (piPath.length === 0) {
    return {
      name: "pi",
      ok: false,
      detail: "not installed — the extension host itself is missing",
      fix: "npm install -g @earendil-works/pi-coding-agent (with npmmirror registry)",
    };
  }
  const versionOutput = await runCapture("pi", ["--version"], 10_000);
  const version = /(\d+\.\d+\.\d+)/.exec(versionOutput.output)?.[1] ?? "";
  if (version.length === 0) {
    return { name: "pi", ok: false, detail: "installed but version unreadable", fix: "pi --version manually" };
  }
  const aligned = versionSatisfies(version, EXPECTED_PI_VERSION);
  const managed = classifyManaged(piPath, managedRoots);
  return {
    name: "pi",
    ok: aligned,
    detail: aligned
      ? `${version} (>= ${EXPECTED_PI_VERSION})`
      : `${version} is older than expected ${EXPECTED_PI_VERSION} — extension APIs may differ`,
    ...(aligned ? {} : { fix: "npm install -g @earendil-works/pi-coding-agent@latest" }),
    ...(managed ? { managedBy: managed } : {}),
  };
}

async function checkGoItem(managedRoots: ManagedRoot[]): Promise<EnvCheckItem> {
  const go = await runCapture("go", ["version"]);
  if (go.code !== 0) {
    return { name: "go", ok: false, detail: "not installed", fix: (await platformCommands()).go };
  }
  const goVersion = /go version (\S+)/.exec(go.output)?.[1] ?? "unknown";
  const gomodule = (await runCapture("go", ["env", "GO111MODULE"])).output.trim();
  const goproxy = (await runCapture("go", ["env", "GOPROXY"])).output.trim();
  const moduleOn = gomodule === "on" || gomodule === "";
  const proxyOk =
    goproxy.includes("goproxy.cn") ||
    (goproxy.length > 0 && !goproxy.startsWith("https://proxy.golang.org") && goproxy.includes("goproxy"));
  const goPath = await resolveCommandPath("go");
  const managed = classifyManaged(goPath, managedRoots);
  return {
    name: "go",
    ok: moduleOn && proxyOk,
    detail: `${goVersion}; GO111MODULE=${gomodule || "(default on)"}; GOPROXY=${goproxy || "(default)"}`,
    ...(moduleOn && proxyOk ? {} : { fix: GO_FIX }),
    ...(managed ? { managedBy: managed } : {}),
  };
}

async function checkRustItem(managedRoots: ManagedRoot[]): Promise<EnvCheckItem | EnvCheckItem[]> {
  const rustc = await runCapture("rustc", ["--version"]);
  if (rustc.code !== 0) {
    return {
      name: "rust",
      ok: false,
      detail: "not installed",
      fix: `set RUSTUP_DIST_SERVER=https://rsproxy.cn && RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup first, then: ${(await platformCommands()).rustup}`,
    };
  }
  const rustVersion = /rustc (\S+)/.exec(rustc.output)?.[1] ?? "unknown";
  const cargo = await runCapture("cargo", ["--version"]);
  const rustup = await runCapture("rustup", ["show"]);
  const isMsvc = rustup.output.includes("msvc");
  const cargoMirror =
    fileContains(join(homedir(), ".cargo", "config.toml"), "rsproxy") ||
    fileContains(join(homedir(), ".cargo", "config"), "rsproxy");
  const rustOk = cargo.code === 0 && cargoMirror;
  const rustPath = await resolveCommandPath("rustc");
  const managed = classifyManaged(rustPath, managedRoots);
  const items: EnvCheckItem[] = [
    {
      name: "rust",
      ok: rustOk,
      detail: `rustc ${rustVersion}; cargo ${cargo.code === 0 ? "ok" : "missing"}; crates mirror ${cargoMirror ? "rsproxy" : "default (slow in CN)"}`,
      ...(cargoMirror
        ? {}
        : {
            fix: "Add to ~/.cargo/config.toml:\n[source.crates-io]\nreplace-with = 'rsproxy-sparse'\n[source.rsproxy-sparse]\nregistry = 'sparse+https://rsproxy.cn/index/'",
          }),
      ...(managed ? { managedBy: managed } : {}),
    },
  ];
  if (detectPlatform() === "windows" && isMsvc) {
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)";
    const vswhere = join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
    const detection = existsSync(vswhere)
      ? await runCapture(vswhere, [
          "-products",
          "*",
          "-requires",
          "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
          "-property",
          "installationPath",
        ])
      : { code: 1, output: "" };
    const msvcOk = detection.code === 0 && detection.output.trim().length > 0;
    items.push({
      name: "msvc",
      ok: msvcOk,
      detail: msvcOk
        ? `Build Tools at ${detection.output.trim()}`
        : "rust msvc toolchain set but VC++ Build Tools not found",
      ...(msvcOk ? {} : { fix: MSVC_FIX }),
    });
  }
  return items;
}

export async function checkEnvironment(cwd: string): Promise<EnvCheckItem[]> {
  const items: EnvCheckItem[] = [];
  const managedRoots = loadManagedRoots(cwd);
  const commands = await platformCommands();
  const os = detectPlatform();

  items.push(await checkPiItem(managedRoots));

  if (os === "windows") {
    items.push(
      await checkCommand(
        "winget",
        "winget",
        ["--version"],
        /(v[\d.]+)/,
        "Microsoft Store → update 'App Installer'",
        managedRoots,
      ),
    );
  }
  items.push(
    await checkCommand("node", "node", ["--version"], /(v[\d.]+)/, commands.node, managedRoots),
    await checkCommand("fnm", "fnm", ["--version"], /(fnm [\d.]+)/, commands.fnm, managedRoots),
    await checkCommand("bun", "bun", ["--version"], /([\d.]+)/, commands.bun, managedRoots),
    await checkCommand("uv", "uv", ["--version"], /(uv [\d.]+)/, commands.uv, managedRoots),
  );

  items.push(await checkGoItem(managedRoots));

  const rustItems = await checkRustItem(managedRoots);
  if (Array.isArray(rustItems)) items.push(...rustItems);
  else items.push(rustItems);

  items.push(await checkCommand("zig", "zig", ["version"], /(zig [\d.]+)/, commands.zig, managedRoots));

  items.push(
    await checkCommand("java", "java", ["-version"], /version "?([\d._]+)"?/, commands.java, managedRoots),
    await checkCommand("dotnet", "dotnet", ["--version"], /([\d.]+)/, commands.dotnet, managedRoots),
    await checkCommand(
      "rust-script",
      "rust-script",
      ["--version"],
      /(rust-script [\d.]+)/,
      "cargo install rust-script --registry rsproxy-sparse (rsproxy mirror)",
      managedRoots,
    ),
    await checkCommand(
      "cargo-zigbuild",
      "cargo-zigbuild",
      ["--help"],
      /zigbuild/i,
      "cargo install cargo-zigbuild --registry rsproxy-sparse (rsproxy mirror)",
      managedRoots,
    ),
  );

  const nuclei = await checkNuclei();
  items.push({
    name: "nuclei",
    ok: nuclei.available,
    detail: nuclei.available ? `${nuclei.version ?? "unknown"}` : "not runnable",
    ...(nuclei.available
      ? {}
      : { fix: "go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest (needs go with goproxy.cn)" }),
  });

  items.push({
    name: "yamllint",
    ok: true,
    detail: "verify: yamllint --version",
    fix: "uv tool install yamllint",
  });

  try {
    const { openTemplatesRepo } = require("./config.ts") as {
      openTemplatesRepo: (start: string) => { root: string };
    };
    const repo = openTemplatesRepo(cwd);
    items.push({ name: "templates repo", ok: true, detail: repo.root });
  } catch (error) {
    items.push({
      name: "templates repo",
      ok: false,
      detail: (error as Error).message,
      fix: "Create the templates repo with a .vulnforge.json marker",
    });
  }

  const { benignProfile, startMockTarget } = await import("./mock.ts");
  const probe = await startMockTarget(benignProfile());
  await probe.close();
  items.push({ name: "mock target", ok: true, detail: `bound and freed 127.0.0.1:${probe.port}` });

  return items;
}

export interface EnvAcceptance {
  passed: boolean;
  blocking: Array<{ name: string; detail: string }>;
  mirrorGaps: Array<{ name: string; detail: string }>;
}

/**
 * Environment acceptance: run the full check plus the China-mirror sweep and
 * judge whether the machine is ready for template work. Mirror gaps are
 * reported separately from blocking failures (slow installs vs broken work).
 */
export async function acceptEnvironment(cwd: string): Promise<EnvAcceptance> {
  const items = await checkEnvironment(cwd);
  const mirrors = await checkMirrors();
  const critical = new Set(["pi", "node", "go", "nuclei", "templates repo", "mock target"]);
  const blocking = items
    .filter((item) => !item.ok && critical.has(item.name))
    .map((item) => ({ name: item.name, detail: item.detail }));
  const mirrorGaps = mirrors
    .filter((mirror) => !mirror.ok)
    .map((mirror) => ({ name: mirror.name, detail: mirror.detail }));
  return {
    passed: blocking.length === 0,
    blocking,
    mirrorGaps,
  };
}

export function acceptanceText(acceptance: EnvAcceptance): string {
  const lines: string[] = [];
  lines.push(acceptance.passed ? "ACCEPTED: environment supports template work" : "NOT ACCEPTED");
  if (acceptance.blocking.length > 0) {
    lines.push("blocking:");
    for (const item of acceptance.blocking) lines.push(`  - ${item.name}: ${item.detail}`);
  }
  if (acceptance.mirrorGaps.length > 0) {
    lines.push("mirror gaps (recommended for CN networks):");
    for (const item of acceptance.mirrorGaps) lines.push(`  - ${item.name}: ${item.detail}`);
  }
  return lines.join("\n");
}

export function environmentText(items: EnvCheckItem[]): string {
  const system = items.filter((item) => !item.managedBy);
  const managed = items.filter((item) => item.managedBy);
  const render = (item: EnvCheckItem): string => {
    const status = item.ok ? "OK" : "MISSING";
    const fix = item.fix && !item.ok ? `\n  fix: ${item.fix.replaceAll("\n", "\n  ")}` : "";
    return `${status.padEnd(8)}${item.name}: ${item.detail}${fix}`;
  };
  const managedLabels = [...new Set(managed.map((item) => item.managedBy))];
  const parts = [`== system toolchain ==\n${system.map(render).join("\n")}`];
  for (const label of managedLabels) {
    parts.push(
      `== ${label} (managed, excluded from system checks) ==\n${managed
        .filter((entry) => entry.managedBy === label)
        .map(render)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export interface InstallAction {
  name: string;
  commands: string[];
}

export interface InstallOutcome {
  name: string;
  command: string;
  exitCode: number;
  output: string;
}

/** Execute fix commands through the platform shell and capture the result. */
export async function runInstallAction(action: InstallAction, timeoutMs = 600_000): Promise<InstallOutcome> {
  const joined = action.commands.join(" && ");
  const os = detectPlatform();
  const child =
    os === "windows"
      ? spawn("cmd.exe", ["/d", "/s", "/c", joined], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
      : spawn("bash", ["-lc", joined], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let settled = false;
  return new Promise((resolve) => {
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ name: action.name, command: joined, exitCode, output: output.slice(0, 8000) });
    };
    const timer = setTimeout(() => {
      child.kill();
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

/** Extract the fix commands for a tool from a completed check. */
export function fixCommandsFor(items: EnvCheckItem[], name: string): string[] | undefined {
  const item = items.find((entry) => entry.name === name);
  if (!item || item.ok || !item.fix) return undefined;
  return item.fix
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("Add to") &&
        !line.startsWith("set ") &&
        !line.startsWith("export ") === false,
    );
}
