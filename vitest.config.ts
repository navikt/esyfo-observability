import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/tests/**/*.test.ts", "test/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
  },
});
