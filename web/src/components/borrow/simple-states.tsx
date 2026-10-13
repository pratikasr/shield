"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState, type ReactNode } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { AAVE_APP } from "@/components/borrow/cover-shared";
import { LeftoverFuel } from "@/components/borrow/fuel";
import { StatsForNerds } from "@/components/borrow/nerds";
import { MobileSummary, ProtectFrame, StateHead, ProtectLevel } from "@/components/borrow/protect-frame";
import { dropTo, pct1, priceAtHf, SAFETY_WORD, safetyOf, usdWhole } from "@/components/borrow/protect-model";
import { CartoonButton } from "@/components/cartoon/button";
import { Callout, Card } from "@/components/cartoon/card";
import { CartoonIcon } from "@/components/cartoon/icons";
import { Mascot } from "@/components/cartoon/mascot";
import type { MascotMood } from "@/components/cartoon/mascot-art";
import { Pill, SampleTag } from "@/components/cartoon/sticker";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import type { Cover } from "@/hooks/useShieldPosition";
import { collateralName } from "@/lib/env";
import { formatUsd, truncateHex } from "@/lib/format";
import { aaveButtonText, aaveLink, testLoanEnabled } from "@/lib/test-loan";

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

/** Paste any address and see its loan, read only (a judge checking the demo position). */
export function WatchForm({ startOpen = false, label = "Check any wallet", quiet }: { startOpen?: boolean; label?: string; quiet?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [value, setValue] = useState("");
  const parsed = parseWatchParam(value);
  if (!open)
    return (
      <CartoonButton variant={quiet ? "quiet" : "white"} onClick={() => setOpen(true)} aria-expanded={false}>
        {label}
      </CartoonButton>
    );
  return (
    <form
      className="flex flex-wrap gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.address) window.location.assign(`/app/borrow?address=${parsed.address}`);
      }}
    >
      <label htmlFor="watch" className="sr-only">
        Wallet address to check
      </label>
      <input
        id="watch"
        autoFocus={!startOpen}
        className="c-field min-w-0 flex-[1_1_220px] font-mono text-[15px] font-semibold"
        placeholder="Paste a wallet address, 0x..."
        autoComplete="off"
        spellCheck={false}
        value={value}
        aria-invalid={parsed.invalid || undefined}
        aria-describedby="watch-help"
        onChange={(e) => setValue(e.target.value)}
      />
      <CartoonButton type="submit" size="small" className="min-h-[52px]" disabled={!parsed.address}>
        Check
      </CartoonButton>
      <p id="watch-help" className={parsed.invalid ? "m-0 w-full text-[14.5px] font-semibold text-lava-deep" : "sr-only"} aria-live="polite">
        {parsed.invalid ? "That isn't a Monad address. Check it, including its upper and lower case letters." : ""}
      </p>
    </form>
  );
}

/** "Viewing 0x..., read only" above a watched loan. */
export function WatchBanner({ watching, connected }: { watching: Address; connected?: Address }) {
  const other = connected !== undefined && connected.toLowerCase() !== watching.toLowerCase();
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-[2.5px] border-ink bg-grape-tint px-4 py-3 text-[15px]">
      <p className="m-0 flex min-w-0 items-start gap-2">
        <CartoonIcon name="wallet" size={22} className="shrink-0" />
        <span className="min-w-0">
          {other ? (
            <>
              Connected as <b className="num">{truncateHex(connected!)}</b>, viewing <b className="num">{truncateHex(watching)}</b> read only.
            </>
          ) : (
            <>
              Viewing <b className="num">{truncateHex(watching)}</b>, read only. {connected ? "Stop viewing to manage it from this wallet." : "Connect that wallet to change its cover."}
            </>
          )}
        </span>
      </p>
      <a href="/app/borrow" className="c-link inline-flex min-h-11 items-center">
        Stop viewing
      </a>
    </div>
  );
}

/** A centered card for states with nothing to picture: not configured, an RPC error, an invalid address. */
export function NoticeCard({ mood = "confused", title, children, action }: { mood?: MascotMood; title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl py-8 sm:py-14">
      <Card className="grid justify-items-center gap-3 px-6 py-10 text-center sm:px-10">
        <Mascot mood={mood} size={110} />
        <h1 className="c-h1-app mt-2 text-[34px] sm:text-[42px]">{title}</h1>
        <div className="max-w-md text-[17px]">{children}</div>
        {action && <div className="mt-3 flex flex-wrap justify-center gap-3">{action}</div>}
      </Card>
    </div>
  );
}

/** The design's example loan, drawn dimmed behind the connect prompt and tagged as an example. */
const EXAMPLE = { now: 2716, aave: 2539, line: 2640 };

export function Disconnected() {
  return (
    <ProtectFrame
      head={
        <StateHead
          title="Is your Aave loan safe?"
          say="Connect your wallet and Shield shows how far ETH can fall before Aave liquidates you, in dollars, plus the price where Shield would step in first."
        />
      }
      level={
        <ProtectLevel
          now={EXAMPLE.now}
          aave={EXAMPLE.aave}
          line={EXAMPLE.line}
          lineMode="preview"
          mood="hello"
          dim
         
          ribbon={
            <>
              <Pill>Example loan</Pill>
              <SampleTag>Example numbers</SampleTag>
            </>
          }
          label="An example loan, not yours: ETH on a platform, Aave's liquidation price as lava below, and Shield's line in between."
        />
      }
    >
      <Card className="grid gap-3.5">
        <ConnectButton.Custom>
          {({ openConnectModal, mounted }) => (
            <CartoonButton size="big" onClick={openConnectModal} disabled={!mounted}>
              Connect wallet
            </CartoonButton>
          )}
        </ConnectButton.Custom>
        <WatchForm />
        <p className="c-small c-muted m-0">Checking a wallet is read only. Nothing is signed and nothing moves.</p>
      </Card>
      <Card>
        <h2 className="mb-2 font-display text-[22px] leading-[1.1]">What you&rsquo;ll see</h2>
        <p className="m-0">
          Your loan as a level: ETH&rsquo;s price is the ground you stand on, Aave&rsquo;s liquidation price is the lava. Pick a line above the lava and Shield steps in
          there, before Aave does. It pays back part of your loan and takes a slice of your ETH worth that plus 1%, instead of Aave&rsquo;s bonus.
        </p>
      </Card>
    </ProtectFrame>
  );
}

export function NoLoan({ watching, loanLine, banner }: { watching: boolean; loanLine: ReactNode; banner?: ReactNode }) {
  return (
    <ProtectFrame
      loanLine={loanLine}
      head={
        <StateHead
          sticker="No loan yet"
          tone="none"
          title={watching ? "No Aave loan on this address." : "No Aave loan in this wallet."}
          say="Shield protects Aave V3 loans on Monad with ETH as collateral and USDC borrowed."
        />
      }
      level={<ProtectLevel now={2716} aave={2400} scale={{ top: 2716, bottom: 2340 }} mood="curious" showRuler={false} showLavaTag={false} slab="No loan here" label="No loan to show." />}
    >
      {banner}
      <Card>
        <h2 className="mb-3 font-display text-[22px] leading-[1.1]">To use Shield</h2>
        <ol className="mb-[18px] mt-0 grid list-decimal gap-1.5 pl-[22px] marker:font-bold">
          {testLoanEnabled ? (
            <>
              <li>Deposit test WETH with the Test loan card below.</li>
              <li>Borrow test USDC there.</li>
              <li>Pick your line here.</li>
            </>
          ) : (
            <>
              <li>Deposit ETH on Aave V3 Monad.</li>
              <li>Borrow USDC against it, outside eMode.</li>
              <li>Come back here and pick your line.</li>
            </>
          )}
        </ol>
        <div className="c-row">
          <CartoonButton asChild>
            <a {...aaveLink(AAVE_APP)}>{aaveButtonText("Open Aave")}</a>
          </CartoonButton>
          <WatchForm label="Check another wallet" quiet />
        </div>
      </Card>
      <Callout tone="grape" icon={<CartoonIcon name="warn" />} title="Have a loan but it isn’t showing?">
        <p>Shield reads Aave V3 on Monad only. Loans on other chains or other markets don&rsquo;t show here.</p>
      </Callout>
    </ProtectFrame>
  );
}

export type Unsupported = "emode" | "collateral" | "debt" | "ltv0" | "noRoom" | "noDebt";

/** Why a loan cannot be covered, or undefined when it can. */
export function unsupportedReason(position: AavePosition, collateral: ReserveLine | undefined, hasRoom: boolean): Unsupported | undefined {
  if (position.debtUsd <= 0) return "noDebt";
  if (position.eMode !== 0) return "emode";
  if (!collateral || collateral.suppliedRaw === 0n) return "collateral";
  if ((position.usdc?.borrowedRaw ?? 0n) === 0n) return "debt";
  if (position.ltv0Collateral && position.ltv0Collateral.length > 0) return "ltv0";
  if (!hasRoom) return "noRoom";
  return undefined;
}

/** "We see your Aave loan, but Shield can't cover it yet", with the exact reason and the one fix. */
export function UnsupportedLoan({
  reason,
  position,
  collateral,
  config,
  cover,
  wrongNetwork,
  readOnly,
  refetch,
  loanLine,
  banner,
}: {
  reason: Unsupported;
  position: AavePosition;
  collateral?: ReserveLine;
  config?: ShieldConfig;
  cover?: Cover;
  wrongNetwork: boolean;
  readOnly: boolean;
  refetch: () => Promise<unknown>;
  loanLine: ReactNode;
  banner?: ReactNode;
}) {
  const asset = collateral ? collateralName(collateral.asset).priceName : "ETH";
  const supplies = position.reserves.filter((r) => r.suppliedRaw > 0n).map((r) => r.symbol);
  const borrows = position.reserves.filter((r) => r.borrowedRaw > 0n).map((r) => r.symbol);
  const enabled = config?.assets.filter((a) => a.enabled).map((a) => collateralName(a.asset).priceName) ?? ["ETH"];
  const now = collateral?.priceUsd;
  const aavePrice = collateral ? priceAtHf(position, collateral, 1) : Number.NaN;
  const drop = now ? dropTo(now, aavePrice) : Number.NaN;
  const copy: Record<Unsupported, { title: string; say: ReactNode; fixTitle: string; fix: ReactNode; button: string }> = {
    emode: {
      title: "Your loan is in eMode.",
      say: "We see your Aave loan, but Shield can't cover eMode loans yet.",
      fixTitle: "Leave eMode on Aave",
      fix: "Switch eMode off in the Aave app. Shield picks your loan up in the next block.",
      button: "Open Aave",
    },
    collateral: {
      title: `Shield needs ${enabled.join(" or ")} as collateral.`,
      say: `We see your Aave loan${supplies.length ? `, with ${supplies.join(" and ")} as collateral` : ""}. Shield takes a slice of ${enabled.join(" or ")} when it steps in, so it covers loans backed by it.`,
      fixTitle: `Supply ${enabled.join(" or ")} on Aave`,
      fix: "Add it as collateral in the Aave app, then come back and pick your line.",
      button: "Open Aave",
    },
    debt: {
      title: "Shield needs a USDC loan.",
      say: `We see your Aave loan${borrows.length ? `, borrowing ${borrows.join(" and ")}` : ""}. Shield pays back USDC when it steps in.`,
      fixTitle: "Borrow USDC on Aave",
      fix: "Shield covers the USDC part of a loan. Borrow USDC on Aave, then come back.",
      button: "Open Aave",
    },
    ltv0: {
      title: "One deposit blocks Shield.",
      say: `${(position.ltv0Collateral ?? []).map((r) => r.symbol).join(" and ")} counts for nothing as collateral on Aave, and while it is switched on, Aave won't let anyone move your ${asset}.`,
      fixTitle: "Switch that deposit off as collateral",
      fix: `In the Aave app, turn off "Use as collateral" for it. Your ${asset} stays where it is.`,
      button: "Open Aave",
    },
    noRoom: {
      title: "Too close for Shield.",
      say: (
        <>
          {asset} can fall only <b>{pct1(drop)}</b> before Aave liquidates you: too little room for Shield to step in first.
        </>
      ),
      fixTitle: "Make some room first",
      fix: `Pay back some USDC or add ${asset} on Aave. Once ${asset} can fall a little more than 2% before the lava, you can pick a line here.`,
      button: "Open Aave",
    },
    noDebt: {
      title: "Nothing borrowed, nothing to liquidate.",
      say: "This Aave account has collateral but no debt, so Aave can't liquidate it and Shield has nothing to protect.",
      fixTitle: "Borrow USDC to use Shield",
      fix: `Borrow USDC against ${asset} on Aave, then come back and pick your line.`,
      button: "Open Aave",
    },
  };
  const c = copy[reason];
  const safety = safetyOf(drop);
  const showLevel = now !== undefined && Number.isFinite(aavePrice) && aavePrice > 0;
  return (
    <ProtectFrame
      loanLine={loanLine}
      head={<StateHead sticker={reason === "noRoom" ? SAFETY_WORD[safety] : "Not covered"} tone={reason === "noRoom" ? safety : "blocked"} pill={<Pill dot="off">Shield is off</Pill>} title={c.title} say={c.say} />}
      summary={showLevel ? <MobileSummary rows={[{ label: "Aave liquidates at", value: usdWhole(aavePrice) }, { label: "Room to the lava", value: pct1(drop) }]} /> : undefined}
      level={
        showLevel ? (
          <ProtectLevel now={now!} aave={aavePrice} mood={reason === "noRoom" ? "danger" : "confused"} asset={asset} />
        ) : (
          <ProtectLevel now={2716} aave={2400} scale={{ top: 2716, bottom: 2340 }} mood="confused" showRuler={false} showLavaTag={false} slab="Not covered yet" />
        )
      }
    >
      {banner}
      <Callout tone="heads" icon={<CartoonIcon name="warn" />} title={c.fixTitle}>
        <p className="mb-3.5">{c.fix}</p>
        <CartoonButton asChild>
          <a {...aaveLink(AAVE_APP)}>{aaveButtonText(c.button)}</a>
        </CartoonButton>
      </Callout>
      {cover && cover.prepaidWad > 0n && <LeftoverFuel cover={cover} wrongNetwork={wrongNetwork} readOnly={readOnly} refetch={refetch} />}
      <StatsForNerds position={position} collateral={collateral} config={config} />
    </ProtectFrame>
  );
}

/** Turned off by choice, with fuel left: take it back, or keep it for next time. */
export function OffByChoice({
  position,
  collateral,
  cover,
  config,
  wrongNetwork,
  refetch,
  onKeep,
  loanLine,
}: {
  position: AavePosition;
  collateral: ReserveLine;
  cover: Cover;
  config: ShieldConfig;
  wrongNetwork: boolean;
  refetch: () => Promise<unknown>;
  onKeep: () => void;
  loanLine: ReactNode;
}) {
  const asset = collateralName(collateral.asset).priceName;
  const now = collateral.priceUsd;
  const aavePrice = priceAtHf(position, collateral, 1);
  const drop = dropTo(now, aavePrice);
  return (
    <ProtectFrame
      loanLine={loanLine}
      head={
        <StateHead
          sticker="Off"
          tone="none"
          pill={<Pill dot="off">Shield is off</Pill>}
          title={`Shield is off. You have ${formatUsd(cover.prepaidUsd)} of fuel left.`}
          say={
            <>
              You turned Shield off. {asset} can fall <b>{pct1(drop)}</b> before Aave liquidates you, and nothing steps in before that now.
            </>
          }
        />
      }
      summary={<MobileSummary rows={[{ label: "Status", value: "Shield is off" }, { label: "Fuel left", value: formatUsd(cover.prepaidUsd) }, { label: "Aave liquidates at", value: usdWhole(aavePrice) }]} />}
      level={<ProtectLevel now={now} aave={aavePrice} mood="chill" asset={asset} />}
    >
      <LeftoverFuel
        cover={cover}
        wrongNetwork={wrongNetwork}
        refetch={refetch}
        title="The fuel is still yours."
        text="Take it back to this wallet, or keep it for the next time you turn Shield on."
        keep={
          <CartoonButton variant="white" onClick={onKeep}>
            Keep it for next time
          </CartoonButton>
        }
      />
      <StatsForNerds position={position} collateral={collateral} config={config} />
    </ProtectFrame>
  );
}

/** A watched wallet with no cover: the picture, read only. */
export function WatchedNotProtected({ position, collateral, config, loanLine, banner }: { position: AavePosition; collateral: ReserveLine; config?: ShieldConfig; loanLine: ReactNode; banner: ReactNode }) {
  const asset = collateralName(collateral.asset).priceName;
  const now = collateral.priceUsd;
  const aavePrice = priceAtHf(position, collateral, 1);
  const drop = dropTo(now, aavePrice);
  const safety = safetyOf(drop);
  return (
    <ProtectFrame
      loanLine={loanLine}
      head={
        <StateHead
          sticker={SAFETY_WORD[safety]}
          tone={safety}
          pill={<Pill dot="off">Shield is off</Pill>}
          title={`${asset} can fall ${pct1(drop)} before Aave liquidates this loan.`}
          say={<>That&rsquo;s {asset} at <b className="num">{usdWhole(aavePrice)}</b>. This wallet has no Shield cover.</>}
        />
      }
      level={<ProtectLevel now={now} aave={aavePrice} mood={safety === "danger" ? "danger" : safety === "careful" ? "careful" : "chill"} asset={asset} />}
    >
      {banner}
      <Card>
        <h2 className="mb-1.5 font-display text-[22px] leading-[1.1]">Read only</h2>
        <p className="m-0">Connect this wallet to pick a line and turn Shield on. Nothing here can be signed for someone else&rsquo;s loan.</p>
      </Card>
      <StatsForNerds position={position} collateral={collateral} config={config} />
    </ProtectFrame>
  );
}
