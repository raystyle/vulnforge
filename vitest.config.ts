import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 5_000,
    hookTimeout: 10_000,
    include: ["tests/**/*.test.ts", "tools/*.test.ts"],
  },
});
