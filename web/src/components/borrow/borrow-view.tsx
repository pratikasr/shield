"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Eye, ShieldCheck, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { CoverManage, CoverSetup, CoverUnavailable, ExitSummary } from "@/components/borrow/cover-panel";
import { ActivityPanel, exitRows, useBorrowerHistory } from "@/components/borrow/history";
import { PositionHeader, PositionPanel, PositionSkeleton, ReservesTable, pickCollateral } from "@/components/borrow/position-panel";
import { SourcesPanel } from "@/components/borrow/sources-panel";
import { HashLink } from "@/components/data/hash-link";
import { TokenPair } from "@/components/data/token";
import { useWrongNetwork } from "@/components/shell/network-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAavePosition } from "@/hooks/useAavePosition";
import { useChainExit } from "@/hooks/useChainExit";
import { useShieldPosition } from "@/hooks/useShieldPosition";
import { isDeployed } from "@/lib/env";
import { formatUsd, toNumber, truncateHex } from "@/lib/format";

function Notice({ icon, title, children, action, footer }: { icon?: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl py-6 sm:py-12">
      <div className="panel px-6 py-10 text-center sm:px-12">
        {icon && <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-raised text-foreground">{icon}</div>}
        <h1 className="text-[1.5rem] font-semibold tracking-[-0.01em]">{title}</h1>
        <div className="mx-auto mt-3 max-w-md text-muted-foreground">{children}</div>
        {action && <div className="mt-7 flex justify-center">{action}</div>}
      </div>
      {footer}
    </div>
  );
}

/** Read-only view of any address, for anyone without that wallet (a judge checking the demo position). */
function WatchForm() {
  const [value, setValue] = useState("");
  const valid = isAddress(value.trim());
  return (
    <form
      className="mx-auto mt-5 flex max-w-xl gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) window.location.assign(`/app/borrow?address=${getAddress(value.trim())}`);
      }}
    >
      <label htmlFor="watch" className="sr-only">
        Address to view
      </label>
      <Input id="watch" className="h-11 bg-card num" placeholder="Or view any address read only, 0x..." value={value} onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" variant="outline" className="h-11 bg-card" disabled={!valid}>
        <Eye className="size-4" aria-hidden />
        View
      </Button>
    </form>
  );
}

export function BorrowView() {
  const { address, isConnected } = useAccount();
  // Read after mount: useSearchParams would make Next skip server rendering of the whole page.
  const [watchParam, setWatchParam] = useState("");
  useEffect(() => {
    const read = () => setWatchParam(new URLSearchParams(window.location.search).get("address") ?? "");
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const watching = !isConnected && isAddress(watchParam) ? (getAddress(watchParam) as Address) : undefined;
  const viewer = isConnected ? address : watching;
  const wrongNetwork = useWrongNetwork();
  const { position, isLoading, error } = useAavePosition(viewer);
  const collateral = position ? pickCollateral(position) : undefined;
  const { cover, refetch } = useShieldPosition(viewer, collateral?.aToken);
  const history = useBorrowerHistory(viewer);
  const chainExit = useChainExit(viewer, cover);
  const [previewTrigger, setPreviewTrigger] = useState<number>();
  const onTrigger = useCallback((t: number) => setPreviewTrigger(t), []);

  if (!isDeployed) {
    return (
      <Notice title="Shield is not configured">
        This build has no contract addresses. Set NEXT_PUBLIC_SHIELD_REGISTRY, _REPRICER, _EXECUTOR and _VAULT, or run scripts/web-env.sh with a
        deployment file.
      </Notice>
    );
  }
  if (!viewer) {
    return (
      <Notice
        icon={<Wallet className="size-5" aria-hidden />}
        title="Connect the wallet that borrows on Aave"
        action={
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <Button size="lg" className="h-12 px-6" onClick={openConnectModal}>
                Connect wallet
              </Button>
            )}
          </ConnectButton.Custom>
        }
        footer={<WatchForm />}
      >
        Shield reads your Aave V3 position on Monad, shows how close it is to liquidation, and lets you set an early exit at 1% instead of
        Aave&rsquo;s liquidation penalty.
      </Notice>
    );
  }
  if (error) {
    return (
      <Notice title="Could not read Aave" action={<Button onClick={() => location.reload()}>Reload</Button>}>
        The Monad RPC did not answer: {error.message.split("\n")[0]}. Check your connection and reload.
      </Notice>
    );
  }
  if (isLoading || !position) return <PositionSkeleton />;
  if (!position.hasPosition) {
    return (
      <Notice
        icon={<TokenPair a="AAVE" b="MON" size={26} />}
        title="No Aave position on this wallet"
        action={
          <Button asChild size="lg" className="h-12 px-6">
            <a href="https://app.aave.com/?marketName=proto_monad_v3" target="_blank" rel="noreferrer">
              Open Aave on Monad
            </a>
          </Button>
        }
      >
        Supply WETH or cbBTC and borrow USDC on Aave V3 Monad, then come back to set a trigger.
      </Notice>
    );
  }

  const exits = exitRows(history.data, chainExit.data);
  const lastExit = exits[0];
  const exited = Boolean(cover?.exited && !cover.active && lastExit);
  const premiumHistory = (history.data?.Reprice ?? []).slice().reverse().map((r) => toNumber(BigInt(r.premiumPerBlock), 18));
  const canCover = position.eMode === 0 && collateral && (position.reserves.find((r) => r.symbol === "USDC")?.borrowed ?? 0) > 0;

  return (
    <div className="grid gap-8">
      {watching && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <Eye className="size-4 text-muted-foreground" aria-hidden />
            Viewing <span className="font-medium num">{truncateHex(watching)}</span>, read only. Connect that wallet to change its cover.
          </span>
          <a href="/app/borrow" className="rounded-sm font-medium underline underline-offset-4">
            Stop viewing
          </a>
        </div>
      )}

      <PositionHeader position={position} cover={cover} title={watching ? "Aave position" : "Your Aave position"} />

      {exited && lastExit && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-safe/30 bg-safe-soft px-5 py-4">
          <p className="flex flex-wrap items-center gap-x-2 text-[0.9375rem]">
            <ShieldCheck className="size-5 text-safe" aria-hidden />
            <span>
              Exited in block {Number(lastExit.blockNumber).toLocaleString("en-US")}: penalty avoided{" "}
              <strong className="font-semibold text-safe num">{formatUsd(toNumber(BigInt(lastExit.savedVsAave), 6))}</strong>.
            </span>
          </p>
          <HashLink value={lastExit.txHash} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_auto_1fr]">
        <div className="min-w-0 lg:col-start-1">
          <PositionPanel position={position} cover={cover} previewTrigger={cover?.active ? undefined : previewTrigger} premiumHistory={premiumHistory} />
        </div>
        <aside className="grid min-w-0 gap-4 self-start lg:sticky lg:top-24 lg:col-start-2 lg:row-span-3 lg:row-start-1" aria-label="Cover">
          {exited && lastExit && collateral && (
            <ExitSummary
              savedUsd={toNumber(BigInt(lastExit.savedVsAave), 6)}
              repaidUsd={toNumber(BigInt(lastExit.repaid), 6)}
              hfBefore={toNumber(BigInt(lastExit.healthFactorBefore), 18)}
              hfAfter={toNumber(BigInt(lastExit.healthFactorAfter), 18)}
              symbol={collateral.symbol}
            />
          )}
          {watching ? (
            <WatchedCover cover={cover} />
          ) : !canCover ? (
            <CoverUnavailable position={position} />
          ) : cover?.active ? (
            <CoverManage user={address!} cover={cover} collateral={collateral!} disabled={wrongNetwork} onDone={() => void refetch()} />
          ) : (
            <CoverSetup
              user={address!}
              position={position}
              collateral={collateral!}
              cover={cover}
              disabled={wrongNetwork}
              onTriggerChange={onTrigger}
              onDone={() => void refetch()}
            />
          )}
        </aside>
        <div className="min-w-0 lg:col-start-1">
          <ActivityPanel history={history.data} isLoading={history.isLoading} error={history.error} chainExit={chainExit.data} />
        </div>
        <div className="grid min-w-0 gap-6 self-start lg:col-start-1">
          <ReservesTable position={position} />
          <SourcesPanel collateral={collateral} />
        </div>
      </div>
    </div>
  );
}

function WatchedCover({ cover }: { cover?: import("@/hooks/useShieldPosition").Cover }) {
  const state = !cover?.active ? (cover?.exited ? "Exited" : "No cover") : cover.lapsed ? "Unprotected" : "Protected";
  return (
    <section className="panel p-5 sm:p-6" aria-label="Cover">
      <h2 className="text-lg font-semibold">Shield cover</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className={state === "Protected" ? "font-semibold text-safe" : state === "Unprotected" ? "font-semibold text-caution" : "font-semibold"}>{state}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Trigger</dt>
          <dd className={cover?.active ? "reading font-semibold text-caution" : "reading font-semibold text-muted-foreground"}>
            {cover?.active ? cover.trigger.toFixed(2) : "Not set"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Prepaid</dt>
          <dd className="reading font-semibold">{formatUsd(cover?.prepaidUsd ?? 0)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Premium paid</dt>
          <dd className="reading font-semibold">{formatUsd(cover?.premiumPaidUsd ?? 0)}</dd>
        </div>
      </dl>
    </section>
  );
}
