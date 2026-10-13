"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { CoverOn } from "@/components/borrow/cover-on";
import { exitRows, useBorrowerHistory } from "@/components/borrow/history";
import { LoanLine, ProtectSkeleton } from "@/components/borrow/protect-frame";
import { pickCollateral, triggerPresets, validPresets } from "@/components/borrow/protect-model";
import { ProtectSetup } from "@/components/borrow/setup-flow";
import {
  Disconnected,
  NoLoan,
  NoticeCard,
  OffByChoice,
  UnsupportedLoan,
  WatchBanner,
  WatchedNotProtected,
  WatchForm,
  parseWatchParam,
  unsupportedReason,
} from "@/components/borrow/simple-states";
import { SteppedIn } from "@/components/borrow/stepped-in";
import { CartoonButton } from "@/components/cartoon/button";
import { Callout } from "@/components/cartoon/card";
import { CartoonIcon } from "@/components/cartoon/icons";
import { useWrongNetwork } from "@/components/shell/network-guard";
import { useAavePosition, type AavePosition, type ReserveLine } from "@/hooks/useAavePosition";
import { useChainExit } from "@/hooks/useChainExit";
import { useLiveBlock, useNow } from "@/hooks/useLiveBlock";
import { useShieldConfig } from "@/hooks/useShieldConfig";
import { useShieldPosition } from "@/hooks/useShieldPosition";
import { useTx } from "@/hooks/useTx";
import { LOADING_ARM, computeArm } from "@/lib/cover-status";
import { collateralName, isDeployed } from "@/lib/env";
import { firstLine, formatToken, formatUsd, truncateHex } from "@/lib/format";

export { parseWatchParam } from "@/components/borrow/simple-states";

/** Blocks a condition has held for, counted from the first block it was seen. */
function useBlocksSince(condition: boolean, block: bigint | undefined): number {
  const since = useRef<bigint | undefined>(undefined);
  if (!condition) since.current = undefined;
  else if (since.current === undefined && block !== undefined) since.current = block;
  return condition && since.current !== undefined && block !== undefined ? Number(block - since.current) : 0;
}

function loanText(position: AavePosition, collateral: ReserveLine | undefined, watching: boolean, after: boolean) {
  const who = watching ? "This Aave loan" : after ? "Your Aave loan now" : "Your Aave loan";
  const asset = collateral ? collateralName(collateral.asset).priceName : undefined;
  const supplied = collateral ? `${formatToken(collateral.supplied, asset)} (${formatUsd(collateral.suppliedUsd)}) in` : `${formatUsd(position.collateralUsd)} in`;
  const others = position.reserves.filter((r) => r.suppliedRaw > 0n && r.asset !== collateral?.asset).length;
  const usdc = position.usdc && position.usdc.borrowedRaw > 0n ? `${formatUsd(position.usdc.borrowed)} USDC borrowed` : `${formatUsd(position.debtUsd)} borrowed`;
  return `${who}: ${supplied}${others ? ` plus ${others} other deposit${others === 1 ? "" : "s"}` : ""}, ${usdc}`;
}

/**
 * The borrower page. `initialWatch` is the `?address=` parameter and `walletHint` says a wallet was connected on the
 * last visit (lib/wallet-cookie.ts), both read by the server so the first paint needs no script. Every state is one
 * screen with one main action; this component reads the chain and picks the screen.
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
  const reconnecting = status === "reconnecting";
  const wrongNetwork = useWrongNetwork();

  const { config, error: configError } = useShieldConfig();
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
  const dueBlocks = useBlocksSince(arm.kind === "due", block);
  const refetchShield = shieldPos.refetch;
  const refetchAave = aavePos.refetch;
  const refetch = useCallback(() => Promise.all([refetchShield(), refetchAave()]), [refetchShield, refetchAave]);
  // "Protect again" after a rescue, and "Keep it for next time" after turning off: the borrower moves on to setup.
  const [moveOn, setMoveOn] = useState(false);
  // A new cover starts the story again: the next rescue or turn-off gets its own screen.
  const coverActive = Boolean(cover?.active);
  useEffect(() => {
    if (coverActive) setMoveOn(false);
  }, [coverActive]);

  // A build without contract addresses (scripts/web-env.sh or scripts/deploy-web-aws.sh writes them from a deployment
  // file): visitors see that Shield is not live yet, never the variable names.
  if (!isDeployed) {
    return (
      <NoticeCard title="Shield isn’t live yet">
        Shield&rsquo;s contracts are not on Monad mainnet yet, so cover can&rsquo;t be switched on. Check back soon.
      </NoticeCard>
    );
  }
  if (!viewer && (reconnecting || !settled)) return <ProtectSkeleton />;
  if (parsed.invalid) {
    return (
      <NoticeCard
        title="That isn’t a wallet address"
        action={
          <CartoonButton asChild variant="white">
            <a href="/app/borrow">Stop viewing</a>
          </CartoonButton>
        }
      >
        <p className="m-0">
          &ldquo;<span className="break-all">{watchRaw}</span>&rdquo; is not a valid Monad address. Check it, including its upper and lower case letters, and try again.
        </p>
        <div className="mt-5 text-left">
          <WatchForm startOpen />
        </div>
      </NoticeCard>
    );
  }
  if (!viewer) return <Disconnected />;

  const banner = watching ? <WatchBanner watching={watching} connected={connected} /> : null;
  const rpcError = aavePos.error ?? (!cover ? shieldPos.error : null) ?? (!config ? configError : null);
  if (!position || (!cover && shieldPos.isLoading) || !config) {
    if (rpcError) {
      return (
        <NoticeCard
          title="Can’t reach Monad right now"
          action={
            <CartoonButton onClick={() => location.reload()}>Try again</CartoonButton>
          }
        >
          <p className="m-0">The Monad RPC didn&rsquo;t answer: {firstLine(rpcError.message)}. Your loan and any cover are unchanged; this page just can&rsquo;t read them.</p>
        </NoticeCard>
      );
    }
    return (
      <>
        {banner && <div className="mb-4">{banner}</div>}
        <ProtectSkeleton />
      </>
    );
  }

  const exits = exitRows(history.data, chainExit.data);
  const lastExit = exits[0];
  // After a rescue, wait for its details before choosing between the celebration and setup.
  if (cover?.exited && !cover.active && !lastExit && chainExit.isLoading) return <ProtectSkeleton label="Reading the rescue" />;
  const prepaid = cover?.prepaidWad ?? 0n;
  const readOnly = Boolean(watching);
  const loan = (after = false) => <LoanLine>{loanText(position, collateral, readOnly, after)}</LoanLine>;
  // The wrong-network banner is the shell's (NetworkGuard); here every action button becomes "Switch to Monad to ...".
  const top = banner;

  if (!position.hasPosition && !cover?.active && prepaid === 0n && !(cover?.exited && lastExit)) {
    return <NoLoan watching={readOnly} loanLine={<LoanLine>{readOnly ? `Wallet ${truncateHex(viewer)}: no Aave loan found` : "No Aave loan found in this wallet"}</LoanLine>} banner={top} />;
  }

  // Shield stepped in: the celebration until the borrower moves on.
  if (cover && cover.exited && !cover.active && lastExit && !moveOn) {
    return (
      <SteppedIn
        exit={lastExit}
        position={position}
        collateral={collateral}
        cover={cover}
        config={config}
        wrongNetwork={wrongNetwork}
        readOnly={readOnly}
        refetch={refetch}
        onProtectAgain={() => {
          setMoveOn(true);
          window.scrollTo({ top: 0 });
        }}
        canProtectAgain
        loanLine={loan(true)}
        banner={top}
      />
    );
  }

  if (cover?.active) {
    if (!collateral) return <ProtectSkeleton label="Reading your cover" />;
    return (
      <CoverOn
        user={viewer}
        position={position}
        cover={cover}
        collateral={collateral}
        config={config}
        arm={arm}
        wrongNetwork={wrongNetwork}
        readOnly={readOnly}
        canAct={Boolean(connected) && !wrongNetwork}
        refetch={refetch}
        lifecycle={lifecycle}
        dueBlocks={dueBlocks}
        loanLine={loan()}
        banner={top}
      />
    );
  }

  const hasRoom = validPresets(triggerPresets(position.healthFactor)).length > 0;
  const reason = unsupportedReason(position, collateral, hasRoom);

  // Turned off by choice with fuel left: take it back or keep it.
  if (cover && collateral && !readOnly && !reason && cover.exists && !cover.exited && prepaid > 0n && !moveOn) {
    return (
      <OffByChoice
        position={position}
        collateral={collateral}
        cover={cover}
        config={config}
        wrongNetwork={wrongNetwork}
        refetch={refetch}
        onKeep={() => setMoveOn(true)}
        loanLine={loan()}
      />
    );
  }

  if (reason || !collateral || !cover) {
    return (
      <UnsupportedLoan
        reason={reason ?? "collateral"}
        position={position}
        collateral={collateral}
        config={config}
        cover={cover}
        wrongNetwork={wrongNetwork}
        readOnly={readOnly}
        refetch={refetch}
        loanLine={loan()}
        banner={top}
      />
    );
  }

  if (readOnly) return <WatchedNotProtected position={position} collateral={collateral} config={config} loanLine={loan()} banner={top} />;

  return (
    <ProtectSetup
      key={viewer}
      user={viewer}
      position={position}
      collateral={collateral}
      cover={cover}
      config={config}
      wrongNetwork={wrongNetwork}
      refetch={refetch}
      lifecycle={lifecycle}
      loanLine={loan()}
      notice={
        <>
          {top}
          {cover.exited && !lastExit && (
            <Callout tone="chill" icon={<CartoonIcon name="shield" />} title="Shield stepped in on your last cover">
              <p>Its details are still loading. Pick a new line below to protect the loan again.</p>
            </Callout>
          )}
        </>
      }
    />
  );
}
