"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AddressAvatar } from "@/components/data/avatar";
import { TokenIcon } from "@/components/data/token";
import { Button } from "@/components/ui/button";
import { useChainFreshness } from "@/hooks/useLiveBlock";
import { isFork } from "@/lib/env";
import { truncateHex } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme";
import { Wordmark } from "./wordmark";

const NAV = [
  { href: "/app/borrow", label: "Protect" },
  { href: "/app/vault", label: "Earn" },
];

/** The network the app reads, with the latest proposed block: proof the page is live, not a mock. */
function NetworkChip() {
  const { block, stale } = useChainFreshness();
  const live = block !== undefined && !stale;
  return (
    <span
      className={cn(
        "hidden h-9 items-center gap-2 rounded-full border bg-card px-3 text-[0.8125rem] md:inline-flex num",
        (isFork || stale) && "border-caution/50 bg-caution-soft",
      )}
      title={
        stale
          ? "No new block for over two seconds: reconnecting to the Monad RPC"
          : isFork
            ? "Reading a local fork of Monad mainnet (test rehearsal)"
            : "Latest proposed block on Monad mainnet"
      }
    >
      <TokenIcon symbol="MON" size={16} />
      <span className={cn("font-medium", (isFork || stale) && "text-caution")}>{isFork ? "Local fork" : "Monad"}</span>
      <span className="relative flex size-1.5" aria-hidden>
        {/* The dot pings only while blocks arrive; a frozen block never pulses green. */}
        {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-safe opacity-50" />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", live ? "bg-safe" : stale ? "bg-caution" : "bg-muted-foreground")} />
      </span>
      <span className="text-muted-foreground">{block !== undefined ? `${stale ? "Reconnecting, " : ""}${block.toLocaleString("en-US")}` : "connecting"}</span>
    </span>
  );
}

function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openConnectModal, openChainModal, mounted }) => {
        if (!mounted) return <Button disabled aria-hidden className="w-32 opacity-0" />;
        if (!account) return <Button onClick={openConnectModal}>Connect wallet</Button>;
        if (chain?.unsupported) {
          return (
            <Button variant="destructive" onClick={openChainModal}>
              Wrong network
            </Button>
          );
        }
        return (
          <Button variant="outline" onClick={openAccountModal} className="gap-2 rounded-full bg-card pl-1.5 pr-3.5 num">
            <AddressAvatar address={account.address} size={26} />
            <span className="sm:hidden">{truncateHex(account.address, 4, 2)}</span>
            <span className="hidden sm:inline">{truncateHex(account.address, 4, 4)}</span>
          </Button>
        );
      }}
    </ConnectButton.Custom>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[76rem] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-8">
          <Link href="/" className="rounded-md" aria-label="Shield home">
            <Wordmark compact />
          </Link>
          <nav aria-label="App" className="flex items-center gap-1">
            {NAV.map((n) => {
              const active = pathname?.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "hit relative rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n.label}
                  {active && <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-foreground" aria-hidden />}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <NetworkChip />
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
