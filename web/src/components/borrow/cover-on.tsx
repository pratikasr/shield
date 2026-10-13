"use client";

import { useState, type ReactNode } from "react";
import { maxUint256, type Address } from "viem";
import { ApprovalNote } from "@/components/borrow/approval-note";
import { AAVE_APP, KEEPER_IDLE_BLOCKS, useQuotes } from "@/components/borrow/cover-shared";
import { AddFuelTray, busyText, fuelAmounts, TakeBackTray, useAddFuel } from "@/components/borrow/fuel";
import { StatsForNerds } from "@/components/borrow/nerds";
import { blockCopy, blockReason, isOutOfFuel, type BlockReason } from "@/components/borrow/protect-copy";
import { FactsCard, MobileSummary, ProtectFrame, StateHead, TxLine, ProtectLevel } from "@/components/borrow/protect-frame";
import {
  compareCosts,
  dropTo,
  fuelSegments,
  lastsFor,
  LOW_FUEL_DAYS,
  NEAR_ONE,
  pct1,
  priceAtHf,
  triggerPresets,
  usdUnits,
  usdWhole,
} from "@/components/borrow/protect-model";
import { CartoonButton } from "@/components/cartoon/button";
import { Callout, Card } from "@/components/cartoon/card";
import { ChoiceCards } from "@/components/cartoon/choice-cards";
import { CountdownRing } from "@/components/cartoon/countdown-ring";
import { Disclosure } from "@/components/cartoon/disclosure";
import { CartoonIcon } from "@/components/cartoon/icons";
import type { LineMode } from "@/components/cartoon/level";
import type { MascotMood } from "@/components/cartoon/mascot-art";
import { Pill, type StickerTone } from "@/components/cartoon/sticker";
import { SwitchButton } from "@/components/shell/network-guard";
import { latestTx } from "@/components/tx/tx-status";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import { useLiveBlock } from "@/hooks/useLiveBlock";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import type { Cover } from "@/hooks/useShieldPosition";
import { useTx, type TxHandle } from "@/hooks/useTx";
import { erc20Abi, executorAbi, positionRegistryAbi } from "@/lib/abis";
import { livePrepaid, type ArmState } from "@/lib/cover-status";
import { BLOCKS_PER_DAY, BLOCKS_PER_YEAR, runwayDays } from "@/lib/economics";
import { collateralName, shield } from "@/lib/env";
import { formatClock, formatCountdown, formatDuration, formatUsd } from "@/lib/format";

type Kind = "loading" | "arming" | "protected" | "near" | "low" | "out" | "blocked" | "due";
type Tray = "fuel" | "when" | "off" | undefined;

/** ETH within this share of the line counts as "near your line". */
const NEAR_LINE = 0.01;
const MAX_DISCOUNTS = [100, 200, 300, 500];

/**
 * An active cover, in every state it can be in: arming, on, near the line, low on fuel, out of fuel, blocked (with
 * the one fix), and due (with the keeper-idle fallback). Add fuel, change the line and turn off are trays below the
 * facts, each one or two wallet prompts. `readOnly` is a watched address: no actions, except running a late exit.
 */
export function CoverOn({
  user,
  position,
  cover,
  collateral,
  config,
  arm,
  wrongNetwork,
  readOnly,
  canAct,
  refetch,
  lifecycle,
  dueBlocks,
  loanLine,
  banner,
}: {
  user: Address;
  position: AavePosition;
  cover: Cover;
  collateral: ReserveLine;
  config: ShieldConfig;
  arm: ArmState;
  wrongNetwork: boolean;
  readOnly: boolean;
  /** A wallet on Monad is connected, so it may run a late exit (exits are permissionless). */
  canAct: boolean;
  refetch: () => Promise<unknown>;
  lifecycle: TxHandle;
  /** Blocks the exit has been due for. */
  dueBlocks: number;
  loanLine: ReactNode;
  banner?: ReactNode;
}) {
  const asset = collateralName(collateral.asset).priceName;
  const { data: block } = useLiveBlock();
  const live = livePrepaid(cover, block);
  const days = runwayDays(live.prepaidUsd, live.rate);
  const now = collateral.priceUsd;
  const aavePrice = priceAtHf(position, collateral, 1);
  const linePrice = priceAtHf(position, collateral, cover.trigger);
  const toLava = dropTo(now, aavePrice);
  const toLine = dropTo(now, linePrice);
  const costs = compareCosts(position, collateral, cover.trigger, config);
  const monthUsd = cover.annualPremiumUsd / 12;
  const wait = formatDuration(config.minCoverSeconds);
  const out = isOutOfFuel(arm, cover.exitStatus, cover.lapsed);
  const reason = out ? undefined : blockReason(arm, cover.exitStatus);
  const kind: Kind =
    arm.kind === "loading"
      ? "loading"
      : out
        ? "out"
        : reason
          ? "blocked"
          : arm.kind === "warming"
            ? "arming"
            : arm.kind === "due"
              ? "due"
              : days < LOW_FUEL_DAYS
                ? "low"
                : toLine > 0 && toLine < NEAR_LINE
                  ? "near"
                  : "protected";
  const paused = kind === "out" || kind === "blocked";
  const [tray, setTray] = useState<Tray>();
  const fuel = useAddFuel(cover, refetch);
  const quickUnits = fuelAmounts(cover.livePremiumPerBlockUsd || live.rate, 10_000n)[0]!.units;
  const fixTx = useTx();
  // The fix's status shows only under the reason it was sent for.
  const [fixFor, setFixFor] = useState<BlockReason>();
  const copy = reason
    ? blockCopy(reason, {
        asset,
        discountBps: config.exitDiscountBps,
        maxDiscountBps: cover.maxDiscountBps,
        aaveBonusPct: (collateral.liquidationBonus - 1) * 100,
        maxGapBps: config.maxOracleDeviationBps,
        ltv0: (position.ltv0Collateral ?? []).map((r) => r.symbol),
        target: cover.trigger + config.exitHfBuffer,
      })
    : undefined;
  const armsIn = Math.max(arm.armsIn ?? 0, 0);

  // ---- Head ----
  const head = (() => {
    const lavaSay = (
      <>
        {asset} can fall <b>{pct1(toLava)}</b> before Aave liquidates you.
      </>
    );
    const on = <Pill dot="on">Shield is on</Pill>;
    const off = <Pill dot="off">Shield is off</Pill>;
    const h = (sticker: string, tone: StickerTone, pill: ReactNode, title: ReactNode, say: ReactNode) => <StateHead sticker={sticker} tone={tone} pill={pill} title={title} say={say} />;
    switch (kind) {
      case "loading":
        return h("Checking", "none", undefined, "Checking your cover.", "Reading every condition a rescue needs from Monad.");
      case "arming":
        return h(
          "Arming",
          "arming",
          <Pill dot="warn" tone="grape">
            <span className="num">Not on yet: arms in {formatCountdown(armsIn)}</span>
          </Pill>,
          "Shield is arming.",
          `New cover starts ${wait} after you turn it on or move your line earlier, so nobody can buy it at the last second, when a crash is already under way.`,
        );
      case "near":
        return h(
          "Careful",
          "careful",
          on,
          `Shield is on. ${asset} is near your line.`,
          <>
            {asset} is <b>{pct1(toLine)}</b> above your line at <b>{usdWhole(linePrice)}</b>. If it falls there, Shield steps in.
          </>,
        );
      case "low":
        return h(
          "Low fuel",
          "lowfuel",
          on,
          "Shield is on, but fuel is low.",
          <>
            <b>{lastsFor(days).replace(/^about /, "About ")}</b> left. When it runs out, Shield switches off.
          </>,
        );
      case "out":
        return h("Out of fuel", "out", off, "Out of fuel. Shield is off.", <>{lavaSay} Nothing steps in before that now.</>);
      case "blocked":
        return h(
          "Blocked",
          "blocked",
          <Pill dot="warn">Shield can&rsquo;t step in</Pill>,
          "Shield can’t step in right now.",
          copy?.say,
        );
      case "due":
        return h(
          "Stepping in",
          "careful",
          on,
          `${asset} hit your line. Shield is stepping in.`,
          "Shield sends the rescue in the next blocks: it pays back part of your loan before Aave can liquidate you. Anyone may send it if Shield's bot is late.",
        );
      default:
        return h(
          "Protected",
          "protected",
          on,
          "Shield is on.",
          <>
            {lavaSay} Shield steps in first, at <b>{pct1(toLine)}</b> down.
          </>,
        );
    }
  })();

  // ---- Level ----
  const mood: MascotMood =
    kind === "arming" ? "arming" : kind === "out" ? "sleepy" : kind === "blocked" ? "confused" : kind === "low" ? "tired" : kind === "near" ? "careful" : "guard";
  const lineMode: LineMode = kind === "arming" ? "arming" : kind === "out" ? "off" : kind === "blocked" ? "blocked" : "on";
  const lineLabel =
    kind === "arming" ? (
      <>
        <b>Shield steps in at {usdWhole(linePrice)}</b>
        <span className="num">Arms in {formatCountdown(armsIn)}</span>
      </>
    ) : kind === "out" ? (
      <>
        <b>Shield is off</b>Your line: {usdWhole(linePrice)}
      </>
    ) : undefined;
  const level = (
    <ProtectLevel
      now={now}
      aave={aavePrice}
      line={Number.isFinite(linePrice) && linePrice > 0 ? linePrice : null}
      lineMode={lineMode}
      lineLabel={lineLabel}
      mood={mood}
      asset={asset}
     
      mascotMotion={kind === "out" ? "shake" : "squash"}
    />
  );

  // ---- Facts ----
  const facts = (
    <FactsCard
      lineTitle={paused ? "Your line (paused)" : "When Shield steps in"}
      lineBig={`${asset} at ${usdWhole(linePrice)}`}
      lineText={
        <>
          {toLine > 0 ? <>That&rsquo;s {pct1(toLine)} below now.</> : <>{asset} is at or below it now.</>} Shield {paused ? "would pay" : "pays"} back about {formatUsd(costs.exit.repayUsd)} of your loan and {paused ? "would take" : "takes"}{" "}
          {asset} worth {formatUsd(costs.shieldTakesUsd)}, the repaid amount plus {config.exitDiscountBps / 100}%. Aave&rsquo;s liquidators would take{" "}
          {formatUsd(costs.aaveTakesUsd)} for the same repayment.
        </>
      }
      costBig={cover.lapsed ? "Paused" : `${formatUsd(monthUsd)} a month`}
      costText={
        cover.lapsed
          ? "Nothing burns while Shield is out of fuel."
          : `About ${formatUsd(cover.annualPremiumUsd)} a year while your loan stays this size. More when ${asset} gets wild or nears your line.${kind === "blocked" ? " Fuel keeps burning while this is blocked." : ""}`
      }
      fuel={{
        level: fuelSegments(days) / 10,
        tone: out ? "out" : kind === "low" ? "low" : "ok",
        blink: kind === "low",
        label: out ? "Out of fuel" : kind === "low" ? `${lastsFor(days).replace(/^about /, "About ")} left` : `Paid up for ${lastsFor(days)}`,
      }}
    />
  );

  const summary = (
    <MobileSummary
      rows={[
        { label: "Status", value: kind === "arming" ? `Arms in ${formatCountdown(armsIn)}` : paused ? "Shield can't step in" : "Shield is on" },
        { label: "Shield steps in at", value: usdWhole(linePrice) },
        { label: "Cost", value: cover.lapsed ? "Paused" : `${formatUsd(monthUsd)} a month` },
        { label: "Fuel", value: out ? "Empty" : lastsFor(days) },
      ]}
    />
  );

  // ---- Fix for a blocked exit ----
  const fixButton = (r: BlockReason) => {
    if (!copy) return null;
    if (wrongNetwork && (copy.fix === "approve" || copy.fix === "raiseDiscount")) return <SwitchButton action="fix it" size="default" />;
    switch (copy.fix) {
      case "approve":
        return (
          <CartoonButton
            loading={fixTx.busy}
            loadingText={busyText(fixTx.state.phase)}
            onClick={async () => {
              setFixFor(r);
              if (await fixTx.send("Approval", { address: collateral.aToken, abi: erc20Abi, functionName: "approve", args: [shield.executor!, maxUint256] })) await refetch();
            }}
          >
            {copy.button}
          </CartoonButton>
        );
      case "raiseDiscount":
        return (
          <CartoonButton
            loading={fixTx.busy}
            loadingText={busyText(fixTx.state.phase)}
            onClick={async () => {
              setFixFor(r);
              if (await fixTx.send("Max discount change", { address: shield.registry!, abi: positionRegistryAbi, functionName: "setMaxDiscount", args: [config.exitDiscountBps] }))
                await refetch();
            }}
          >
            {copy.button}
          </CartoonButton>
        );
      case "recheck":
        return (
          <CartoonButton variant="white" onClick={() => void refetch()}>
            {copy.button}
          </CartoonButton>
        );
      case "turnOff":
        return (
          <CartoonButton variant="white" onClick={() => setTray("off")} aria-expanded={tray === "off"} aria-controls="tray-off">
            {copy.button}
          </CartoonButton>
        );
      default:
        return (
          <CartoonButton asChild variant={r === "unknown" ? "white" : "primary"}>
            <a href={AAVE_APP} target="_blank" rel="noreferrer">
              {copy.button}
            </a>
          </CartoonButton>
        );
    }
  };

  const quickAdd = (
    <>
      {wrongNetwork ? (
        <SwitchButton action="add fuel" size="default" />
      ) : (
        <CartoonButton loading={fuel.busy} loadingText={busyText(fuel.phase)} onClick={() => void fuel.add(quickUnits)} disabled={quickUnits > cover.usdcBalanceRaw}>
          Add {usdUnits(quickUnits)} of fuel
        </CartoonButton>
      )}
      {quickUnits > cover.usdcBalanceRaw && (
        <p className="c-small mt-2">
          This wallet holds {formatUsd(cover.usdcBalance)} of USDC. Use Add fuel below to pay a different amount or from another chain.
        </p>
      )}
      <TxLine state={fuel.state} className="mt-3" done={fuel.state.label === "Top-up" ? "Fuel added" : undefined} />
    </>
  );

  // ---- Body ----
  const alert = (() => {
    if (readOnly) {
      if (kind === "due" && dueBlocks >= KEEPER_IDLE_BLOCKS && canAct) return <RunExitCallout borrower={user} dueBlocks={dueBlocks} refetch={refetch} />;
      return null;
    }
    switch (kind) {
      case "arming":
        return (
          <Card className="grid items-center gap-[22px] sm:grid-cols-[auto_minmax(0,1fr)]">
            <CountdownRing totalSeconds={config.minCoverSeconds} secondsLeft={armsIn} className="justify-self-center sm:justify-self-auto" />
            <div>
              <h2 className="mb-1.5 font-display text-[24px] leading-[1.1]">Arms in {formatCountdown(armsIn)}</h2>
              <p className="m-0">
                Until then Shield can&rsquo;t step in, even if {asset} hits your line at <b className="num">{usdWhole(linePrice)}</b>. After that it watches every
                block.{arm.armsAtClock ? ` That's at ${arm.armsAtClock}.` : ""}
              </p>
            </div>
          </Card>
        );
      case "low":
        return (
          <Callout tone="heads" icon={<CartoonIcon name="battery" />} title="Add fuel to keep Shield on">
            <p className="mb-3.5">
              {usdUnits(quickUnits)} keeps it on for {lastsFor(days + Number(quickUnits) / 1e6 / Math.max(live.rate * BLOCKS_PER_DAY, 1e-18))} in all at today&rsquo;s rate.
            </p>
            {quickAdd}
          </Callout>
        );
      case "out":
        return (
          <Callout tone="lava" shake icon={<CartoonIcon name="fuel" />} title="Add fuel to switch Shield back on" role="alert">
            <p className="mb-3.5">
              It re-arms {wait} after the fuel lands. Your line: {asset} at {usdWhole(linePrice)}.
            </p>
            {quickAdd}
          </Callout>
        );
      case "blocked":
        return copy && reason ? (
          <div className="grid gap-3">
            <Callout tone="heads" icon={<CartoonIcon name="warn" />} title={copy.title} role="alert">
              <p className="mb-3.5">{copy.text}</p>
              {copy.fix === "approve" && (
                <div className="mb-3.5">
                  <ApprovalNote owner={user} aToken={collateral.aToken} asset={asset} underlying={collateral.symbol} feePct={config.exitDiscountBps / 100} />
                </div>
              )}
              {fixButton(reason)}
              {fixFor === reason && <TxLine state={fixTx.state} className="mt-3" />}
            </Callout>
            <p className="c-small c-muted m-0">Until this is fixed, Aave can liquidate you as if Shield were off. Fuel keeps burning while it is blocked.</p>
          </div>
        ) : null;
      case "due":
        return dueBlocks >= KEEPER_IDLE_BLOCKS && canAct ? (
          <RunExitCallout borrower={user} dueBlocks={dueBlocks} refetch={refetch} />
        ) : (
          <Callout tone="grape" icon={<CartoonIcon name="shield" />} title="Shield is sending the rescue">
            <p className="num">
              Due for {dueBlocks.toLocaleString("en-US")} block{dueBlocks === 1 ? "" : "s"}. If Shield&rsquo;s bot hasn&rsquo;t sent it after {KEEPER_IDLE_BLOCKS}, you can send it
              yourself here.
            </p>
          </Callout>
        );
      default:
        return null;
    }
  })();

  const actions = !readOnly && (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]" role="group" aria-label="Change your cover">
        <CartoonButton
          className="col-span-2 sm:col-span-1"
          variant={tray === "fuel" ? "white" : "primary"}
          aria-expanded={tray === "fuel"}
          aria-controls="tray-fuel"
          onClick={() => setTray(tray === "fuel" ? undefined : "fuel")}
        >
          Add fuel
        </CartoonButton>
        <CartoonButton variant="white" className="whitespace-normal" aria-expanded={tray === "when"} aria-controls="tray-when" onClick={() => setTray(tray === "when" ? undefined : "when")}>
          Change when
        </CartoonButton>
        <CartoonButton variant="white" aria-expanded={tray === "off"} aria-controls="tray-off" onClick={() => setTray(tray === "off" ? undefined : "off")}>
          Turn off
        </CartoonButton>
      </div>
      {tray === "fuel" && (
        <Card id="tray-fuel" aria-label="Add fuel" className="grid gap-4">
          <FuelTray user={user} cover={cover} live={live} wrongNetwork={wrongNetwork} refetch={refetch} rearmNote={cover.lapsed ? `Shield re-arms ${wait} after the fuel lands.` : undefined} />
        </Card>
      )}
      {tray === "when" && (
        <Card id="tray-when" aria-label="Change when Shield steps in" className="grid gap-4">
          <ChangeWhenTray user={user} position={position} collateral={collateral} cover={cover} config={config} wrongNetwork={wrongNetwork} refetch={refetch} />
        </Card>
      )}
      {tray === "off" && (
        <Card id="tray-off" aria-label="Turn Shield off" tone="lava" className="grid gap-3">
          <h2 className="font-display text-[23px] leading-[1.1]">Turn Shield off?</h2>
          <p className="m-0">
            Shield stops watching your loan: if {asset} falls to {usdWhole(linePrice)}, nothing steps in before Aave. The fuel left, about{" "}
            <b className="num">{formatUsd(live.prepaidUsd)}</b>, stays yours: take it back or keep it for next time.
          </p>
          <div className="c-row">
            {wrongNetwork ? (
              <SwitchButton action="turn Shield off" size="default" />
            ) : (
              <CartoonButton
                variant="lava"
                loading={lifecycle.busy}
                loadingText={busyText(lifecycle.state.phase)}
                onClick={async () => {
                  if (await lifecycle.send("Opt-out", { address: shield.registry!, abi: positionRegistryAbi, functionName: "optOut" })) await refetch();
                }}
              >
                Turn Shield off
              </CartoonButton>
            )}
            <CartoonButton variant="white" onClick={() => setTray(undefined)} disabled={lifecycle.busy}>
              Keep Shield on
            </CartoonButton>
          </div>
          {lifecycle.state.label === "Opt-out" && <TxLine state={lifecycle.state} />}
        </Card>
      )}
    </div>
  );

  return (
    <ProtectFrame loanLine={loanLine} head={head} summary={summary} level={level}>
      {banner}
      {alert}
      {facts}
      {actions}
      {kind === "arming" && lifecycle.state.label === "Opt-in" && lifecycle.state.phase !== "idle" && <TxLine state={lifecycle.state} done="Switch on" />}
      {(kind === "protected" || kind === "near" || kind === "arming" || kind === "low") && (
        <p className="c-small c-muted m-0">
          Shield checks your loan every block. Best effort: if {asset} jumps past your line in one move, Aave can still liquidate you. Your line moves with your loan:
          borrow more on Aave and Shield steps in sooner.
        </p>
      )}
      <StatsForNerds
        position={position}
        collateral={collateral}
        config={config}
        trigger={cover.trigger}
        extra={[
          ["Premium paid so far", formatUsd(live.accruedUsd)],
          ["Cover this block", cover.lapsed ? "Paused" : formatUsd(live.rate)],
          ["Rate now", cover.lapsed ? "Paused" : `${formatUsd(cover.livePremiumPerBlockUsd * BLOCKS_PER_YEAR)} a year`],
          ["Fuel left", formatUsd(live.prepaidUsd)],
          ["Last repriced", live.blocksSince === 0 ? "This block" : `${live.blocksSince.toLocaleString("en-US")} blocks ago`],
          ["Most you'll pay in a rescue", `${cover.maxDiscountBps / 100}%`],
          ["Volatility, from Pyth", `${(cover.sigma * 100).toFixed(0)}% a year`],
        ]}
      />
    </ProtectFrame>
  );
}

/** The exit is due and the keeper has not sent it: anyone may (Executor.exit is permissionless). */
function RunExitCallout({ borrower, dueBlocks, refetch }: { borrower: Address; dueBlocks: number; refetch: () => Promise<unknown> }) {
  const tx = useTx();
  return (
    <Callout tone="heads" icon={<CartoonIcon name="hand" />} title="Shield’s bot hasn’t stepped in yet" role="alert">
      <p className="mb-3.5 num">
        The rescue has been due for {dueBlocks.toLocaleString("en-US")} blocks. Anyone can send it, including you. This wallet pays the gas; the contract checks
        every condition.
      </p>
      <CartoonButton
        loading={tx.busy}
        loadingText={busyText(tx.state.phase)}
        onClick={async () => {
          if (await tx.send("Exit", { address: shield.executor!, abi: executorAbi, functionName: "exit", args: [borrower, []] })) await refetch();
        }}
      >
        Run the exit yourself
      </CartoonButton>
      <TxLine state={tx.state} className="mt-3" done="Rescue" />
    </Callout>
  );
}

/** The Add fuel tray: add (Monad or another chain) or take some back. */
function FuelTray({
  user,
  cover,
  live,
  wrongNetwork,
  refetch,
  rearmNote,
}: {
  user: Address;
  cover: Cover;
  live: ReturnType<typeof livePrepaid>;
  wrongNetwork: boolean;
  refetch: () => Promise<unknown>;
  rearmNote?: string;
}) {
  const [mode, setMode] = useState<"add" | "back">("add");
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[23px] leading-[1.1]">{mode === "add" ? "Add fuel" : "Take back fuel"}</h2>
        <ChoiceCards
          variant="pills"
          label="Add or take back"
          value={mode}
          onChange={setMode}
          options={[
            { value: "add", name: "Add" },
            { value: "back", name: "Take back" },
          ]}
        />
      </div>
      <p className="c-small c-muted m-0">
        Fuel left: <b className="num">{formatUsd(live.prepaidUsd)}</b>
        {live.rate > 0 ? `, ${lastsFor(runwayDays(live.prepaidUsd, live.rate))} at today's rate` : ""}. Paying from another chain needs no MON and no network switch.
      </p>
      {mode === "add" ? (
        <AddFuelTray
          user={user}
          cover={cover}
          perBlockUsd={cover.livePremiumPerBlockUsd || live.rate}
          liveBalanceUsd={live.prepaidUsd}
          wrongNetwork={wrongNetwork}
          refetch={refetch}
          rearmNote={rearmNote}
        />
      ) : (
        <TakeBackTray cover={cover} rate={live.rate} blocksSince={live.blocksSince} wrongNetwork={wrongNetwork} refetch={refetch} />
      )}
    </>
  );
}

/**
 * Change when Shield steps in: one wallet prompt (setTrigger). Moving the line earlier (a higher trigger) restarts the
 * waiting period, during which no exit can run at either line; moving it later does not. The maximum rescue fee is
 * set here too.
 */
function ChangeWhenTray({
  user,
  position,
  collateral,
  cover,
  config,
  wrongNetwork,
  refetch,
}: {
  user: Address;
  position: AavePosition;
  collateral: ReserveLine;
  cover: Cover;
  config: ShieldConfig;
  wrongNetwork: boolean;
  refetch: () => Promise<unknown>;
}) {
  const asset = collateralName(collateral.asset).priceName;
  const presets = triggerPresets(position.healthFactor);
  const quotes = useQuotes(
    user,
    collateral.asset,
    presets.filter((p) => !p.disabled).map((p) => p.trigger),
  );
  const [pick, setPick] = useState<string>();
  const chosen = presets.find((p) => p.id === pick && !p.disabled);
  const newTrigger = chosen?.trigger;
  const raising = newTrigger !== undefined && newTrigger > cover.trigger;
  const nearOne = newTrigger !== undefined && newTrigger <= NEAR_ONE;
  const [ack, setAck] = useState(false);
  const tx = useTx();
  const discountTx = useTx();
  const [discount, setDiscount] = useState(cover.maxDiscountBps);
  const now = collateral.priceUsd;
  const currentPrice = priceAtHf(position, collateral, cover.trigger);
  const wait = formatDuration(config.minCoverSeconds);
  return (
    <>
      <div>
        <h2 className="font-display text-[23px] leading-[1.1]">Change when Shield steps in</h2>
        <p className="m-0 mt-1">
          Your line now: <b className="num">{asset} at {usdWhole(currentPrice)}</b>, {pct1(dropTo(now, currentPrice))} below today (health factor {cover.trigger.toFixed(2)}).
        </p>
      </div>
      <ChoiceCards
        label="New line"
        value={pick}
        onChange={(v) => {
          setPick(v);
          setAck(false);
        }}
        options={presets.map((p) => {
          const price = priceAtHf(position, collateral, p.trigger);
          const q = quotes[p.trigger.toFixed(2)];
          const same = p.trigger === cover.trigger;
          return {
            value: p.id,
            name: p.name,
            big: usdWhole(price),
            sub: p.disabled ? (p.disabled === "above" ? `Too close: ${asset} is already near this price` : "Too close to Aave's line") : `${pct1(dropTo(now, price))} below today`,
            cost: p.disabled ? undefined : q ? `${formatUsd(q.annualUsd / 12)} a month` : "Pricing",
            note: same ? "Your line now" : p.trigger > cover.trigger ? "Earlier: restarts the wait" : "Later: no wait",
            disabled: Boolean(p.disabled) || same,
          };
        })}
      />
      {raising && (
        <p className="m-0 rounded-xl border-2 border-ink bg-heads-tint px-3 py-2 text-[15px]" role="note">
          Moving your line earlier restarts the {wait} wait. Until it ends, about {formatClock(Date.now() / 1000 + config.minCoverSeconds)}, Shield can&rsquo;t step in at
          either line.
        </p>
      )}
      {nearOne && (
        <label className="flex items-start gap-3 rounded-xl border-2 border-ink bg-heads-tint p-3 text-[15px]">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--color-grape)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I understand a line this close to Aave leaves little room: a sharp drop can cross it and Aave&rsquo;s line in the same block.</span>
        </label>
      )}
      {wrongNetwork ? (
        <SwitchButton action="move your line" className="c-btn-big w-full" />
      ) : (
        <CartoonButton
          size="big"
          disabled={newTrigger === undefined || (nearOne && !ack)}
          loading={tx.busy}
          loadingText={busyText(tx.state.phase)}
          onClick={async () => {
            if (newTrigger === undefined) return;
            if (await tx.send("Line change", { address: shield.registry!, abi: positionRegistryAbi, functionName: "setTrigger", args: [Math.round(newTrigger * 1e4)] })) {
              setPick(undefined);
              await refetch();
            }
          }}
        >
          Move my line (1 wallet prompt)
        </CartoonButton>
      )}
      <TxLine state={tx.state} done="Line change" />
      <Disclosure summary={`Most you'll pay in a rescue: ${cover.maxDiscountBps / 100}%`}>
        <p className="c-small m-0 mb-3">
          Shield&rsquo;s rescue fee is {config.exitDiscountBps / 100}% today, set by the protocol owner (at most 5%). If it is ever raised above your maximum, Shield
          won&rsquo;t step in until you agree to it.
        </p>
        <ChoiceCards
          variant="pills"
          label="Most you'll pay in a rescue"
          value={String(discount)}
          onChange={(v) => setDiscount(Number(v))}
          options={MAX_DISCOUNTS.filter((d) => d >= config.exitDiscountBps).map((d) => ({ value: String(d), name: `${d / 100}%` }))}
        />
        <div className="mt-3">
          <CartoonButton
            variant="white"
            size="small"
            disabled={discount === cover.maxDiscountBps || wrongNetwork}
            loading={discountTx.busy}
            loadingText={busyText(discountTx.state.phase)}
            onClick={async () => {
              if (await discountTx.send("Max discount change", { address: shield.registry!, abi: positionRegistryAbi, functionName: "setMaxDiscount", args: [discount] })) await refetch();
            }}
          >
            Set my maximum to {discount / 100}%
          </CartoonButton>
        </div>
        <TxLine state={latestTx(discountTx.state)} className="mt-3" done="Maximum change" />
      </Disclosure>
    </>
  );
}
