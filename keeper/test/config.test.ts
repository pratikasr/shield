import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  MONAD_RPC_URL: "https://rpc.monad.xyz",
  CHAIN_ID: "143",
  KEEPER_PRIVATE_KEY: "0x" + "11".repeat(32),
};

describe("config", () => {
  it("reads addresses from a deployment file and applies defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "shield-"));
    const file = join(dir, "143.json");
    writeFileSync(
      file,
      JSON.stringify({
        PositionRegistry: "0x499aa73a1d27e54b33e7db05ffd22854ec70257e",
        Repricer: "0xf93b0549cd50c849d792f0eae94a598fa77c7718",
        Executor: "0x8cea85ec7f3d314c4d144e34f2206c8ac0bbada1",
      }),
    );
    const c = loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: file });
    expect(c.registry).toBe("0x499AA73A1D27e54B33E7DB05ffd22854EC70257E");
    expect(c.repriceEveryNBlocks).toBe(1);
    expect(c.gasBufferBps).toBe(1_500);
    expect(c.hermesApiKey).toBeUndefined();
    expect(c.dryRun).toBe(false);
  });

  it("rejects a malformed key and a missing address", () => {
    expect(() => loadConfig({ ...base, KEEPER_PRIVATE_KEY: "0x1234" })).toThrow();
    expect(() => loadConfig(base)).toThrow(/missing PositionRegistry/);
  });
});
