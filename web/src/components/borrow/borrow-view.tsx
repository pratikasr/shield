"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Eye, ShieldCheck, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { CoverManage } from "@/components/borrow/cover-manage";
import { CoverSetup, CoverUnavailable } from "@/components/borrow/cover-setup";
import { ExitSummary, PrepaidCard, WatchedCover } from "@/components/borrow/cover-extras";
import { AAVE_APP, KEEPER_IDLE_BLOCKS } from "@/components/borrow/cover-shared";
import { ActivityPanel, HfHistorySkeleton, exitRows, useBorrowerHistory } from "@/components/borrow/history";
import { PositionHeader, PositionPanel, PositionSkeleton, ReservesTable, pickCollateral } from "@/components/borrow/position-panel";
import { SourcesPanel } from "@/components/borrow/sources-panel";
import { HashLink } from "@/components/data/hash-link";
import { TokenPair } from "@/components/data/token";
import { useWrongNetwork } from "@/components/shell/network-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAavePosition } from "@/hooks/useAavePosition";
import { useChainExit } from "@/hooks/useChainExit";
import { useLiveBlock, useNow } from "@/hooks/useLiveBlock";
import { useShieldConfig } from "@/hooks/useShieldConfig";
import { useShieldPosition } from "@/hooks/useShieldPosition";
import { useTx } from "@/hooks/useTx";
import { LOADING_ARM, computeArm } from "@/lib/cover-status";
import { collateralName, isDeployed } from "@/lib/env";
import { firstLine, formatUsd, toNumber, truncateHex } from "@/lib/format";

/** Below the fold and not needed for the first paint: its code loads after the page is interactive. */
const HfHistoryPanel = dynamic(() => import("@/components/borrow/hf-history"), { ssr: false, loading: () => <HfHistorySkeleton /> });

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

/**
 * The `?address=` parameter. All-lowercase or all-uppercase hex is accepted and normalised; mixed case must carry a
 * valid checksum, so a mistyped address is refused rather than silently read.
 */
export function parseWatchParam(raw: string): { address?: Address; invalid: boolean } {
  const v = raw.trim();
  if (!v) return { invalid: false };
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return { invalid: true };
  const hex = v.slice(2);
  const oneCase = hex === hex.toLowerCase() || hex === hex.toUpperCase();
  if (!oneCase && !isAddress(v, { strict: true })) return { invalid: true };
  return { address: getAddress(v.toLowerCase()), invalid: false };
}

/** Read-only view of any address, for anyone without that wallet (a judge checking the demo position). */
function WatchForm() {
  const [value, setValue] = useState("");
  const parsed = parseWatchParam(value);
  return (
    <form
      className="mx-auto mt-5 flex max-w-xl gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.address) window.location.assign(`/app/borrow?address=${parsed.address}`);
      }}
    >
      <label htmlFor="watch" className="sr-only">
        Address to view
      </label>
      <Input
        id="watch"
        className="h-11 bg-card num"
        placeholder="Or view any address read only, 0x..."
        value={value}
        aria-invalid={parsed.invalid || undefined}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" variant="outline" className="h-11 bg-card" disabled={!parsed.address}>
        <Eye className="size-4" aria-hidden />
        View
      </Button>
    </form>
  );
}

function WatchBanner({ watching, connected }: { watching: Address; connected?: Address }) {
  const other = connected !== undefined && connected.toLowerCase() !== watching.toLowerCase();
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
      <p className="flex min-w-0 items-start gap-2">
        <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {/* One text run, so no flex gap lands before the comma. */}
        <span className="min-w-0">
          {other ? (
            <>
              Connected as <span className="font-medium num">{truncateHex(connected!)}</span>, viewing <span className="font-medium num">{truncateHex(watching)}</span> read
              only.
            </>
          ) : (
            <>
              Viewing <span className="font-medium num">{truncateHex(watching)}</span>, read only.{" "}
              {connected ? "Stop viewing to manage it from this wallet." : "Connect that wallet to change its cover."}
            </>
          )}
        </span>
      </p>
      <a href="/app/borrow" className="hit relative rounded-sm font-medium underline underline-offset-4">
        Stop viewing
      </a>
    </div>
  );
}

/** Blocks a condition has held for, counted from the first block it was seen. */
function useBlocksSince(condition: boolean, block: bigint | undefined): number {
  const since = useRef<bigint | undefined>(undefined);
  if (!condition) since.current = undefined;
  else if (since.current === undefined && block !== undefined) since.current = block;
  return condition && since.current !== undefined && block !== undefined ? Number(block - since.current) : 0;
}

/**
 * The borrower page. `initialWatch` is the `?address=` parameter and `walletHint` says a wallet was connected on the
 * last visit (lib/wallet-cookie.ts), both read by the server so the first paint needs no script.
 */
export function BorrowView({ initialWatch = "", walletHint = false }: { initialWatch?: string; walletHint?: boolean }) {
  const { address, isConnected, status } = useAccount();
  const [watchRaw, setWatchRaw] = useState(initialWatch);
  // A returning wallet is restored by wagmi just after mount: wait a moment before offering to connect. A first visit
  // gets the connect prompt at once.
  const [settled, setSettled] = useState(!walletHint);
  useEffect(() => {
    const read = () => setWatchRaw(new URLSearchParams(window.location.search).get("address") ?? "");
    window.addEventListener("popstate", read);
    const t = walletHint ? setTimeout(() => setSettled(true), 400) : undefined;
    return () => {
      window.removeEventListener("popstate", read);
      clearTimeout(t);
    };
  }, [walletHint]);
  const parsed = parseWatchParam(watchRaw);
  const watching = parsed.address;
  const connected = isConnected ? address : undefined;
  // ?address= wins over the connected wallet: the page shows what the link says, read only.
  const viewer = watching ?? connected;
  // "reconnecting" is wagmi restoring a stored wallet; "connecting" is also what a first visit shows while wagmi checks
  // for one, so it does not hide the connect prompt.
  const reconnecting = status === "reconnecting";
  const wrongNetwork = useWrongNetwork();

  const { config } = useShieldConfig();
  const aavePos = useAavePosition(viewer);
  const position = aavePos.position;
  const coverableKey = config && position ? config.assets.map((a) => a.asset).join() + position.allReserves.length : "";
  const coverable = useMemo(
    () =>
      config && position
        ? config.assets.flatMap((a) => {
            const r = position.allReserves.find((x) => x.asset.toLowerCase() === a.asset.toLowerCase());
            return r ? [{ asset: a.asset, aToken: r.aToken }] : [];
          })
        : [],
    // The list depends only on the registry's assets and the reserve list, not on balances that move every block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coverableKey],
  );
  const shieldPos = useShieldPosition(viewer, coverable);
  const cover = shieldPos.cover;
  const collateral = position ? pickCollateral(position, cover, config) : undefined;
  const history = useBorrowerHistory(viewer);
  const chainExit = useChainExit(viewer, cover);
  const lifecycle = useTx();
  const { data: block } = useLiveBlock();
  const now = useNow(1000);
  const chainNow = cover?.chainTime !== undefined ? cover.chainTime + Math.max(now - cover.readAt, 0) / 1000 : undefined;
  const arm = !cover && shieldPos.isLoading ? LOADING_ARM : computeArm({ cover, position, collateral, config, chainNow, block });
  const keeperIdle = useBlocksSince(arm.kind === "due", block) >= KEEPER_IDLE_BLOCKS;
  const [previewTrigger, setPreviewTrigger] = useState<number>();
  const onTrigger = useCallback((t: number) => setPreviewTrigger(t), []);
  const refetchShield = shieldPos.refetch;
  const refetchAave = aavePos.refetch;
  const refetch = useCallback(() => Promise.all([refetchShield(), refetchAave()]), [refetchShield, refetchAave]);

  if (!isDeployed) {
    return (
      <Notice title="Shield is not configured">
        This build has no contract addresses. Set NEXT_PUBLIC_SHIELD_REGISTRY, _REPRICER, _EXECUTOR and _VAULT, or run scripts/web-env.sh with a deployment file.
      </Notice>
    );
  }
  if (!viewer && (reconnecting || !settled)) return <PositionSkeleton />;
  if (parsed.invalid) {
    return (
      <Notice
        icon={<Eye className="size-5" aria-hidden />}
        title="Invalid address"
        action={
          <Button asChild variant="outline" className="bg-card">
            <a href="/app/borrow">Stop viewing</a>
          </Button>
        }
        footer={<WatchForm />}
      >
        <span className="break-all">&ldquo;{watchRaw}&rdquo;</span> is not a valid Monad address. Check it, including its upper and lower case letters, and try again.
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
        Shield reads your Aave V3 position on Monad, shows how close it is to liquidation, and lets you set an early exit at 1% instead of Aave&rsquo;s
        liquidation penalty.
      </Notice>
    );
  }

  const banner = watching ? <WatchBanner watching={watching} connected={connected} /> : null;
  if (!position) {
    if (aavePos.error) {
      return (
        <div className="grid gap-8">
          {banner}
          <Notice title="Could not read Aave" action={<Button onClick={() => location.reload()}>Reload</Button>}>
            The Monad RPC did not answer: {firstLine(aavePos.error.message)}. Check your connection and reload.
          </Notice>
        </div>
      );
    }
    return (
      <div className="grid gap-8">
        {banner}
        <PositionSkeleton />
      </div>
    );
  }
  const enabledNames =
    config?.assets
      .filter((a) => a.enabled)
      .map((a) => collateralName(a.asset).symbol)
      .join(" or ") || "WETH";
  const needsPanel = Boolean(cover?.active || (cover && cover.prepaidWad > 0n));
  if (!position.hasPosition && !needsPanel) {
    return (
      <div className="grid gap-8">
        {banner}
        <Notice
          icon={<TokenPair a="AAVE" b="MON" size={26} />}
          title={watching ? "No Aave position on this address" : "No Aave position on this wallet"}
          action={
            <Button asChild size="lg" className="h-12 px-6">
              <a href={AAVE_APP} target="_blank" rel="noreferrer">
                Open Aave on Monad
              </a>
            </Button>
          }
        >
          Supply {enabledNames} and borrow USDC on Aave V3 Monad, then come back to set a trigger.
        </Notice>
      </div>
    );
  }

  const exits = exitRows(history.data, chainExit.data);
  const lastExit = exits[0];
  const exited = Boolean(cover?.exited && !cover.active && lastExit);
  const exitAsset = collateralName(lastExit?.collateral ?? cover?.collateral);
  const premiumHistory = (history.data?.Reprice ?? [])
    .slice()
    .reverse()
    .map((r) => toNumber(BigInt(r.premiumPerBlock), 18));
  const collateralEnabled = Boolean(collateral && config?.assets.some((a) => a.enabled && a.asset.toLowerCase() === collateral.asset.toLowerCase()));
  const canCover = position.eMode === 0 && collateral !== undefined && collateralEnabled && collateral.suppliedRaw > 0n && (position.usdc?.borrowedRaw ?? 0n) > 0n;

  const panel = !config ? (
    <Skeleton className="h-[28rem] w-full rounded-[14px]" />
  ) : watching ? (
    <WatchedCover cover={cover} arm={arm} borrower={viewer} canAct={Boolean(connected) && !wrongNetwork} keeperIdle={keeperIdle} refetch={refetch} />
  ) : cover?.active && !collateral ? (
    // An active cover is always managed here, never replaced by the "cannot be covered" panel.
    <Skeleton className="h-[28rem] w-full rounded-[14px]" />
  ) : cover?.active && collateral ? (
    <CoverManage
      user={viewer}
      position={position}
      cover={cover}
      collateral={collateral}
      config={config}
      arm={arm}
      disabled={wrongNetwork}
      refetch={refetch}
      lifecycle={lifecycle}
      keeperIdle={keeperIdle}
    />
  ) : canCover && cover && collateral ? (
    <CoverSetup
      key={viewer}
      user={viewer}
      position={position}
      collateral={collateral}
      cover={cover}
      config={config}
      disabled={wrongNetwork}
      onTriggerChange={onTrigger}
      refetch={refetch}
      lifecycle={lifecycle}
    />
  ) : cover || !shieldPos.isLoading ? (
    <CoverUnavailable position={position} config={config} handoff={lifecycle.state} />
  ) : (
    <Skeleton className="h-[28rem] w-full rounded-[14px]" />
  );

  return (
    <div className="grid gap-8">
      {banner}

      <PositionHeader position={position} cover={cover} arm={arm} title={watching ? "Aave position" : "Your Aave position"} />

      {exited && lastExit && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-safe/30 bg-safe-soft px-5 py-4">
          <p className="flex items-start gap-2 text-[0.9375rem]">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-safe" aria-hidden />
            <span>
              Exited in block {Number(lastExit.blockNumber).toLocaleString("en-US")}: penalty avoided{" "}
              <strong className="font-semibold text-safe num">{formatUsd(toNumber(BigInt(lastExit.savedVsAave), 6))}</strong>, saved against Aave&rsquo;s bonus
              on the same repayment.
            </span>
          </p>
          <HashLink value={lastExit.txHash} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_auto_1fr]">
        <div className="min-w-0 lg:col-start-1">
          <PositionPanel
            position={position}
            cover={cover}
            collateral={collateral}
            config={config}
            arm={arm}
            previewTrigger={cover?.active || !canCover || watching ? undefined : previewTrigger}
            premiumHistory={premiumHistory}
          />
        </div>
        <aside className="grid min-w-0 gap-4 self-start lg:sticky lg:top-24 lg:col-start-2 lg:row-span-3 lg:row-start-1" aria-label="Cover">
          {exited && lastExit && (
            <ExitSummary
              savedUsd={toNumber(BigInt(lastExit.savedVsAave), 6)}
              repaidUsd={toNumber(BigInt(lastExit.repaid), 6)}
              feeUsd={config ? (toNumber(BigInt(lastExit.repaid), 6) * config.exitDiscountBps) / 10_000 : undefined}
              hfBefore={toNumber(BigInt(lastExit.healthFactorBefore), 18)}
              hfAfter={toNumber(BigInt(lastExit.healthFactorAfter), 18)}
              collateralTaken={BigInt(lastExit.seized || "0") > 0n ? toNumber(BigInt(lastExit.seized), exitAsset.decimals) : undefined}
              symbol={exitAsset.symbol}
            />
          )}
          {panel}
          {!watching && cover && !cover.active && cover.prepaidWad > 0n && <PrepaidCard user={viewer} cover={cover} disabled={wrongNetwork} refetch={refetch} />}
        </aside>
        <div className="grid min-w-0 gap-6 self-start lg:col-start-1">
          {/* The health factor at the 3 decimals shown and the clock in 5 s steps, so the chart redraws when they move, not on every block. */}
          <HfHistoryPanel
            borrower={viewer}
            liveHf={Number.isFinite(position.healthFactor) ? Math.floor(position.healthFactor * 1000) / 1000 : position.healthFactor}
            trigger={cover?.active ? cover.trigger : undefined}
            active={Boolean(cover?.active)}
            nowSec={chainNow === undefined ? undefined : Math.floor(chainNow / 5) * 5}
          />
          <ActivityPanel history={history.data} isLoading={history.isLoading} error={history.error} chainExit={chainExit.data} active={Boolean(cover?.active)} />
        </div>
        <div className="grid min-w-0 gap-6 self-start lg:col-start-1">
          <ReservesTable position={position} />
          <SourcesPanel collateral={collateral} config={config} />
        </div>
      </div>
    </div>
  );
}
