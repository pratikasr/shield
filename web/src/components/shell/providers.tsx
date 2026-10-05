"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, connectorsForWallets, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import type { Wallet } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { monadTestnet } from "viem/chains";
import { createConfig, createConnector, http, WagmiProvider } from "wagmi";
import { mock } from "wagmi/connectors";
import { monadMainnet, supportedChains } from "@/lib/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/**
 * Test builds against a local fork set NEXT_PUBLIC_E2E_ACCOUNT to one of Anvil's unlocked accounts; this adds a
 * wallet that sends through the fork's own signer so Playwright can drive the real flows. Production builds
 * leave the variable empty and never include it.
 */
const e2eAccount = process.env.NEXT_PUBLIC_E2E_ACCOUNT as `0x${string}` | undefined;
/** Fork test builds only: start the test wallet on Monad testnet to exercise the wrong-network guard. */
const e2eWrongChain = process.env.NEXT_PUBLIC_E2E_WRONG_CHAIN === "1";
const forkTestWallet = (): Wallet => ({
  id: "fork-test-wallet",
  name: "Fork test wallet",
  iconBackground: "#0b1220",
  iconUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyOCAyOCI+PHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiBmaWxsPSIjMGUxNDI0Ii8+PHJlY3QgeD0iMTMiIHk9IjQiIHdpZHRoPSIzIiBoZWlnaHQ9IjIwIiBmaWxsPSIjZmZiMjI0Ii8+PC9zdmc+",
  createConnector: (details) =>
    createConnector((config) => ({ ...mock({ accounts: [e2eAccount!], features: { reconnect: true } })(config), ...details })),
});

const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: [
        ...(e2eAccount ? [forkTestWallet] : []),
        injectedWallet,
        metaMaskWallet,
        rabbyWallet,
        ...(projectId ? [walletConnectWallet] : []),
      ],
    },
  ],
  { appName: "Shield", projectId: projectId || "shield-injected-only" },
);

export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors,
  pollingInterval: 400,
  batch: { multicall: { wait: 8 } },
  transports: {
    [monadMainnet.id]: http(monadMainnet.rpcUrls.default.http[0], { batch: { wait: 8 } }),
    [monadTestnet.id]: http(),
  },
  ssr: true,
});

function Rainbow({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const accent = { accentColor: dark ? "#f2f4f7" : "#0b1220", accentColorForeground: dark ? "#0b0d12" : "#ffffff", borderRadius: "medium" as const, fontStack: "system" as const };
  return (
    <RainbowKitProvider
      theme={dark ? darkTheme(accent) : lightTheme(accent)}
      initialChain={e2eWrongChain ? monadTestnet : monadMainnet}
      modalSize="compact"
    >
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Rainbow>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        </Rainbow>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
