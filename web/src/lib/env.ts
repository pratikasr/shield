import { getAddress, type Address } from "viem";

/**
 * Deployment addresses and endpoints. Set at build time from NEXT_PUBLIC_* variables; `scripts/web-env.sh`
 * writes them from contracts/deployments/<name>.json.
 */
function addr(value: string | undefined): Address | undefined {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? getAddress(value.toLowerCase()) : undefined;
}

export const shield = {
  registry: addr(process.env.NEXT_PUBLIC_SHIELD_REGISTRY),
  repricer: addr(process.env.NEXT_PUBLIC_SHIELD_REPRICER),
  executor: addr(process.env.NEXT_PUBLIC_SHIELD_EXECUTOR),
  vault: addr(process.env.NEXT_PUBLIC_SHIELD_VAULT),
};

export const isDeployed = Boolean(shield.registry && shield.repricer && shield.executor && shield.vault);

export const envioUrl = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL || undefined;

/** Explorer for links; MonadVision by default. */
export const explorerUrl = (process.env.NEXT_PUBLIC_EXPLORER_URL || "https://monadvision.com").replace(/\/$/, "");

const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL || "";

/** True when the app reads a local fork (test rehearsals only); the UI says so in the header. */
export const isFork = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(rpcUrl);

/** Aave V3 Monad, verified 5 Oct 2026 (docs/TECH-DECISIONS.md). */
export const aave = {
  pool: getAddress("0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef"),
  oracle: getAddress("0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf"),
  dataProvider: getAddress("0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad"),
  usdc: getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603"),
  weth: getAddress("0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242"),
  cbbtc: getAddress("0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b"),
};

/** Pyth on Monad mainnet, verified 5 Oct 2026 (docs/TECH-DECISIONS.md). */
export const pythAddress = getAddress("0x2880aB155794e7179c9eE2e38200202908C17B43");

/** Multicall3, deployed on Monad mainnet at the canonical address; its timestamp read gives chain time. */
export const multicall3 = getAddress("0xcA11bde05977b3631167028862bE2a173976CA11");

/** Display names for collateral the registry lists, and the asset Pyth prices it in. */
export const collateralInfo: Record<string, { symbol: string; decimals: number; priceName: string }> = {
  [aave.weth.toLowerCase()]: { symbol: "WETH", decimals: 18, priceName: "ETH" },
  [aave.cbbtc.toLowerCase()]: { symbol: "cbBTC", decimals: 8, priceName: "BTC" },
};

export function collateralName(asset: string | undefined): { symbol: string; decimals: number; priceName: string } {
  return (asset && collateralInfo[asset.toLowerCase()]) || { symbol: "collateral", decimals: 18, priceName: "the collateral" };
}
