import { describe, expect, it } from "vitest";
import { checkEnvironment, platformCommands } from "../../src/nuclei/env.ts";
import { EnvToolNameSchema } from "../../src/nuclei/env-contract.ts";

describe("enhanced environment init (java/dotnet/rust-script/zigbuild/memshell party)", () => {
  it("checkEnvironment reports the java item (present or fix guidance)", async () => {
    const items = await checkEnvironment(process.cwd());
    const java = items.find((item) => item.name === "java");
    expect(java).toBeDefined();
    // ok or not — both carry actionable detail; missing must carry a fix
    if (java && !java.ok) {
      expect(java.fix).toBeDefined();
      expect(java.fix).toMatch(/JDK|java|temurin|sdkman/i);
    }
  });

  it("checkEnvironment reports the dotnet item", async () => {
    const items = await checkEnvironment(process.cwd());
    const dotnet = items.find((item) => item.name === "dotnet");
    expect(dotnet).toBeDefined();
    if (dotnet && !dotnet.ok) {
      expect(dotnet.fix).toMatch(/dotnet|\.NET/i);
    }
  });

  it("checkEnvironment reports rust-script (the rs execution substrate)", async () => {
    const items = await checkEnvironment(process.cwd());
    const rs = items.find((item) => item.name === "rust-script");
    expect(rs).toBeDefined();
    if (rs && !rs.ok) {
      expect(rs.fix).toMatch(/rust-script|cargo install/i);
    }
  });

  it("checkEnvironment reports cargo-zigbuild (cross-compile export)", async () => {
    const items = await checkEnvironment(process.cwd());
    const zigbuild = items.find((item) => item.name === "cargo-zigbuild");
    expect(zigbuild).toBeDefined();
    if (zigbuild && !zigbuild.ok) {
      expect(zigbuild.fix).toMatch(/zigbuild|zig/i);
    }
  });

  it("all new item names are in the EnvToolName contract", () => {
    for (const name of ["java", "dotnet", "rust-script", "cargo-zigbuild"]) {
      expect(EnvToolNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("platformCommands carries java/dotnet install commands per platform", async () => {
    const commands = await platformCommands();
    expect(commands.java).toBeDefined();
    expect(commands.java).toMatch(/temurin|sdkman|winget|jdk/i);
    expect(commands.dotnet).toBeDefined();
    expect(commands.dotnet).toMatch(/dotnet|sdk/i);
  });
});
