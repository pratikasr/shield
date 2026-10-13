"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { maxUint256, type Address } from "viem";
import { CrossChainFunding, hasStoredTransfer } from "@/components/aurora/funding-source";
import { ApprovalNote } from "@/components/borrow/approval-note";
import { readSetup, useQuotes, writeSetup } from "@/components/borrow/cover-shared";
import { busyText, LeftoverFuel } from "@/components/borrow/fuel";
import { StatsForNerds } from "@/components/borrow/nerds";
import { MobileSummary, ProtectFrame, StateHead, TxLine, ProtectLevel } from "@/components/borrow/protect-frame";
import {
  compareCosts,
  defaultPreset,
  dropTo,
  fuelOptions,
  lastsFor,
  NEAR_ONE,
  pct1,
  priceAtHf,
  promptsText,
  SAFETY_WORD,
  safetyOf,
  triggerPresets,
  usdUnits,
  usdWhole,
  validPresets,
  type TriggerPreset,
} from "@/components/borrow/protect-model";
import { CartoonButton } from "@/components/cartoon/button";
import { Card } from "@/components/cartoon/card";
import { ChoiceCards } from "@/components/cartoon/choice-cards";
import { Disclosure } from "@/components/cartoon/disclosure";
import { Pill } from "@/components/cartoon/sticker";
import { ProgressTrack } from "@/components/cartoon/progress-track";
import { SwitchButton } from "@/components/shell/network-guard";
import { latestTx } from "@/components/tx/tx-status";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import type { Cover } from "@/hooks/useShieldPosition";
import { useTx, type TxHandle } from "@/hooks/useTx";
import { erc20Abi, positionRegistryAbi, repricerAbi } from "@/lib/abis";
import { MIN_PREPAY_WAD } from "@/lib/economics";
import { aave, collateralName, shield } from "@/lib/env";
import { formatDuration, formatUsd } from "@/lib/format";

type StepId = "allowEth" | "allowUsdc" | "addFuel" | "sendFuel" | "switchOn";

interface Plan {
  steps: StepId[];
  /** Steps already done on chain before this run (a half-finished turn-on, or an approval that still stands). */
  skipped: StepId[];
  trigger: number;
  linePrice: number;
  units: bigint;
  maxDiscountBps: number;
  prepaidAtStart: bigint;
}

const MAX_DISCOUNTS = [100, 200, 300, 500];

/**
 * Not protected: the safety picture, three line cards, three fuel cards, where the fuel comes from, and one "Turn on
 * Shield" button that runs every wallet step still needed, one after another, skipping the ones already done.
 */
export function ProtectSetup({
  user,
  position,
  collateral,
  cover,
  config,
  wrongNetwork,
  refetch,
  lifecycle,
  loanLine,
  notice,
}: {
  user: Address;
  position: AavePosition;
  collateral: ReserveLine;
  cover: Cover;
  config: ShieldConfig;
  wrongNetwork: boolean;
  refetch: () => Promise<unknown>;
  lifecycle: TxHandle;
  loanLine: ReactNode;
  /** A line above the questions, for example after a rescue whose details could not be read. */
  notice?: ReactNode;
}) {
  const asset = collateralName(collateral.asset).priceName;
  const storeKey = `shield:setup:${user.toLowerCase()}`;
  const [saved] = useState(() => readSetup(storeKey));
  const presets = useMemo(() => triggerPresets(position.healthFactor), [position.healthFactor]);
  const valid = validPresets(presets);
  const [presetId, setPresetId] = useState<string | undefined>(saved.preset);
  const selected = valid.find((p) => p.id === presetId) ?? defaultPreset(presets);
  const quotes = useQuotes(user, collateral.asset, valid.map((p) => p.trigger));
  const quote = selected ? quotes[selected.trigger.toFixed(2)] : undefined;
  const [source, setSource] = useState<"monad" | "other">(saved.source ?? "monad");
  const crossChain = Boolean(shield.forwarders);
  useEffect(() => {
    if (crossChain && hasStoredTransfer("premium", user)) setSource("other");
  }, [crossChain, user]);
  const [maxDiscount, setMaxDiscount] = useState(Math.max(100, config.exitDiscountBps));
  const maxDiscountBps = Math.max(maxDiscount, config.exitDiscountBps);
  const [ack, setAck] = useState(false);

  // Fuel: the registry needs 1 USDC prepaid (18 decimals) to opt in; what is missing, in USDC units, rounded up.
  const funded = cover.prepaidWad >= MIN_PREPAY_WAD;
  const shortWad = funded ? 0n : MIN_PREPAY_WAD - cover.prepaidWad;
  const minUnits = (shortWad + 10n ** 12n - 1n) / 10n ** 12n;
  const fuels = useMemo(
    () => (quote ? fuelOptions({ perBlockUsd: quote.perBlockUsd, minUnits, prepaidUsd: cover.prepaidUsd, funded }) : []),
    [quote, minUnits, cover.prepaidUsd, funded],
  );
  const [fuelId, setFuelId] = useState<string | undefined>(saved.fuel);
  const fuel = fuels.find((f) => f.id === fuelId) ?? (funded ? fuels[0] : (fuels[1] ?? fuels[0]));
  const fuelUnits = fuel?.units ?? 0n;
  useEffect(() => writeSetup(storeKey, { preset: selected?.id, fuel: fuel?.id, source }), [storeKey, selected?.id, fuel?.id, source]);

  // The picture and the sentence, at the chosen line.
  const now = collateral.priceUsd;
  const aavePrice = priceAtHf(position, collateral, 1);
  const drop = dropTo(now, aavePrice);
  const safety = safetyOf(drop);
  const trigger = selected?.trigger;
  const linePrice = trigger !== undefined ? priceAtHf(position, collateral, trigger) : Number.NaN;
  const costs = trigger !== undefined ? compareCosts(position, collateral, trigger, config) : undefined;
  const monthUsd = quote ? quote.annualUsd / 12 : undefined;
  const wait = formatDuration(config.minCoverSeconds);

  // What is already done on chain.
  const allowance = cover.aTokenAllowances[collateral.asset.toLowerCase()] ?? 0n;
  const ethAllowed = collateral.suppliedRaw > 0n && allowance >= collateral.suppliedRaw;
  const usdcAllowed = fuelUnits === 0n || cover.usdcAllowance >= fuelUnits;
  const overBalance = source === "monad" && fuelUnits > cover.usdcBalanceRaw;
  const nearOne = trigger !== undefined && trigger <= NEAR_ONE;

  const buildPlan = (): Plan | undefined => {
    if (!selected || trigger === undefined) return undefined;
    const steps: StepId[] = [];
    const skipped: StepId[] = [];
    (ethAllowed ? skipped : steps).push("allowEth");
    if (fuelUnits > 0n) {
      if (source === "monad") {
        (usdcAllowed ? skipped : steps).push("allowUsdc");
        steps.push("addFuel");
      } else steps.push("sendFuel");
    }
    steps.push("switchOn");
    return { steps, skipped, trigger, linePrice, units: fuelUnits, maxDiscountBps, prepaidAtStart: cover.prepaidWad };
  };
  const preview = buildPlan();
  const promptsLeft = preview ? preview.steps.filter((s) => s !== "sendFuel").length : 0;

  // The run: one step after another, stopping at a failure (with "Try again") or at fuel sent from another chain.
  const tx = useTx();
  const [plan, setPlan] = useState<Plan>();
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const coverRef = useRef(cover);
  coverRef.current = cover;
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  const exec = async (id: StepId, p: Plan): Promise<boolean> => {
    const send = async (handle: TxHandle, label: string, req: Parameters<TxHandle["send"]>[1]) => {
      const receipt = await handle.send(label, req);
      if (!receipt) return false;
      await refetch();
      return true;
    };
    switch (id) {
      case "allowEth":
        return send(tx, "Approval", { address: collateral.aToken, abi: erc20Abi, functionName: "approve", args: [shield.executor!, maxUint256] });
      case "allowUsdc":
        return send(tx, "USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.repricer!, p.units] });
      case "addFuel":
        return send(tx, "Prepayment", { address: shield.repricer!, abi: repricerAbi, functionName: "topUp", args: [p.units] });
      case "switchOn":
        return send(lifecycle, "Opt-in", {
          address: shield.registry!,
          abi: positionRegistryAbi,
          functionName: "optIn",
          args: [collateral.asset, Math.round(p.trigger * 1e4), p.maxDiscountBps],
        });
      default:
        return false;
    }
  };

  const fuelLanded = (p: Plan) => coverRef.current.prepaidWad >= MIN_PREPAY_WAD && coverRef.current.prepaidWad > p.prepaidAtStart;

  const run = async (p: Plan, from: number) => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    try {
      for (let i = from; i < p.steps.length; i++) {
        if (stopRef.current) return;
        setIdx(i);
        const id = p.steps[i]!;
        if (id === "sendFuel") {
          if (fuelLanded(p)) continue;
          return;
        }
        if (!(await exec(id, p))) return;
      }
      setIdx(p.steps.length);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  // Fuel sent from another chain: once it is credited the run moves on to "Switch on", which waits for a click.
  const currentId = plan?.steps[idx];
  useEffect(() => {
    if (plan && currentId === "sendFuel" && fuelLanded(plan)) setIdx((i) => i + 1);
  }, [plan, currentId, cover.prepaidWad]);

  // Keyboard and screen reader users land on each new step's heading.
  useEffect(() => {
    if (plan) stepHeading.current?.focus({ preventScroll: true });
  }, [plan, idx]);

  const start = () => {
    const p = buildPlan();
    if (!p) return;
    setPlan(p);
    setIdx(0);
    tx.reset();
    window.scrollTo({ top: 0, behavior: "smooth" });
    void run(p, 0);
  };
  const stop = useCallback(() => {
    stopRef.current = true;
    setPlan(undefined);
    setTimeout(() => headRef.current?.focus({ preventScroll: true }), 30);
  }, []);

  // Phones: the main button stays reachable at the bottom while the real one is off screen.
  const mainButton = useRef<HTMLDivElement>(null);
  const [mainVisible, setMainVisible] = useState(true);
  useEffect(() => {
    const el = mainButton.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setMainVisible(Boolean(e?.isIntersecting)), { rootMargin: "0px 0px -40px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [plan]);

  const level = (mood: "careful" | "danger" | "chill" | "arming") => (
    <ProtectLevel
      now={now}
      aave={aavePrice}
      line={Number.isFinite(linePrice) && linePrice > 0 ? (plan?.linePrice ?? linePrice) : null}
      lineMode="preview"
      mood={mood}
      asset={asset}
     
    />
  );

  // ---- Turning on ----
  if (plan) {
    const n = plan.steps.length;
    const at = Math.min(idx, n - 1);
    const id = plan.steps[at]!;
    const amt = usdUnits(plan.units);
    const lineText = usdWhole(plan.linePrice);
    const copy: Record<StepId, { short: string; title: string; what: ReactNode; button: string }> = {
      allowEth: {
        short: `Allow ${asset}`,
        title: "Let Shield take its slice, only in a rescue",
        what: <ApprovalNote owner={user} aToken={collateral.aToken} asset={asset} underlying={collateral.symbol} feePct={config.exitDiscountBps / 100} />,
        button: "Approve in wallet",
      },
      allowUsdc: { short: "Allow USDC", title: "Let Shield collect your fuel", what: `An approval for ${amt} of USDC, the fuel you picked. Nothing moves yet.`, button: "Approve in wallet" },
      addFuel: { short: "Add fuel", title: `Add ${amt} of fuel`, what: "Moves the USDC into Shield. Take back what you don't use any time.", button: "Confirm in wallet" },
      sendFuel: {
        short: "Send fuel",
        title: `Send about ${amt} from another chain`,
        what: "Pay with a stablecoin on another chain through Aurora Intents; this step needs no MON. Switch on unlocks once the fuel is credited on Monad, because Shield needs at least $1 of fuel first.",
        button: "Waiting for your fuel to land",
      },
      switchOn: { short: "Switch on", title: `Switch Shield on at ${asset} ${lineText}`, what: `Saves your line on chain. Shield arms ${wait} later.`, button: "Confirm in wallet" },
    };
    const c = copy[id];
    const handle = id === "switchOn" ? lifecycle : tx;
    const failed = !running && handle.state.phase === "error";
    const waitingFuel = id === "sendFuel" && !fuelLanded(plan);
    const done = idx >= n;
    const doneNames: Record<StepId, string> = { allowEth: `the ${asset} approval`, allowUsdc: "the USDC approval", addFuel: "the fuel", sendFuel: "the fuel", switchOn: "switching on" };
    const skippedText = plan.skipped.length
      ? `Already done, so skipped: ${plan.skipped.map((s) => doneNames[s]).join(" and ")}.${plan.skipped.includes("allowEth") ? " Your earlier approval still stands." : ""}`
      : undefined;
    return (
      <ProtectFrame
        loanLine={loanLine}
        levelLast
        head={
          <StateHead
            headingRef={headRef}
            sticker="Turning on"
            tone="arming"
            title="Turning on Shield."
            say={`${n === 1 ? "One wallet prompt" : "A few wallet prompts"}. Here is what each one is for.`}
          />
        }
        level={level("arming")}
      >
        <Card>
          <ProgressTrack steps={plan.steps.map((s) => ({ label: copy[s].short }))} current={done ? n : idx} label="Turning on Shield" />
          <div className="mt-[22px]" aria-live="polite">
            <p className="mb-1 font-bold text-ink-soft">
              Step {at + 1} of {n}
            </p>
            <h2 ref={stepHeading} tabIndex={-1} className="mb-2 font-display text-[24px] leading-[1.1] outline-none sm:text-[28px]">
              {c.title}
            </h2>
            {typeof c.what === "string" ? <p className="m-0">{c.what}</p> : c.what}
            {id === "sendFuel" && (
              <div className="mt-4">
                <CrossChainFunding kind="premium" owner={user} refundTo={user} wrongNetwork={wrongNetwork} onSwept={() => void refetch()} />
              </div>
            )}
            <div className="mt-4 grid gap-3">
              {wrongNetwork && id !== "sendFuel" ? (
                <SwitchButton action="continue" className="c-btn-big w-full" />
              ) : waitingFuel ? (
                <CartoonButton size="big" loading loadingText="Waiting for your fuel to land">
                  {c.button}
                </CartoonButton>
              ) : (
                <CartoonButton size="big" loading={running || handle.busy} loadingText={busyText(handle.state.phase)} onClick={() => void run(plan, at)}>
                  {failed ? "Try again" : c.button}
                </CartoonButton>
              )}
              <TxLine state={latestTx(tx.state, lifecycle.state)} />
              {skippedText && <p className="c-small c-muted m-0">{skippedText}</p>}
              <CartoonButton variant="quiet" className="justify-self-start" onClick={stop}>
                Stop and go back
              </CartoonButton>
            </div>
          </div>
        </Card>
      </ProtectFrame>
    );
  }

  // ---- Not protected ----
  const mood = safety === "danger" ? "danger" : safety === "careful" ? "careful" : "chill";
  const presetOption = (p: TriggerPreset) => {
    const price = priceAtHf(position, collateral, p.trigger);
    const d = dropTo(now, price);
    const q = quotes[p.trigger.toFixed(2)];
    const near = d < 0.03 && p.id === "early";
    return {
      value: p.id,
      name: p.name,
      big: Number.isFinite(price) && price > 0 ? usdWhole(price) : `HF ${p.trigger.toFixed(2)}`,
      sub: p.disabled ? (p.disabled === "above" ? `Too close: ${asset} is already near this price` : "Too close to Aave's line") : `${pct1(d)} below today`,
      cost: p.disabled ? undefined : q ? `${formatUsd(q.annualUsd / 12)} a month` : "Pricing",
      note: p.disabled ? undefined : near ? `${p.note} ${asset} often moves this much in a day.` : p.note,
      disabled: Boolean(p.disabled),
      ariaLabel: p.disabled
        ? `${p.name}: not available, too close`
        : `${p.name}: Shield steps in if ${asset} falls to ${usdWhole(price)}, ${pct1(d)} below today${q ? `, about ${formatUsd(q.annualUsd / 12)} a month` : ""}`,
    };
  };

  const summarySentence =
    selected && costs ? (
      <>
        If {asset} falls to <b className="num">{usdWhole(linePrice)}</b>, Shield pays back about <b className="num">{formatUsd(costs.exit.repayUsd)}</b> of your loan and takes {asset}{" "}
        worth <b className="num">{formatUsd(costs.shieldTakesUsd)}</b>, the repaid amount plus {config.exitDiscountBps / 100}%.{" "}
        {fuel ? (
          fuelUnits > 0n ? (
            <>
              You pay <b className="num">{usdUnits(fuelUnits)}</b> now, enough for {lastsFor(fuel.days)}.
            </>
          ) : (
            <>You pay nothing more now: the {formatUsd(cover.prepaidUsd)} of fuel already there lasts {lastsFor(fuel.days)}.</>
          )
        ) : null}
      </>
    ) : null;

  const canStart = Boolean(selected && fuel && !overBalance && (!nearOne || ack));
  const startButton = wrongNetwork ? (
    <SwitchButton action="turn on Shield" className="c-btn-big w-full" />
  ) : (
    <CartoonButton size="big" disabled={!canStart || lifecycle.busy} onClick={start}>
      Turn on Shield
    </CartoonButton>
  );

  return (
    <ProtectFrame
      loanLine={loanLine}
      head={
        <StateHead
          headingRef={headRef}
          sticker={SAFETY_WORD[safety]}
          tone={safety}
          pill={<Pill dot="off">Shield is off</Pill>}
          title={
            Number.isFinite(drop) && aavePrice > 0 ? (
              <>
                {asset} can fall {pct1(drop)} before Aave liquidates you.
              </>
            ) : (
              <>Aave can&rsquo;t liquidate this loan on {asset}&rsquo;s price alone.</>
            )
          }
          say={
            aavePrice > 0 ? (
              <>
                That&rsquo;s {asset} at <b className="num">{usdWhole(aavePrice)}</b>. Pick a price above it where Shield steps in first.
              </>
            ) : undefined
          }
        />
      }
      summary={
        <MobileSummary
          rows={[
            { label: "Status", value: "Shield is off" },
            { label: "Aave liquidates at", value: aavePrice > 0 ? usdWhole(aavePrice) : "n/a" },
            { label: "Shield would step in at", value: Number.isFinite(linePrice) ? usdWhole(linePrice) : "Pick a line" },
            { label: "Cost", value: monthUsd !== undefined ? `${formatUsd(monthUsd)} a month` : "Pricing" },
          ]}
        />
      }
      level={level(mood)}
    >
      {notice}
      <section className="grid gap-3.5" aria-labelledby="q-line">
        <div className="flex items-baseline gap-3">
          <span className="grid size-[34px] flex-none -translate-y-0.5 place-items-center rounded-full bg-ink font-display text-[19px] text-white" aria-hidden>
            1
          </span>
          <h2 id="q-line" className="font-display text-[23px] leading-[1.1] sm:text-[25px]">
            When should Shield step in?
          </h2>
        </div>
        <ChoiceCards labelledBy="q-line" value={selected?.id} onChange={(v) => setPresetId(v)} options={presets.map(presetOption)} />
        <p className="c-small c-muted m-0">Your line moves with your loan. Borrow more on Aave and Shield steps in sooner; repay and it steps in later.</p>
      </section>

      <section className="grid gap-3.5" aria-labelledby="q-fuel">
        <div className="flex items-baseline gap-3">
          <span className="grid size-[34px] flex-none -translate-y-0.5 place-items-center rounded-full bg-ink font-display text-[19px] text-white" aria-hidden>
            2
          </span>
          <h2 id="q-fuel" className="font-display text-[23px] leading-[1.1] sm:text-[25px]">
            How much fuel?
          </h2>
        </div>
        <p className="c-muted m-0 text-[15px]">
          {funded
            ? `You have ${formatUsd(cover.prepaidUsd)} of fuel from before. Keep it, or add more.`
            : "Fuel is USDC you prepay. It burns slowly while Shield is on. Take back what's left any time."}
        </p>
        {fuels.length ? (
          <ChoiceCards
            labelledBy="q-fuel"
            value={fuel?.id}
            onChange={(v) => setFuelId(v)}
            options={fuels.map((f) => ({
              value: f.id,
              name: f.label,
              big: f.units > 0n ? usdUnits(f.units) : formatUsd(cover.prepaidUsd),
              sub: f.sub,
            }))}
          />
        ) : (
          <div className="c-choices" aria-busy="true" aria-label="Pricing the fuel">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[118px] rounded-[18px] border-[2.5px] border-ink/20 bg-cloud/60" />
            ))}
          </div>
        )}
        {crossChain && (
          <div className="grid gap-2">
            <ChoiceCards
              variant="pills"
              label="Pay with"
              value={source}
              onChange={(v) => setSource(v)}
              options={[
                { value: "monad", name: "USDC on Monad" },
                { value: "other", name: "From another chain" },
              ]}
            />
            {source === "other" && (
              <p className="c-small c-muted m-0">
                Pay the fuel with a stablecoin from another chain through Aurora Intents; that payment needs no MON. The other {promptsLeft === 1 ? "prompt is" : `${promptsText(promptsLeft).toLowerCase().replace(" wallet", "")} are`} on Monad and
                need a little MON for gas.
              </p>
            )}
          </div>
        )}
        {cover.prepaidWad > 0n && !funded && (
          <LeftoverFuel cover={cover} wrongNetwork={wrongNetwork} refetch={refetch} text="It is less than the $1 Shield needs to start, so it is topped up by the fuel you pick. Or take it back." />
        )}
      </section>

      <Card className="grid gap-4">
        <p className="m-0 text-[17px] leading-[1.45] sm:text-[19px]">{summarySentence}</p>
        {costs && costs.aave.penaltyUsd > 0 && (
          <p className="c-small c-muted m-0">
            Aave&rsquo;s liquidators would take {asset} worth {formatUsd(costs.aaveTakesUsd)} for the same repayment, a {((collateral.liquidationBonus - 1) * 100).toFixed(1)}% bonus.
          </p>
        )}
        {overBalance && (
          <p className="m-0 rounded-xl border-2 border-ink bg-lava-tint px-3 py-2 text-[15px] font-semibold" role="alert">
            This wallet holds {formatUsd(cover.usdcBalance)} of USDC. Pick less fuel{crossChain ? ", or pay from another chain" : ""}.
          </p>
        )}
        {nearOne && (
          <label className="flex items-start gap-3 rounded-xl border-2 border-ink bg-heads-tint p-3 text-[15px]">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--color-grape)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I understand a line this close to Aave leaves little room: a sharp drop can cross it and Aave&rsquo;s line in the same block, before Shield can step in.</span>
          </label>
        )}
        <div ref={mainButton}>{startButton}</div>
        <p className="c-small c-muted m-0">
          {promptsText(promptsLeft)}
          {source === "other" && fuelUnits > 0n ? " on Monad, plus the payment from the other chain" : ""}. Shield arms {wait} after the last one.
          {preview?.skipped.includes("allowEth") ? " Your earlier ETH approval still stands, so that step is skipped." : ""}
        </p>
        <Disclosure summary={`Most you'll pay in a rescue: ${maxDiscountBps / 100}%`}>
          <p className="c-small m-0 mb-3">
            Shield&rsquo;s rescue fee is {config.exitDiscountBps / 100}% today, set by the protocol owner (at most 5%). If it is ever raised above your maximum, Shield
            won&rsquo;t step in until you agree to it.
          </p>
          <ChoiceCards
            variant="pills"
            label="Most you'll pay in a rescue"
            value={String(maxDiscountBps)}
            onChange={(v) => setMaxDiscount(Number(v))}
            options={MAX_DISCOUNTS.filter((d) => d >= config.exitDiscountBps).map((d) => ({ value: String(d), name: `${d / 100}%` }))}
          />
        </Disclosure>
      </Card>

      <StatsForNerds position={position} collateral={collateral} config={config} trigger={trigger} />

      {!mainVisible && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-[2.5px] border-ink bg-sky/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm lg:hidden">
          <p className="m-0 mb-2 text-center text-[14.5px] font-semibold num">
            {Number.isFinite(linePrice) ? `Steps in at ${asset} ${usdWhole(linePrice)}` : ""}
            {monthUsd !== undefined ? `, ${formatUsd(monthUsd)} a month` : ""}
          </p>
          {wrongNetwork ? (
            <SwitchButton action="turn on Shield" className="c-btn-big w-full" />
          ) : (
            <CartoonButton size="big" disabled={!canStart || lifecycle.busy} onClick={() => (nearOne && !ack ? mainButton.current?.scrollIntoView({ block: "center" }) : start())}>
              Turn on Shield
            </CartoonButton>
          )}
        </div>
      )}
    </ProtectFrame>
  );
}
