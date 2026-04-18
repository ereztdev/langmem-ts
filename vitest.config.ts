import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv();

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
