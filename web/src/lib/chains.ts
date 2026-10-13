import { monad, monadTestnet } from "viem/chains";
import type { Chain } from "viem";

/**
 * The chain the app runs on: Monad mainnet (143) by default, or Monad testnet (10143) for the staging deployment on an
 * Aave V3 market Shield deployed there from Aave's code (NEXT_PUBLIC_CHAIN_ID=10143, ADR-040). A local Anvil fork of
 * mainnet keeps chain id 143, so the RPC comes from NEXT_PUBLIC_MONAD_RPC_URL when set (tests point it at the fork).
 */
export const isTestnet = process.env.NEXT_PUBLIC_CHAIN_ID === "10143";

const rpc = process.env.NEXT_PUBLIC_MONAD_RPC_URL;
const base = isTestnet ? monadTestnet : monad;

export const appChain: Chain = rpc ? { ...base, rpcUrls: { default: { http: [rpc] } } } : base;

/** The other Monad network, listed so a wallet on it gets the one-tap switch instead of an unknown chain. */
export const otherChain: Chain = isTestnet ? monad : monadTestnet;

/** How the copy names the network to switch to. */
export const networkName = isTestnet ? "Monad testnet" : "Monad";

export const supportedChains = [appChain, otherChain] as const;
