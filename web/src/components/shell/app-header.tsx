"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveBlock } from "@/hooks/useLiveBlock";
import { isFork } from "@/lib/env";
import { truncateHex } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme";
import { Wordmark } from "./wordmark";

const NAV = [
  { href: "/app/borrow", label: "Borrow" },
  { href: "/app/vault", label: "Provide liquidity" },
];

function BlockPill() {
  const { data: block } = useLiveBlock();
  return (
    <span
      className={cn(
        "hidden items-center gap-2 rounded-md border px-2.5 py-1 text-[0.8125rem] text-muted-foreground md:inline-flex num",
        isFork && "border-caution/40 text-caution",
      )}
      title={isFork ? "Reading a local fork of Monad mainnet (test rehearsal)" : "Latest proposed block on Monad"}
    >
      <span className={cn("size-1.5 rounded-full", block ? "bg-safe" : "bg-muted-foreground")} aria-hidden />
      {isFork ? "Local fork" : "Monad"}
      <span className="text-foreground">{block ? block.toLocaleString("en-US") : "connecting"}</span>
    </span>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-8">
          <Link href="/" className="rounded-md" aria-label="Shield home">
            <Wordmark />
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
                    "whitespace-nowrap rounded-md px-2 py-2 text-sm sm:px-3",
                    active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n.href === "/app/vault" ? (
                    <>
                      <span className="sm:hidden">Liquidity</span>
                      <span className="hidden sm:inline">{n.label}</span>
                    </>
                  ) : (
                    n.label
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
          <BlockPill />
          <ThemeToggle />
          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openConnectModal, openChainModal, mounted }) => {
              if (!mounted) return <Button disabled aria-hidden className="w-24" />;
              if (!account) return <Button onClick={openConnectModal}>Connect</Button>;
              if (chain?.unsupported) {
                return (
                  <Button variant="destructive" onClick={openChainModal}>
                    Wrong network
                  </Button>
                );
              }
              return (
                <Button variant="outline" onClick={openAccountModal} className="num px-3 sm:px-4">
                  <span className="sm:hidden">{truncateHex(account.address, 4, 2)}</span>
                  <span className="hidden sm:inline">{truncateHex(account.address, 4, 4)}</span>
                </Button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
    </header>
  );
}
