import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep the full release suite bounded on developer laptops alongside agents.
    maxWorkers: 2,
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
  },
});
