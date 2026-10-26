import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    env: { NODE_ENV: "test", AUTH_RATE_LIMIT: "10000" },
  },
});
