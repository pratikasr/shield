"use client";

import { useRef, type ReactNode } from "react";
import { LeftoverFuel } from "@/components/borrow/fuel";
import { StatsForNerds } from "@/components/borrow/nerds";
import { MobileSummary, ProtectFrame, StateHead, ProtectLevel } from "@/components/borrow/protect-frame";
import { dropTo, pct1, priceAtHf, usdWhole } from "@/components/borrow/protect-model";
import { Burst, CountUp } from "@/components/cartoon/burst";
import { CartoonButton } from "@/components/cartoon/button";
import { Card } from "@/components/cartoon/card";
import { Confetti } from "@/components/cartoon/confetti";
import { Pill } from "@/components/cartoon/sticker";
import { HashLink } from "@/components/data/hash-link";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import type { Cover } from "@/hooks/useShieldPosition";
import { collateralName, explorerUrl } from "@/lib/env";
import type { ExitRow } from "@/lib/envio";
import { formatHf, formatToken, formatUsd, toNumber } from "@/lib/format";

/**
 * Shield stepped in: the celebration, what Aave would have taken more for the same repayment (the Exited event's
 * savedVsAave), the receipt with Shield's fee and the transaction, the loan now, the fuel left over, and "Protect
 * again". After an exit the record is closed, so Shield is off until a new line is set.
 */
export function SteppedIn({
  exit,
  position,
  collateral,
  cover,
  config,
  wrongNetwork,
  readOnly,
  refetch,
  onProtectAgain,
  canProtectAgain,
  loanLine,
  banner,
}: {
  exit: ExitRow;
  position: AavePosition;
  collateral?: ReserveLine;
  cover: Cover;
  config?: ShieldConfig;
  wrongNetwork: boolean;
  readOnly: boolean;
  refetch: () => Promise<unknown>;
  onProtectAgain: () => void;
  canProtectAgain: boolean;
  loanLine: ReactNode;
  banner?: ReactNode;
}) {
  const info = collateralName(exit.collateral || collateral?.asset);
  const asset = info.priceName;
  const repaid = toNumber(BigInt(exit.repaid), 6);
  const saved = toNumber(BigInt(exit.savedVsAave), 6);
  const seized = toNumber(BigInt(exit.seized || "0"), info.decimals);
  const discount = (config?.exitDiscountBps ?? 100) / 10_000;
  const taken = repaid * (1 + discount);
  const fee = repaid * discount;
  const aaveTakes = taken + saved;
  const exitPrice = seized > 0 ? taken / seized : Number.NaN;
  const hfBefore = toNumber(BigInt(exit.healthFactorBefore), 18);
  const hfAfter = toNumber(BigInt(exit.healthFactorAfter), 18);
  const block = Number(exit.blockNumber);

  const now = collateral?.priceUsd ?? exitPrice;
  const aaveNow = collateral ? priceAtHf(position, collateral, 1) : Number.NaN;
  const toLava = dropTo(now, aaveNow);
  // Aave's line before the rescue, for a loan with one collateral: the price scales with the health factor.
  const single = position.reserves.filter((r) => r.suppliedRaw > 0n).length === 1;
  const ghost = single && Number.isFinite(exitPrice) && hfBefore > 0 ? exitPrice / hfBefore : null;
  const keptRef = useRef<HTMLDivElement>(null);
  const showLevel = Number.isFinite(now) && Number.isFinite(aaveNow) && aaveNow > 0;

  return (
    <ProtectFrame
      loanLine={loanLine}
      levelLast
      head={
        <StateHead
          sticker="Saved"
          tone="saved"
          pill={<Pill dot="off">Shield is off until you set a new line</Pill>}
          title="Shield stepped in."
          say={
            <>
              {asset} hit your line{Number.isFinite(exitPrice) ? <> at <b className="num">{usdWhole(exitPrice)}</b></> : null}. Shield paid back part of your loan before
              Aave could liquidate you.
            </>
          }
        />
      }
      summary={
        <MobileSummary
          rows={[
            { label: "Aave would have taken", value: `${formatUsd(saved)} more` },
            { label: "Shield paid back", value: formatUsd(repaid) },
            { label: "Status", value: "Shield is off" },
          ]}
        />
      }
      level={
        showLevel ? (
          <ProtectLevel
            now={now}
            aave={aaveNow}
            ghost={ghost != null && ghost > aaveNow && ghost < now ? ghost : null}
            line={null}
            lineMode="hidden"
            mood="saved"
            mascotMotion="jump"
            asset={asset}
           
            ribbon={<Pill>After the rescue</Pill>}
          />
        ) : null
      }
    >
      {banner}
      <Confetti fire={exit.txHash} origin={keptRef} />
      <Card tone="chill" className="relative overflow-visible pr-28 sm:pr-36">
        <Burst>
          Nice
          <br />
          save
        </Burst>
        <p className="m-0 font-bold">Aave would have taken</p>
        <div ref={keptRef} className="my-1 text-[52px] font-extrabold leading-none tracking-tight num sm:text-[72px]">
          <CountUp value={saved} format={(v) => formatUsd(v)} />
        </div>
        <p className="m-0 max-w-[26em]">more of your {asset} in a liquidation for the same repayment: the penalty avoided.</p>
      </Card>

      <Card aria-label="What happened">
        <ol className="m-0 grid list-decimal gap-2 pl-5 marker:font-bold [&_b]:font-bold">
          <li>
            {asset} was at <b className="num">{Number.isFinite(exitPrice) ? usdWhole(exitPrice) : "your line"}</b> when Shield stepped in, in block{" "}
            <span className="num">{block.toLocaleString("en-US")}</span>.
          </li>
          <li>
            Shield paid back <b className="num">{formatUsd(repaid)}</b> of your USDC loan.
          </li>
          <li>
            It took {asset} worth <b className="num">{formatUsd(taken)}</b>
            {seized > 0 ? <span className="num"> ({formatToken(seized, info.symbol, 6)})</span> : null} into Shield&rsquo;s vault: the repaid amount plus{" "}
            {discount * 100}%.
          </li>
          <li>
            Shield&rsquo;s fee: <b className="num">{formatUsd(fee)}</b> ({discount * 100}% of what it repaid).
          </li>
          <li>
            Aave&rsquo;s liquidators would have taken {asset} worth <b className="num">{formatUsd(aaveTakes)}</b> for the same repayment.
          </li>
          <li>
            Health factor: <span className="num">{formatHf(hfBefore)}</span> before, <span className="num">{formatHf(hfAfter)}</span> after.
          </li>
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t-[1.5px] border-dashed border-ink/25 pt-3 text-[15px]">
          <b>Transaction</b>
          <HashLink value={exit.txHash} />
          <a className="c-link inline-flex min-h-11 items-center" href={`${explorerUrl}/tx/${exit.txHash}`} target="_blank" rel="noreferrer">
            View on MonadVision
          </a>
        </div>
      </Card>

      {showLevel && (
        <Card>
          <h2 className="mb-1.5 font-display text-[22px] leading-[1.1]">Your loan now</h2>
          <p className="m-0">
            {asset} can fall <b>{pct1(toLava)}</b> before Aave liquidates you, at <b className="num">{usdWhole(aaveNow)}</b>. Shield is off until you set a new line.
          </p>
        </Card>
      )}

      {cover.prepaidWad > 0n && (
        <LeftoverFuel
          cover={cover}
          wrongNetwork={wrongNetwork}
          readOnly={readOnly}
          refetch={refetch}
          title={`You still have ${formatUsd(cover.prepaidUsd)} of fuel.`}
          text="It stays yours. Take it back, or keep it for when you protect again."
        />
      )}

      {!readOnly && canProtectAgain && (
        <div className="c-row">
          <CartoonButton onClick={onProtectAgain}>Protect again</CartoonButton>
        </div>
      )}

      <StatsForNerds
        position={position}
        collateral={collateral}
        config={config}
        extra={[
          ["Health factor before the rescue", formatHf(hfBefore)],
          ["Health factor after it", formatHf(hfAfter)],
          ["Penalty avoided against Aave", formatUsd(saved)],
        ]}
      />
    </ProtectFrame>
  );
}
