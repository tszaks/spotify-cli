import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs before each test file: it moves the CLI's files to a temp folder and blocks the network.
    setupFiles: ["./test/helpers/env.ts"],
  },
});
