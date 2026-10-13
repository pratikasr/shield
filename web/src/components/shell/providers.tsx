"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, connectorsForWallets, lightTheme } from "@rainbow-me/rainbowkit";
import type { Theme, Wallet } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { monadTestnet } from "viem/chains";
import { createConfig, createConnector, http, useAccount, WagmiProvider } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import { monadMainnet, supportedChains } from "@/lib/chains";
import { isFork } from "@/lib/env";
import { setWalletCookie } from "@/lib/wallet-cookie";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/**
 * Test builds against a local fork set NEXT_PUBLIC_E2E_ACCOUNT to one of Anvil's unlocked accounts; this adds a
 * wallet that sends through the fork's own signer so Playwright can drive the real flows. It is included only when
 * the RPC is also local (127.0.0.1 or localhost), so a stray variable in a production build cannot add it.
 */
const e2eAccount = isFork && /^0x[0-9a-fA-F]{40}$/.test(process.env.NEXT_PUBLIC_E2E_ACCOUNT ?? "") ? (process.env.NEXT_PUBLIC_E2E_ACCOUNT as `0x${string}`) : undefined;
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

/**
 * MetaMask through its browser extension only. RainbowKit's own MetaMask entry uses wagmi's MetaMask SDK connector,
 * which loads the SDK (about 450 KB of script) on every page as soon as the app checks for a returning wallet, and
 * cost the app pages several Lighthouse points. This keeps RainbowKit's name, icon and install links and connects
 * with the injected provider, as the extension expects. MetaMask Mobile still works in its in-app browser, and
 * through WalletConnect when a project id is set.
 */
const metaMaskExtensionWallet = (params: Parameters<typeof metaMaskWallet>[0]): Wallet => {
  const { id, name, rdns, iconUrl, iconAccent, iconBackground, installed, downloadUrls, extension } = metaMaskWallet(params);
  return {
    id,
    name,
    rdns,
    iconUrl,
    iconAccent,
    iconBackground,
    installed,
    downloadUrls,
    extension,
    createConnector: (details) => createConnector((config) => ({ ...injected({ target: "metaMask" })(config), ...details })),
  };
};

const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: [
        ...(e2eAccount ? [forkTestWallet] : []),
        injectedWallet,
        metaMaskExtensionWallet,
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
    // viem aborts a request after 10 s by default and the read starts over. A slow public RPC (or a cold fork fetching
    // state upstream) can need longer for the first batch, so it gets 30 s to finish once instead of never.
    [monadMainnet.id]: http(monadMainnet.rpcUrls.default.http[0], { batch: { wait: 8 }, timeout: 30_000 }),
    [monadTestnet.id]: http(),
  },
  ssr: true,
});

/** RainbowKit's modal in the cartoon style: Grape accent, Ink text and outlines, hard shadows, Rubik. */
function cartoonTheme(): Theme {
  const base = lightTheme({ accentColor: "#6a4cf5", accentColorForeground: "#ffffff", borderRadius: "large", overlayBlur: "small" });
  return {
    ...base,
    colors: {
      ...base.colors,
      modalBackground: "#ffffff",
      modalBorder: "#1b1430",
      modalText: "#1b1430",
      modalTextSecondary: "#4a4363",
      modalTextDim: "#4a4363",
      modalBackdrop: "rgba(27, 20, 48, 0.45)",
      actionButtonBorder: "#1b1430",
      actionButtonSecondaryBackground: "#e2f2ff",
      closeButton: "#1b1430",
      closeButtonBackground: "#e2f2ff",
      generalBorder: "#1b1430",
      generalBorderDim: "rgba(27, 20, 48, 0.18)",
      menuItemBackground: "#e7e1ff",
      profileForeground: "#e2f2ff",
      profileAction: "#ffffff",
      profileActionHover: "#e7e1ff",
      selectedOptionBorder: "#4630c2",
      connectButtonBackground: "#ffffff",
      connectButtonText: "#1b1430",
      error: "#c42b1c",
    },
    fonts: { body: 'var(--font-rubik), system-ui, -apple-system, "Segoe UI", sans-serif' },
    radii: { ...base.radii, modal: "18px", modalMobile: "18px", actionButton: "14px", connectButton: "14px", menuButton: "14px" },
    shadows: { ...base.shadows, dialog: "4px 4px 0 #1b1430", connectButton: "2px 2px 0 #1b1430", profileDetailsAction: "2px 2px 0 #1b1430", selectedOption: "2px 2px 0 #4630c2", selectedWallet: "2px 2px 0 #4630c2", walletLogo: "none" },
  };
}
const CARTOON_THEME = cartoonTheme();

function Rainbow({ children }: { children: ReactNode }) {
  return (
    <RainbowKitProvider theme={CARTOON_THEME} initialChain={e2eWrongChain ? monadTestnet : monadMainnet} modalSize="compact">
      {children}
    </RainbowKitProvider>
  );
}

/** Keeps lib/wallet-cookie.ts in step with the wallet: set on connect, cleared on a disconnect or a failed restore. */
function WalletCookie() {
  const { status } = useAccount();
  const last = useRef(status);
  useEffect(() => {
    if (status === "connected") setWalletCookie(true);
    else if (status === "disconnected" && last.current !== "disconnected") setWalletCookie(false);
    last.current = status;
  }, [status]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletCookie />
        <Rainbow>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        </Rainbow>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
