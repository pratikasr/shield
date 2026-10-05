import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// config.yaml has no defaults for the start block and addresses; the tests take them from test.env.
export default defineConfig({
  test: {
    env: parseEnv(readFileSync(new URL("./test.env", import.meta.url), "utf8")) as Record<string, string>,
    testTimeout: 20_000,
  },
});
