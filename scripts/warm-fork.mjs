// Warms a local fork (scripts/stack.sh) before a browser connects: makes the same Aave, Pyth and Shield reads the
// borrower and LP pages make, so Anvil fetches that mainnet state once, in parallel. On a cold fork each storage slot
// is a round trip to the upstream RPC (350 to 700 ms measured), and the page's first batch touches every Aave reserve;
// served cold, that batch outlasts the browser's RPC timeout. Tests and rehearsals only; mainnet needs no warming.
//
//   node scripts/warm-fork.mjs <rpc-url> <deployment.json> <address>...
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../keeper/package.json", import.meta.url));
const { createPublicClient, http, parseAbi } = require("viem");

const [rpc, deploymentFile, ...users] = process.argv.slice(2);
if (!rpc || !deploymentFile || users.length === 0) {
  console.error("usage: node scripts/warm-fork.mjs <rpc-url> <deployment.json> <address>...");
  process.exit(1);
}
const d = JSON.parse(readFileSync(deploymentFile, "utf8"));
const POOL = "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef";
const ORACLE = "0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf";
const DATA_PROVIDER = "0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad";

const abi = parseAbi([
  "function getReservesList() view returns (address[])",
  "function getReserveAToken(address) view returns (address)",
  "function getReserveVariableDebtToken(address) view returns (address)",
  "function getReserveConfigurationData(address) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)",
  "function getUserReserveData(address,address) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)",
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)",
  "function getUserEMode(address) view returns (uint256)",
  "function getAssetsPrices(address[]) view returns (uint256[])",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function quote(address) view returns (uint256,uint256,uint256,uint256)",
  "function previewExit(address) view returns (uint8,uint256,uint256,uint256)",
  "function totalAssets() view returns (uint256)",
]);
// Long timeout and no retries: a cold read is slow, never wrong, and a retry would fetch the same state twice.
const client = createPublicClient({ transport: http(rpc, { timeout: 180_000, retryCount: 0 }) });
const read = (address, functionName, args = []) =>
  client.readContract({ address, abi, functionName, args }).catch(() => undefined); // a revert still warmed its state

const started = Date.now();
const reserves = await read(POOL, "getReservesList");
await Promise.all(
  reserves.map(async (asset) => {
    const [aToken, vToken] = await Promise.all([
      read(POOL, "getReserveAToken", [asset]),
      read(POOL, "getReserveVariableDebtToken", [asset]),
      read(asset, "symbol"),
      read(DATA_PROVIDER, "getReserveConfigurationData", [asset]),
    ]);
    const holders = [...users, d.ShieldVault, d.Executor];
    await Promise.all(
      holders.flatMap((u) => [
        read(aToken, "balanceOf", [u]),
        read(vToken, "balanceOf", [u]),
        read(DATA_PROVIDER, "getUserReserveData", [asset, u]),
        read(aToken, "allowance", [u, d.Executor]),
      ]),
    );
  }),
);
await Promise.all([
  read(ORACLE, "getAssetsPrices", [reserves]),
  read(d.ShieldVault, "totalAssets"),
  ...users.flatMap((u) => [
    read(POOL, "getUserAccountData", [u]),
    read(POOL, "getUserEMode", [u]),
    read(d.Repricer, "quote", [u]),
    read(d.Executor, "previewExit", [u]),
  ]),
]);
console.log(`fork warmed: ${reserves.length} Aave reserves for ${users.length} accounts in ${((Date.now() - started) / 1000).toFixed(1)} s`);
