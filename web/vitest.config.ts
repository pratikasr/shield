import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Unit tests for the web app's pure logic (amounts, risk maths, analytics series). Browser flows run in e2e/. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
