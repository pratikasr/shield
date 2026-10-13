"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { usePathname } from "next/navigation";
import { BlockChip } from "@/components/cartoon/block-ticker";
import { AddressAvatar } from "@/components/data/avatar";
import { useChainFreshness } from "@/hooks/useLiveBlock";
import { isTestnet } from "@/lib/chains";
import { isFork } from "@/lib/env";
import { truncateHex } from "@/lib/format";
import { HeaderBar, navFor } from "./header-bar";

/** The latest proposed block on the chain the app reads: proof the page is live, not a mock. */
function NetworkChip() {
  const { block, stale } = useChainFreshness();
  return (
    <BlockChip
      block={block}
      tone={block === undefined ? "off" : stale || isFork ? "warn" : "live"}
      name={isFork ? "Local fork, block" : stale ? "Reconnecting, block" : isTestnet ? "Monad testnet block" : "Monad block"}
      short={isFork ? "Fork" : stale ? "Reconnecting" : isTestnet ? "Test" : "Block"}
      title={
        stale
          ? "No new block for over two seconds: reconnecting to the Monad RPC"
          : isFork
            ? "Reading a local fork of Monad mainnet (test rehearsal)"
            : isTestnet
              ? "Latest proposed block on Monad testnet"
              : "Latest proposed block on Monad mainnet"
      }
    />
  );
}

/** The wallet as a cartoon pill: connect, wrong network (one tap to switch), or the connected address. */
export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openConnectModal, openChainModal, mounted }) => {
        if (!mounted)
          return (
            <span className="c-wallet invisible" aria-hidden>
              Connect wallet
            </span>
          );
        if (!account)
          return (
            <button type="button" className="c-wallet" data-tone="connect" onClick={openConnectModal}>
              Connect wallet
            </button>
          );
        if (chain?.unsupported)
          return (
            <button type="button" className="c-wallet" data-tone="wrong" onClick={openChainModal}>
              {chain.name ? `On ${chain.name}: switch to Monad` : "Switch to Monad"}
            </button>
          );
        return (
          <button type="button" className="c-wallet" onClick={openAccountModal} aria-label={`Wallet ${account.address}, open account`}>
            <AddressAvatar address={account.address} size={22} className="c-wallet-face" />
            {truncateHex(account.address, 4, 4)}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  return (
    <HeaderBar
      active={navFor(pathname)}
      end={
        <>
          <NetworkChip />
          <WalletButton />
        </>
      }
    />
  );
}
