import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { shouldReprice } from "../src/decide.js";

const KEY = "0x" + "11".repeat(32);
const base = {
  MONAD_RPC_URL: "https://rpc.monad.xyz",
  CHAIN_ID: "143",
  KEEPER_PRIVATE_KEY: KEY,
};
const REGISTRY = "0x499AA73A1D27e54B33E7DB05ffd22854EC70257E";
const REPRICER = "0xF93b0549cD50c849D792f0eAE94A598fA77C7718";
const EXECUTOR = "0x8CEa85eC7f3D314c4d144e34F2206C8Ac0bbAdA1";
const FORWARDERS = "0xBe6Eb4ACB499f992ba2DaC7CAD59d56DA9e0D823";

function deploymentFile(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "shield-"));
  const file = join(dir, "143.json");
  writeFileSync(
    file,
    JSON.stringify({
      PositionRegistry: REGISTRY.toLowerCase(),
      Repricer: REPRICER.toLowerCase(),
      Executor: EXECUTOR.toLowerCase(),
      ...extra,
    }),
  );
  return file;
}

describe("config", () => {
  it("reads addresses from a deployment file and applies defaults", () => {
    const c = loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: deploymentFile() });
    expect(c.registry).toBe(REGISTRY);
    expect(c.repriceEveryNBlocks).toBe(1);
    expect(c.gasBufferBps).toBe(1_500);
    expect(c.hermesApiKey).toBeUndefined();
    expect(c.dryRun).toBe(false);
  });

  it("rejects a malformed key and a missing address", () => {
    expect(() => loadConfig({ ...base, KEEPER_PRIVATE_KEY: "0x1234" })).toThrow();
    expect(() => loadConfig(base)).toThrow(/missing PositionRegistry/);
  });

  it("bounds every-block repricing to a 600-block window, then every 200 blocks (audit H3)", () => {
    const c = loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: deploymentFile() });
    expect(c.repriceWindowBlocks).toBe(600);
    expect(c.repriceIdleEveryNBlocks).toBe(200);
    expect(c.minBalanceForExitWei).toBe(200_000_000_000_000_000n);
    // A day (288,000 blocks) after start, a block 100 after the last reprice gets none.
    expect(shouldReprice(110_000_000n + 288_000n, 110_000_000n, 110_000_000n + 287_900n, c)).toBe(false);
  });

  it("treats values left empty from .env.example as unset, so the documented defaults apply (audit M8)", () => {
    const c = loadConfig({
      ...base,
      SHIELD_DEPLOYMENT_FILE: deploymentFile(),
      MONAD_WS_URL: "",
      SHIELD_REGISTRY: "",
      PYTH_HERMES_URL: "",
      PYTH_HERMES_API_KEY: "",
      REPRICE_EVERY_N_BLOCKS: "",
      REPRICE_WINDOW_BLOCKS: "",
      REPRICE_IDLE_EVERY_N_BLOCKS: "",
      GAS_BUFFER_BPS: "",
      REPRICE_GAS_HEADROOM: "",
      MIN_BALANCE_FOR_EXIT_WEI: "",
      DRY_RUN: "",
    });
    expect(c.repriceEveryNBlocks).toBe(1);
    expect(c.repriceWindowBlocks).toBe(600);
    expect(c.repriceIdleEveryNBlocks).toBe(200);
    expect(c.gasBufferBps).toBe(1_500);
    expect(c.repriceGasHeadroom).toBe(25_000n);
    expect(c.minBalanceForExitWei).toBe(200_000_000_000_000_000n);
    expect(c.wsUrl).toBeUndefined();
    expect(c.hermesUrl).toBe("https://hermes.pyth.network");
    expect(c.registry).toBe(REGISTRY);
  });

  it("refuses an address variable that disagrees with the deployment file (audit M8)", () => {
    expect(() =>
      loadConfig({
        ...base,
        SHIELD_DEPLOYMENT_FILE: deploymentFile(),
        SHIELD_REGISTRY: "0x3C2BafebbB0c8c58f39A976e725cD20D611d01e9",
      }),
    ).toThrow(/SHIELD_REGISTRY .* does not match PositionRegistry/);
    // The same address in another case is not a disagreement.
    expect(loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: deploymentFile(), SHIELD_REGISTRY: REGISTRY.toLowerCase() }).registry).toBe(
      REGISTRY,
    );
  });

  it("reads the key from a chmod 600 file and refuses a file others can read (audit M12)", () => {
    const dir = mkdtempSync(join(tmpdir(), "shield-key-"));
    const keyFile = join(dir, "keeper.key");
    writeFileSync(keyFile, `${KEY}\n`);
    chmodSync(keyFile, 0o600);
    const env = { MONAD_RPC_URL: base.MONAD_RPC_URL, CHAIN_ID: "143", SHIELD_DEPLOYMENT_FILE: deploymentFile() };
    expect(loadConfig({ ...env, KEEPER_PRIVATE_KEY_FILE: keyFile }).keeperKey).toBe(KEY);
    chmodSync(keyFile, 0o644);
    expect(() => loadConfig({ ...env, KEEPER_PRIVATE_KEY_FILE: keyFile })).toThrow(/chmod 600/);
    chmodSync(keyFile, 0o600);
    expect(() => loadConfig({ ...env, KEEPER_PRIVATE_KEY_FILE: keyFile, KEEPER_PRIVATE_KEY: KEY })).toThrow(/not both/);
    expect(() => loadConfig(env)).toThrow(/missing keeper key/);
  });

  it("adds the public Monad RPCs as read fallbacks on mainnet only", () => {
    const file = deploymentFile();
    expect(loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: file }).fallbackRpcUrls).toEqual(["https://rpc1.monad.xyz"]);
    expect(
      loadConfig({ ...base, MONAD_RPC_URL: "https://monad.example/v2/KEY", SHIELD_DEPLOYMENT_FILE: file }).fallbackRpcUrls,
    ).toEqual(["https://rpc.monad.xyz", "https://rpc1.monad.xyz"]);
    expect(loadConfig({ ...base, MONAD_RPC_URL: "http://127.0.0.1:8545", SHIELD_DEPLOYMENT_FILE: file }).fallbackRpcUrls).toEqual(
      [],
    );
    expect(loadConfig({ ...base, RPC_FALLBACK_URLS: "off", SHIELD_DEPLOYMENT_FILE: file }).fallbackRpcUrls).toEqual([]);
    expect(loadConfig({ ...base, CHAIN_ID: "10143", SHIELD_DEPLOYMENT_FILE: file }).fallbackRpcUrls).toEqual([]);
  });

  it("takes the forwarder factory from the deployment file or SHIELD_FORWARDERS, with the same conflict rule", () => {
    const withFactory = deploymentFile({ ShieldForwarderFactory: FORWARDERS.toLowerCase() });
    expect(loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: withFactory }).forwarders).toBe(FORWARDERS);
    expect(loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: deploymentFile(), SHIELD_FORWARDERS: FORWARDERS.toLowerCase() }).forwarders).toBe(
      FORWARDERS,
    );
    expect(() =>
      loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: withFactory, SHIELD_FORWARDERS: "0x91A1EeE63f300B8f41AE6AF67eDEa2e2ed8c3f79" }),
    ).toThrow(/SHIELD_FORWARDERS .* does not match ShieldForwarderFactory/);
    // A deployment from before the forwarders runs without sweeps.
    expect(loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: deploymentFile() }).forwarders).toBeUndefined();
  });

  it("sweeps every 20 blocks from 1 USDC unit up by default; empty means default and a zero minimum is refused", () => {
    const file = deploymentFile({ ShieldForwarderFactory: FORWARDERS });
    for (const env of [{}, { SHIELD_FORWARDERS: "", SWEEP_EVERY_N_BLOCKS: "", SWEEP_MIN_UNITS: "", MAX_GAS_SWEEP: "" }]) {
      const c = loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: file, ...env });
      expect(c.forwarders).toBe(FORWARDERS);
      expect(c.sweepEveryNBlocks).toBe(20);
      expect(c.sweepMinUnits).toBe(1n);
      expect(c.maxGasSweep).toBe(1_000_000n);
    }
    expect(loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: file, SWEEP_EVERY_N_BLOCKS: "0" }).sweepEveryNBlocks).toBe(0);
    expect(() => loadConfig({ ...base, SHIELD_DEPLOYMENT_FILE: file, SWEEP_MIN_UNITS: "0" })).toThrow();
  });
});
