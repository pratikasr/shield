"use client";

import { ChevronDown, Clock3, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { formatUnits, maxUint256, type Address } from "viem";
import { AmountHint, AmountInput } from "@/components/data/amount-input";
import { Chip } from "@/components/data/chip";
import { Info } from "@/components/data/info";
import { SwitchButton } from "@/components/shell/network-guard";
import { TxStatus, latestTx } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { priceAtHf } from "@/components/borrow/position-panel";
import { AAVE_APP, SectionLabel, Steps, readSetup, useQuote, useSentLock, writeSetup } from "@/components/borrow/cover-shared";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import type { Cover } from "@/hooks/useShieldPosition";
import type { TxHandle, TxRequest, TxState } from "@/hooks/useTx";
import { useTx } from "@/hooks/useTx";
import { erc20Abi, positionRegistryAbi, repricerAbi } from "@/lib/abis";
import { amountText, centsUp, checkAmount, unitsUsd, type AmountCheck } from "@/lib/amount";
import { BLOCKS_PER_DAY, MIN_PREPAY_WAD, formatRunway, runwayDays } from "@/lib/economics";
import { aave, collateralName, shield } from "@/lib/env";
import { formatDuration, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const DISCOUNTS = [100, 200, 300, 500];
export const TRIGGER_PRESETS = [1.03, 1.05, 1.08, 1.1];
/** The app's trigger slider; the contract accepts up to 2.00. */
export const TRIGGER_MIN = 1.01;
export const TRIGGER_MAX = 1.5;
const PREPAY_PRESETS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

const clampTrigger = (t: number) => (Number.isFinite(t) ? Math.min(Math.max(Math.round(t * 100) / 100, TRIGGER_MIN), TRIGGER_MAX) : 1.04);

/** Shown in place of the form when the position cannot be covered, with the next action. */
export function CoverUnavailable({ position, config, handoff }: { position: AavePosition; config?: ShieldConfig; handoff?: TxState }) {
  if (!config) {
    return (
      <div className="panel p-5 sm:p-6" aria-busy="true">
        <p className="text-sm text-muted-foreground">Reading which collateral Shield covers.</p>
      </div>
    );
  }
  const symbolOf = (asset: Address) =>
    position.allReserves.find((r) => r.asset.toLowerCase() === asset.toLowerCase())?.symbol ?? collateralName(asset).symbol;
  const enabled = config.assets.filter((a) => a.enabled);
  const enabledSet = new Set(enabled.map((a) => a.asset.toLowerCase()));
  const disabledSet = new Set(config.assets.filter((a) => !a.enabled).map((a) => a.asset.toLowerCase()));
  const enabledNames = enabled.map((a) => symbolOf(a.asset)).join(" or ") || "a covered asset";
  const suppliesEnabled = position.reserves.some((r) => r.suppliedRaw > 0n && enabledSet.has(r.asset.toLowerCase()));
  const suppliesDisabled = position.reserves.filter((r) => r.suppliedRaw > 0n && disabledSet.has(r.asset.toLowerCase())).map((r) => r.symbol);
  const usdcDebt = position.usdc?.borrowedRaw ?? 0n;
  let title = "";
  let body = "";
  if (position.eMode !== 0) {
    title = "Shield covers positions outside eMode only";
    body = "This position is in eMode. Leave eMode on Aave to protect it.";
  } else if (!suppliesEnabled) {
    title = `Supply ${enabledNames} to be covered`;
    body = suppliesDisabled.length
      ? `${suppliesDisabled.join(" and ")} cover arrives once a ${suppliesDisabled.join(" and ")} swap route exists on Monad. Supply ${enabledNames} on Aave, then come back to set a trigger.`
      : `Shield takes ${enabledNames} at an exit. Supply it on Aave, then come back to set a trigger.`;
  } else if (usdcDebt === 0n) {
    title = "Borrow in USDC to be covered";
    body = "Shield's vault repays USDC debt. This position has no USDC debt to protect.";
  } else {
    title = "This position cannot be covered right now";
    body = "Check the position on Aave and come back.";
  }
  return (
    <div className="panel p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <Button asChild variant="outline" className="mt-5">
        <a href={AAVE_APP} target="_blank" rel="noreferrer">
          Open Aave on Monad
        </a>
      </Button>
      {handoff?.label === "Opt-out" && <TxStatus state={handoff} className="mt-4" />}
    </div>
  );
}

export function CoverSetup({
  user,
  position,
  collateral,
  cover,
  config,
  disabled,
  onTriggerChange,
  refetch,
  lifecycle,
}: {
  user: Address;
  position: AavePosition;
  collateral: ReserveLine;
  cover: Cover;
  config: ShieldConfig;
  disabled: boolean;
  onTriggerChange: (t: number) => void;
  refetch: () => Promise<unknown>;
  /** Opt-in and opt-out share one transaction so their status survives the panel swap. */
  lifecycle: TxHandle;
}) {
  const storeKey = `shield:setup:${user.toLowerCase()}`;
  const [saved] = useState(() => readSetup(storeKey));
  const minDiscount = config.exitDiscountBps;
  const [trigger, setTrigger] = useState(() => clampTrigger(saved.trigger ?? 1.04));
  const [maxDiscount, setMaxDiscount] = useState(() => saved.maxDiscount ?? 100);
  const [prepay, setPrepay] = useState(saved.prepay ?? "");
  const [preset, setPreset] = useState<number | undefined>(saved.preset);
  const [ack, setAck] = useState(false);
  useEffect(() => writeSetup(storeKey, { trigger, maxDiscount, prepay, preset }), [storeKey, trigger, maxDiscount, prepay, preset]);
  useEffect(() => onTriggerChange(trigger), [trigger, onTriggerChange]);

  const quote = useQuote(user, collateral.asset, trigger);
  const tx = useTx();
  const lock = useSentLock();
  const maxDiscountBps = Math.max(maxDiscount, minDiscount);

  // The registry needs 1 USDC prepaid (18-decimal) to opt in; what is still missing, in USDC units, rounded up.
  const funded = cover.prepaidWad >= MIN_PREPAY_WAD;
  const shortWad = funded ? 0n : MIN_PREPAY_WAD - cover.prepaidWad;
  const minUnits = (shortWad + 10n ** 12n - 1n) / 10n ** 12n;
  const perDay = quote ? quote.perBlockUsd * BLOCKS_PER_DAY : 0;
  const forDays = (days: number) => {
    const raw = centsUp(perDay * days);
    return raw > minUnits ? raw : minUnits;
  };
  const suggested = forDays(30);
  const empty = prepay.trim() === "";
  const overBalance = (units: bigint): AmountCheck => ({
    units,
    ok: false,
    tone: "danger",
    message: `This wallet holds ${formatUsd(cover.usdcBalance)} of USDC. Lower the amount or add USDC.`,
  });
  const prepayCheck: AmountCheck = empty
    ? suggested > cover.usdcBalanceRaw
      ? overBalance(suggested)
      : { units: suggested, ok: true, tone: "muted" }
    : checkAmount(prepay, {
        balance: cover.usdcBalanceRaw,
        min: minUnits,
        minMessage: (m) =>
          cover.prepaidWad > 0n
            ? `Opt-in needs at least 1 USDC prepaid. You have ${formatUsd(cover.prepaidUsd)}, so add at least ${unitsUsd(m)}.`
            : "Opt-in needs at least 1 USDC prepaid. Enter 1 or more.",
      });
  const prepayUnits = prepayCheck.units;

  const allowance = cover.aTokenAllowances[collateral.asset.toLowerCase()] ?? 0n;
  const aTokenOk = collateral.suppliedRaw > 0n && allowance >= collateral.suppliedRaw;
  const usdcOk = prepayUnits > 0n && cover.usdcAllowance >= prepayUnits;
  const step = !aTokenOk ? 1 : !funded ? (usdcOk ? 3 : 2) : !cover.active ? 4 : 5;
  const stepKey = step === 2 || step === 3 ? `${step}:${prepayUnits}` : String(step);
  const busy = tx.busy || lifecycle.busy;
  const held = lock.isHeld(stepKey);
  const dueNow = position.healthFactor <= trigger;
  const nearOne = trigger <= 1.02;
  const wait = formatDuration(config.minCoverSeconds);
  const triggerPrice = priceAtHf(position, collateral, trigger);
  const drop = Number.isFinite(triggerPrice) && collateral.priceUsd > 0 ? (collateral.priceUsd - triggerPrice) / collateral.priceUsd : Number.NaN;
  const target = trigger + config.exitHfBuffer;

  const run = async (handle: TxHandle, label: string, req: TxRequest) => {
    const receipt = await handle.send(label, req);
    if (receipt) {
      // Keep this step's button disabled until the chain shows it done.
      lock.hold(stepKey);
      await refetch();
    }
  };

  const action = async () => {
    // The amount is fixed when the flow starts, so the approval and the prepayment use the same figure.
    if (empty && !funded) {
      setPrepay(amountText(prepayUnits));
      setPreset(30);
    }
    if (step === 1) return run(tx, "Approval", { address: collateral.aToken, abi: erc20Abi, functionName: "approve", args: [shield.executor!, maxUint256] });
    if (step === 2) return run(tx, "USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.repricer!, prepayUnits] });
    if (step === 3) return run(tx, "Prepayment", { address: shield.repricer!, abi: repricerAbi, functionName: "topUp", args: [prepayUnits] });
    if (step === 4)
      return run(lifecycle, "Opt-in", {
        address: shield.registry!,
        abi: positionRegistryAbi,
        functionName: "optIn",
        args: [collateral.asset, Math.round(trigger * 1e4), maxDiscountBps],
      });
  };

  const buttonText = ["", `Approve ${collateral.symbol} for exits`, "Approve USDC", `Prepay ${unitsUsd(prepayUnits)}`, `Opt in at ${trigger.toFixed(2)}`][step] ?? "Done";
  const phase = tx.busy ? tx.state.phase : lifecycle.busy ? lifecycle.state.phase : undefined;
  const busyText = phase === "checking" ? "Checking the transaction" : phase === "signing" ? "Check your wallet" : phase === "pending" ? "Sending to Monad" : undefined;
  const locked = cover.active || disabled;
  const runwayFor = (usd: number) => (quote ? formatRunway(runwayDays(usd, quote.perBlockUsd)) : undefined);
  const prepayUsd = Number(formatUnits(prepayUnits, 6));
  const prepayHint = !quote
    ? "Fetching the premium for this trigger."
    : `${empty ? `Suggested ${unitsUsd(prepayUnits)}. ` : ""}Lasts ${runwayFor(prepayUsd + cover.prepaidUsd)} at today's rate.${
        prepayUnits <= minUnits ? " 1 USDC is the least you can prepay to opt in." : ""
      } Withdraw what you do not use at any time.`;

  return (
    <section aria-labelledby="setup-heading" className="panel overflow-hidden">
      <div className="border-b px-5 py-5 sm:px-6">
        <h2 id="setup-heading" className="text-lg font-semibold">
          Protect this position
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the health factor where Shield exits for you: {minDiscount / 100}% at your trigger instead of Aave&rsquo;s{" "}
          {((collateral.liquidationBonus - 1) * 100).toFixed(1)}% liquidation penalty.
        </p>
      </div>

      <div className="grid gap-6 px-5 py-5 sm:px-6">
        <div>
          <SectionLabel htmlFor="trigger" aside={<span className="reading text-[1.5rem] font-semibold leading-none text-caution">{trigger.toFixed(2)}</span>}>
            Exit trigger
          </SectionLabel>
          <Slider
            id="trigger"
            className="mt-4"
            min={TRIGGER_MIN}
            max={TRIGGER_MAX}
            step={0.01}
            value={[trigger]}
            onValueChange={(v) => setTrigger(clampTrigger(v[0]!))}
            aria-label="Trigger health factor"
            valueText={`Health factor ${trigger.toFixed(2)}`}
            disabled={locked}
          />
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Common triggers">
            {TRIGGER_PRESETS.map((t) => (
              <Chip key={t} active={trigger === t} onClick={() => setTrigger(t)} disabled={locked}>
                {t.toFixed(2)}
              </Chip>
            ))}
          </div>
          <p className="mt-3 text-[0.8125rem] text-muted-foreground">
            {dueNow ? (
              <span className="text-caution" role="note">
                Your health factor is already at or below this trigger. Cover there is priced at its highest rate, and the exit runs as soon as the cover arms,{" "}
                {wait} after you opt in, if the health factor is still at or below it.
              </span>
            ) : Number.isFinite(triggerPrice) && triggerPrice > 0 ? (
              <>
                Exits if {collateral.symbol} falls to <span className="font-medium text-foreground num">{formatUsd(triggerPrice)}</span>
                {Number.isFinite(drop) && <span className="num"> ({(drop * 100).toFixed(1)}% below today)</span>}. The exit restores your health factor to{" "}
                {target.toFixed(2)}.
              </>
            ) : (
              <>The exit restores your health factor to {target.toFixed(2)}.</>
            )}
          </p>
        </div>

        <div className="rounded-lg bg-raised p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="flex items-center gap-1 text-sm font-medium">
              Cover cost
              <Info>
                Repriced every 300&nbsp;ms block from your debt, Pyth volatility and how far your health factor sits above the trigger. A trigger closer to
                your health factor costs more; at or below it the rate is the highest. Charged block by block from your prepaid balance; this is the rate
                right now.
              </Info>
            </p>
            <p className="reading text-[1.125rem] font-semibold">
              {quote ? formatUsd(quote.annualUsd) : "..."}
              <span className="text-sm font-normal text-muted-foreground"> a year</span>
            </p>
          </div>
          <p className="mt-1 text-right text-[0.8125rem] text-muted-foreground num">
            {quote ? <>{formatUsd(quote.perBlockUsd)} per block, repriced every 300&nbsp;ms</> : "Fetching the rate for this trigger"}
          </p>
        </div>

        {funded ? (
          <div>
            <p className="text-sm font-medium">Prepaid</p>
            <p className="mt-1 text-[0.9375rem]">
              <strong className="font-semibold num">{formatUsd(cover.prepaidUsd)}</strong> prepaid on chain
              {quote ? `, enough for ${runwayFor(cover.prepaidUsd)} at today's rate` : ""}.
            </p>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">Add more or withdraw it in the prepaid balance panel below.</p>
          </div>
        ) : (
          <div>
            <SectionLabel htmlFor="prepay" aside={<span className="text-[0.8125rem] text-muted-foreground num">Balance {formatUsd(cover.usdcBalance)}</span>}>
              Prepay, USDC
            </SectionLabel>
            <div className="mt-2">
              <AmountInput
                id="prepay"
                value={prepay}
                onChange={(v) => {
                  setPrepay(v);
                  setPreset(undefined);
                }}
                onMax={() => {
                  setPrepay(amountText(cover.usdcBalanceRaw));
                  setPreset(undefined);
                }}
                maxDisabled={cover.usdcBalanceRaw === 0n}
                disabled={disabled}
                check={prepayCheck}
                hintId="prepay-help"
                placeholder={Number(formatUnits(suggested, 6)).toFixed(2)}
              />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label="Prepay for">
              {PREPAY_PRESETS.map((p) => (
                <Chip
                  key={p.days}
                  active={preset === p.days && !empty}
                  onClick={() => {
                    setPrepay(amountText(forDays(p.days)));
                    setPreset(p.days);
                  }}
                  disabled={disabled || !quote}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
            <AmountHint id="prepay-help" check={prepayCheck} className="mt-2.5">
              {prepayHint}
            </AmountHint>
          </div>
        )}

        <details className="group rounded-lg border">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Advanced
            <span className="flex items-center gap-2 text-[0.8125rem] font-normal text-muted-foreground">
              Max discount {maxDiscountBps / 100}%
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            </span>
          </summary>
          <fieldset className="border-t px-4 py-4" disabled={locked}>
            <legend className="sr-only">Most discount you accept</legend>
            <p className="text-sm font-medium">Most discount you accept</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {DISCOUNTS.filter((d) => d >= minDiscount).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMaxDiscount(d)}
                  aria-pressed={maxDiscountBps === d}
                  className={cn(
                    "hit relative h-9 rounded-md border text-sm num disabled:opacity-50",
                    maxDiscountBps === d ? "border-foreground bg-foreground font-semibold text-background" : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d / 100}%
                </button>
              ))}
            </div>
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">
              Shield charges {minDiscount / 100}% today. A higher ceiling only matters if the owner raises it (at most 5%); an exit never takes more than you set.
            </p>
          </fieldset>
        </details>

        {nearOne && (
          <label className="flex items-start gap-3 rounded-lg border border-caution/40 bg-caution-soft p-3 text-[0.8125rem]">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--caution)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              I understand a trigger this close to 1.00 leaves little room: a sharp price drop can cross it and Aave&rsquo;s liquidation line in the same block,
              before an exit can run.
            </span>
          </label>
        )}
      </div>

      <div className="border-t bg-raised/60 px-5 py-5 sm:px-6">
        <Steps
          step={step}
          items={[
            { title: `Approve ${collateral.symbol}`, detail: `Lets Shield move a${collateral.symbol} only inside an exit` },
            { title: "Approve USDC", detail: "For the prepaid premium" },
            { title: "Prepay", detail: "Funds the premium, charged block by block; at least 1 USDC" },
            { title: "Opt in", detail: `Trigger ${trigger.toFixed(2)}, max discount ${maxDiscountBps / 100}%; arms ${wait} later` },
          ]}
        />
        <p className="mt-4 flex items-start gap-2 text-[0.8125rem] text-muted-foreground">
          <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Cover arms {wait} after you opt in. Until then no exit can run, even at the trigger.
        </p>
        {disabled ? (
          <SwitchButton action="opt in" className="mt-4 w-full" />
        ) : (
          <Button
            size="lg"
            className="mt-4 h-12 w-full text-[0.9375rem]"
            onClick={() => void action()}
            disabled={busy || held || step === 5 || ((step === 2 || step === 3) && !prepayCheck.ok) || (step === 4 && nearOne && !ack)}
          >
            {busyText ?? (held ? "Waiting for Monad to confirm" : step === 4 && nearOne && !ack ? "Confirm the note above to opt in" : buttonText)}
          </Button>
        )}
        <TxStatus state={latestTx(tx.state, lifecycle.state)} className="mt-3" />
        <p className="mt-4 flex items-start gap-2 text-[0.75rem] text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Shield can move your a{collateral.symbol} only inside an exit at your trigger, and the exit reverts unless your health factor ends higher than it started.
        </p>
      </div>
    </section>
  );
}
