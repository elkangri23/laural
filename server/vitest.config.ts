import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "scripts/critical-coverage.mjs"],
      exclude: ["src/main.ts", "src/migrate.ts"],
      reporter: ["text", "html", "lcov", "json"],
    },
  },
});
