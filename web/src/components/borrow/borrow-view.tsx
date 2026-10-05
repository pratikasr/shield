"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useCallback, useEffect, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { CoverManage, CoverSetup, CoverUnavailable } from "@/components/borrow/cover-panel";
import { ExitHistory, RepriceHistory, useBorrowerHistory } from "@/components/borrow/history";
import { PositionPanel, PositionSkeleton, ReservesTable, pickCollateral } from "@/components/borrow/position-panel";
import { useWrongNetwork } from "@/components/shell/network-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HashLink } from "@/components/data/hash-link";
import { useAavePosition } from "@/hooks/useAavePosition";
import { useChainExit } from "@/hooks/useChainExit";
import { useShieldPosition } from "@/hooks/useShieldPosition";
import { isDeployed } from "@/lib/env";
import { formatUsd, toNumber, truncateHex } from "@/lib/format";

function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border bg-card p-6 text-center sm:p-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-3 text-muted-foreground">{children}</div>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

/** Read-only view of any address, for anyone without that wallet (a judge checking the demo position). */
function WatchForm() {
  const [value, setValue] = useState("");
  const valid = isAddress(value.trim());
  return (
    <form
      className="mx-auto mt-6 flex max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) window.location.assign(`/app/borrow?address=${getAddress(value.trim())}`);
      }}
    >
      <label htmlFor="watch" className="sr-only">
        Address to view
      </label>
      <Input id="watch" className="h-10 num" placeholder="Or view an address, 0x..." value={value} onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" variant="outline" disabled={!valid}>
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
        This build has no contract addresses. Set NEXT_PUBLIC_SHIELD_REGISTRY, _REPRICER, _EXECUTOR and _VAULT, or run
        scripts/web-env.sh with a deployment file.
      </Notice>
    );
  }
  if (!viewer) {
    return (
      <>
        <Notice
          title="Connect the wallet that borrows on Aave"
          action={<ConnectButton.Custom>{({ openConnectModal }) => <Button size="lg" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>}
        >
          Shield reads your Aave V3 position on Monad, shows how close it is to liquidation, and lets you set an early exit at
          1% instead of Aave&rsquo;s liquidation bonus.
        </Notice>
        <WatchForm />
      </>
    );
  }
  if (error) {
    return (
      <Notice title="Could not read Aave" action={<Button onClick={() => location.reload()}>Reload</Button>}>
        The Monad RPC did not answer: {error.message.split("\n")[0]}. Check your connection and reload.
      </Notice>
    );
  }
  if (isLoading || !position) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <PositionSkeleton />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }
  if (!position.hasPosition) {
    return (
      <Notice
        title="No Aave position on this wallet"
        action={
          <Button asChild size="lg">
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

  const lastExit = history.data?.Exit[0];
  const premiumHistory = (history.data?.Reprice ?? []).slice().reverse().map((r) => toNumber(BigInt(r.premiumPerBlock), 18));
  const unavailable = <CoverUnavailable position={position} />;
  const canCover = position.eMode === 0 && collateral && (position.reserves.find((r) => r.symbol === "USDC")?.borrowed ?? 0) > 0;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:col-start-1">
        {watching && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-raised px-4 py-3 text-sm">
            <span>
              Viewing <span className="num">{truncateHex(watching)}</span>, read only. Connect that wallet to change its cover.
            </span>
            <a href="/app/borrow" className="rounded-sm underline underline-offset-4">
              Stop viewing
            </a>
          </div>
        )}
        <div>
          <h1 className="text-[1.75rem] font-semibold">{watching ? "Aave position" : "Your Aave position"}</h1>
          {cover?.exited && !cover.active && (lastExit || chainExit.data) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-base" role="status">
              <span>
                Exited in block {(chainExit.data?.blockNumber ?? BigInt(lastExit!.blockNumber)).toLocaleString("en-US")}: penalty avoided{" "}
                <strong className="reading text-safe">
                  {formatUsd(toNumber(chainExit.data?.savedVsAave ?? BigInt(lastExit!.savedVsAave), 6))}
                </strong>
                .
              </span>
              <HashLink value={chainExit.data?.txHash ?? lastExit!.txHash} />
            </p>
          )}
        </div>
        <PositionPanel position={position} cover={cover} previewTrigger={cover?.active ? undefined : previewTrigger} premiumHistory={premiumHistory} />
      </div>
      <aside className="min-w-0 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="Cover">
        {watching ? (
          <WatchedCover cover={cover} />
        ) : !canCover ? (
          unavailable
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
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:col-start-1">
        <ExitHistory history={history.data} isLoading={history.isLoading} error={history.error} chainExit={chainExit.data} />
        <RepriceHistory history={history.data} />
        <ReservesTable position={position} />
      </div>
    </div>
  );
}

function WatchedCover({ cover }: { cover?: import("@/hooks/useShieldPosition").Cover }) {
  const state = !cover?.active ? (cover?.exited ? "Exited" : "No cover") : cover.lapsed ? "Unprotected" : "Protected";
  return (
    <section className="rounded-xl border bg-card p-5 sm:p-6" aria-label="Cover">
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
