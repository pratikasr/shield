import { monad, monadTestnet } from "viem/chains";
import type { Chain } from "viem";

/**
 * Chains the app connects to. A local Anvil fork of mainnet keeps chain id 143, so the RPC
 * comes from NEXT_PUBLIC_MONAD_RPC_URL when set (tests point it at the fork).
 */
const mainnetRpc = process.env.NEXT_PUBLIC_MONAD_RPC_URL;

export const monadMainnet: Chain = mainnetRpc
  ? { ...monad, rpcUrls: { default: { http: [mainnetRpc] } } }
  : monad;

export const supportedChains = [monadMainnet, monadTestnet] as const;
