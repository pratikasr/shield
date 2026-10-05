"use client";

import { Check, ChevronDown, ShieldAlert, ShieldCheck, Clock3, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { maxUint256, parseUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { Info } from "@/components/data/info";
import { TokenIcon } from "@/components/data/token";
import { SwitchButton } from "@/components/shell/network-guard";
import { TxStatus } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { priceAtHf } from "@/components/borrow/position-panel";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import { useOnBlock } from "@/hooks/useLiveBlock";
import type { Cover } from "@/hooks/useShieldPosition";
import { useTx } from "@/hooks/useTx";
import { erc20Abi, positionRegistryAbi, repricerAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { BLOCKS_PER_DAY, EXIT_BUFFER, formatRunway, runwayDays } from "@/lib/economics";
import { aave, shield } from "@/lib/env";
import { formatToken, formatUsd, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const chainId = monadMainnet.id;
const DISCOUNTS = [100, 200, 300, 500];
const TRIGGER_PRESETS = [1.03, 1.05, 1.08, 1.1];
const PREPAY_PRESETS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

function useQuote(user: Address, collateral: Address, trigger: number) {
  const q = useReadContract({
    address: shield.repricer,
    abi: repricerAbi,
    functionName: "quoteFor",
    args: [user, collateral, Math.round(trigger * 1e4)],
    chainId,
    query: { enabled: Boolean(shield.repricer) },
  });
  useOnBlock(() => void q.refetch());
  const d = q.data as readonly [bigint, bigint, bigint, bigint] | undefined;
  return d ? { perBlockUsd: toNumber(d[0], 18), sigma: toNumber(d[2], 18), annualUsd: toNumber(d[3], 18) } : undefined;
}

function SectionLabel({ htmlFor, children, aside }: { htmlFor?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {children}
        </Label>
      ) : (
        <p className="text-sm font-medium">{children}</p>
      )}
      {aside}
    </div>
  );
}

function Chip({ active, onClick, children, disabled }: { active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "h-8 rounded-full border px-3 text-[0.8125rem] font-medium transition-colors num disabled:opacity-50",
        active ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:border-input hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Steps({ step, items }: { step: number; items: { title: string; detail: string }[] }) {
  return (
    <ol className="grid gap-0" aria-label="Steps">
      {items.map((it, i) => {
        const n = i + 1;
        const state = step > n ? "done" : step === n ? "current" : "todo";
        return (
          <li key={it.title} className="relative grid grid-cols-[1.5rem_1fr] gap-x-3 pb-3 last:pb-0" aria-current={state === "current" ? "step" : undefined}>
            {i < items.length - 1 && <span className={cn("absolute left-[0.6875rem] top-6 h-[calc(100%-1.25rem)] w-px", state === "done" ? "bg-safe" : "bg-border")} aria-hidden />}
            <span
              className={cn(
                "relative mt-0.5 inline-flex size-6 items-center justify-center rounded-full border text-[0.6875rem] font-semibold num",
                state === "done" && "border-safe bg-safe text-white dark:text-background",
                state === "current" && "border-foreground bg-foreground text-background",
                state === "todo" && "bg-card text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3.5" aria-label="Done" /> : n}
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm font-medium", state === "todo" && "text-muted-foreground")}>{it.title}</p>
              <p className="text-[0.8125rem] text-muted-foreground">{it.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Shown in place of the form when the wallet's position cannot be covered, with the next action. */
export function CoverUnavailable({ position }: { position: AavePosition }) {
  const usdcDebt = position.reserves.find((r) => r.symbol === "USDC")?.borrowed ?? 0;
  const covered = position.reserves.some((r) => r.supplied > 0 && (r.symbol === "WETH" || r.symbol === "cbBTC"));
  let title = "";
  let body = "";
  if (position.eMode !== 0) {
    title = "eMode positions are not covered";
    body = "Aave's eMode liquidation bonus on Monad is 1%, the same as Shield's discount, so cover would save you nothing. Leave eMode on Aave to protect this position.";
  } else if (!covered) {
    title = "Supply WETH or cbBTC to be covered";
    body = "Shield takes WETH or cbBTC collateral at an exit. Supply one of them on Aave, then come back to set a trigger.";
  } else if (usdcDebt === 0) {
    title = "Borrow in USDC to be covered";
    body = "Shield's vault repays USDC debt. This position has no USDC debt to protect.";
  } else return null;
  return (
    <div className="panel p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <Button asChild variant="outline" className="mt-5">
        <a href="https://app.aave.com/?marketName=proto_monad_v3" target="_blank" rel="noreferrer">
          Open Aave on Monad
        </a>
      </Button>
    </div>
  );
}

export function CoverSetup({
  user,
  position,
  collateral,
  cover,
  disabled,
  onTriggerChange,
  onDone,
}: {
  user: Address;
  position: AavePosition;
  collateral: ReserveLine;
  cover?: Cover;
  disabled: boolean;
  onTriggerChange: (t: number) => void;
  onDone: () => void;
}) {
  const [trigger, setTrigger] = useState(1.04);
  const [maxDiscount, setMaxDiscount] = useState(100);
  const [prepay, setPrepay] = useState("");
  const [ack, setAck] = useState(false);
  const quote = useQuote(user, collateral.asset, trigger);
  const tx = useTx();
  const [lastLabel, setLastLabel] = useState("");

  useEffect(() => onTriggerChange(trigger), [trigger, onTriggerChange]);

  const perDay = quote ? quote.perBlockUsd * BLOCKS_PER_DAY : 0;
  const forDays = (days: number) => Math.max(1, Math.ceil(perDay * days * 100) / 100);
  const suggested = quote ? forDays(30) : 1;
  const prepayValue = prepay === "" ? suggested : Number(prepay);
  const prepayUnits = Number.isFinite(prepayValue) && prepayValue > 0 ? parseUnits(prepayValue.toFixed(6), 6) : 0n;
  const usdcBalance = cover?.usdcBalance ?? 0;
  const supplied = parseUnits(collateral.supplied.toFixed(collateral.decimals), collateral.decimals);

  const aTokenOk = (cover?.aTokenAllowance ?? 0n) >= supplied;
  const usdcOk = (cover?.usdcAllowance ?? 0n) >= prepayUnits && prepayUnits > 0n;
  const optedIn = cover?.active ?? false;
  // Prepay first: the balance persists on its own, so opting in last arms the trigger the moment cover exists.
  const funded = (cover?.prepaidUsd ?? 0) > 0;
  const step = !aTokenOk ? 1 : !funded ? (usdcOk ? 3 : 2) : !optedIn ? 4 : 5;
  const busy = tx.state.phase === "signing" || tx.state.phase === "pending";
  const tooLittle = prepayValue > usdcBalance;
  const dueNow = position.healthFactor <= trigger;
  const nearOne = trigger <= 1.02;
  const triggerPrice = priceAtHf(position, collateral, trigger);
  const drop = Number.isFinite(triggerPrice) && collateral.priceUsd > 0 ? (collateral.priceUsd - triggerPrice) / collateral.priceUsd : Number.NaN;

  const run = async (label: string, args: Parameters<typeof tx.send>[0]) => {
    setLastLabel(label);
    const r = await tx.send(args);
    if (r) onDone();
  };

  const action = () => {
    if (step === 1)
      return run("Approval", { address: collateral.aToken, abi: erc20Abi, functionName: "approve", args: [shield.executor!, maxUint256], chainId });
    if (step === 2)
      return run("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.repricer!, prepayUnits], chainId });
    if (step === 3)
      return run("Prepayment", { address: shield.repricer!, abi: repricerAbi, functionName: "topUp", args: [prepayUnits], chainId });
    if (step === 4)
      return run("Opt-in", {
        address: shield.registry!,
        abi: positionRegistryAbi,
        functionName: "optIn",
        args: [collateral.asset, Math.round(trigger * 1e4), maxDiscount],
        chainId,
      });
  };

  const buttonText = ["", `Approve ${collateral.symbol} for exits`, "Approve USDC", `Prepay ${formatUsd(prepayValue)}`, `Opt in at ${trigger.toFixed(2)}`][step] ?? "Done";
  const locked = optedIn || disabled;

  return (
    <section aria-labelledby="setup-heading" className="panel overflow-hidden">
      <div className="border-b px-5 py-5 sm:px-6">
        <h2 id="setup-heading" className="text-lg font-semibold">
          Protect this position
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the health factor where Shield exits for you: 1% at your trigger instead of Aave&rsquo;s{" "}
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
            min={1.01}
            max={1.5}
            step={0.01}
            value={[trigger]}
            onValueChange={(v) => setTrigger(Number(v[0]!.toFixed(2)))}
            aria-label="Trigger health factor"
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
                Your health factor is already at or below this trigger, so the exit would run at the next block after you opt in.
              </span>
            ) : Number.isFinite(triggerPrice) && triggerPrice > 0 ? (
              <>
                Exits if {collateral.symbol} falls to <span className="font-medium text-foreground num">{formatUsd(triggerPrice)}</span>
                {Number.isFinite(drop) && <span className="num"> ({(drop * 100).toFixed(1)}% below today)</span>}. The exit restores your health
                factor to {(trigger + EXIT_BUFFER).toFixed(2)}.
              </>
            ) : (
              <>The exit restores your health factor to {(trigger + EXIT_BUFFER).toFixed(2)}.</>
            )}
          </p>
        </div>

        <div className="rounded-lg bg-raised p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="flex items-center gap-1 text-sm font-medium">
              Cover cost
              <Info>
                Repriced every 300 ms block from your debt, Pyth volatility and how far your health factor sits above the trigger. A trigger
                closer to your health factor costs more. Charged block by block from your prepaid balance; this is the rate right now.
              </Info>
            </p>
            <p className="reading text-[1.125rem] font-semibold">{quote ? `${formatUsd(quote.annualUsd)}` : "..."}<span className="text-sm font-normal text-muted-foreground"> a year</span></p>
          </div>
          <p className="mt-1 text-right text-[0.8125rem] text-muted-foreground num">{quote ? `${formatUsd(quote.perBlockUsd)} per block, repriced every 300 ms` : "Fetching the rate for this trigger"}</p>
        </div>

        <div>
          <SectionLabel htmlFor="prepay" aside={<span className="text-[0.8125rem] text-muted-foreground num">Balance {formatUsd(usdcBalance)}</span>}>
            Prepay, USDC
          </SectionLabel>
          <div className="relative mt-2">
            <TokenIcon symbol="USDC" size={22} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              id="prepay"
              inputMode="decimal"
              className="h-12 pl-11 pr-16 text-base num"
              placeholder={suggested.toFixed(2)}
              value={prepay}
              onChange={(e) => setPrepay(e.target.value.replace(/[^0-9.]/g, ""))}
              aria-describedby="prepay-help"
              disabled={funded || disabled}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 h-8 -translate-y-1/2 rounded-md px-2.5 text-[0.8125rem] font-medium text-brand hover:bg-brand-soft disabled:opacity-50"
              onClick={() => setPrepay(String(Math.floor(usdcBalance * 100) / 100))}
              disabled={funded || disabled || usdcBalance <= 0}
            >
              Max
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label="Prepay for">
            {PREPAY_PRESETS.map((p) => (
              <Chip key={p.days} onClick={() => setPrepay(forDays(p.days).toFixed(2))} disabled={funded || disabled || !quote}>
                {p.label}
              </Chip>
            ))}
          </div>
          <p id="prepay-help" className={cn("mt-2.5 text-[0.8125rem]", tooLittle ? "text-danger" : "text-muted-foreground")}>
            {tooLittle
              ? `This wallet holds ${formatUsd(usdcBalance)} of USDC. Lower the amount or add USDC.`
              : quote
                ? `Lasts ${formatRunway(runwayDays(prepayValue, quote.perBlockUsd))} at today's rate. Withdraw what you do not use at any time.`
                : "Fetching the premium for this trigger."}
          </p>
        </div>

        <details className="group rounded-lg border">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Advanced
            <span className="flex items-center gap-2 text-[0.8125rem] font-normal text-muted-foreground">
              Max discount {maxDiscount / 100}%
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            </span>
          </summary>
          <fieldset className="border-t px-4 py-4" disabled={locked}>
            <legend className="sr-only">Most discount you accept</legend>
            <p className="text-sm font-medium">Most discount you accept</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {DISCOUNTS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMaxDiscount(d)}
                  aria-pressed={maxDiscount === d}
                  className={cn(
                    "h-9 rounded-md border text-sm num disabled:opacity-50",
                    maxDiscount === d ? "border-foreground bg-foreground font-semibold text-background" : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d / 100}%
                </button>
              ))}
            </div>
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">
              Shield charges 1% today. A higher ceiling only matters if that ever changes; an exit never takes more than you set.
            </p>
          </fieldset>
        </details>

        {nearOne && (
          <label className="flex items-start gap-3 rounded-lg border border-caution/40 bg-caution-soft p-3 text-[0.8125rem]">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--caution)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              I understand a trigger this close to 1.00 leaves little room: a sharp price drop can cross it and Aave&rsquo;s liquidation line in the
              same block, before an exit can run.
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
            { title: "Prepay", detail: "Funds the premium, charged block by block" },
            { title: "Opt in", detail: `Arms the trigger at ${trigger.toFixed(2)}, max discount ${maxDiscount / 100}%` },
          ]}
        />
        {disabled ? (
          <SwitchButton action="opt in" className="mt-5 w-full" />
        ) : (
          <Button
            size="lg"
            className="mt-5 h-12 w-full text-[0.9375rem]"
            onClick={() => void action()}
            disabled={busy || step === 5 || ((step === 2 || step === 3) && (prepayUnits === 0n || tooLittle)) || (step === 4 && nearOne && !ack)}
          >
            {busy ? "Check your wallet" : step === 4 && nearOne && !ack ? "Confirm the note above to opt in" : buttonText}
          </Button>
        )}
        <TxStatus state={tx.state} label={lastLabel} className="mt-3" />
        <p className="mt-4 flex items-start gap-2 text-[0.75rem] text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Shield can move your a{collateral.symbol} only inside an exit at your trigger, and the exit reverts unless your health factor ends higher than it
          started.
        </p>
      </div>
    </section>
  );
}

export function CoverManage({ user, cover, collateral, disabled, onDone }: { user: Address; cover: Cover; collateral: ReserveLine; disabled: boolean; onDone: () => void }) {
  const tx = useTx();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [trigger, setTrigger] = useState(cover.trigger);
  const units = useMemo(() => {
    const v = Number(amount);
    return Number.isFinite(v) && v > 0 ? parseUnits(v.toFixed(6), 6) : 0n;
  }, [amount]);
  const busy = tx.state.phase === "signing" || tx.state.phase === "pending";
  const run = async (l: string, args: Parameters<typeof tx.send>[0]) => {
    setLabel(l);
    if (await tx.send(args)) {
      setAmount("");
      onDone();
    }
  };

  const status = (() => {
    if (cover.exitStatus === "Ready") return { tone: "caution", icon: Clock3, title: "Exit due", body: "Your health factor reached the trigger. The keeper exits in the next block; anyone else may too." };
    if (cover.exitStatus === "AllowanceTooLow")
      return { tone: "danger", icon: ShieldAlert, title: "Unprotected", body: `Shield can no longer move your a${collateral.symbol} at an exit. Approve it again to re-arm the trigger.` };
    if (cover.lapsed) return { tone: "caution", icon: ShieldAlert, title: "Unprotected", body: "Your prepaid balance ran out, so the trigger is not armed. Top up to re-arm it." };
    if (disabled) return { tone: "caution", icon: ShieldAlert, title: "Wrong network", body: "Your wallet is on another network. Switch to Monad to manage this cover." };
    if (cover.exitStatus === "PythStale") return { tone: "caution", icon: Clock3, title: "Waiting for a price", body: "The exit needs a Pyth price from the last hour. Pyth pushes one whenever ETH moves." };
    return { tone: "safe", icon: ShieldCheck, title: "Protected", body: `Shield exits if your health factor reaches ${cover.trigger.toFixed(2)}.` };
  })();

  const amountInput = (id: string, placeholder: string) => (
    <div className="relative">
      <TokenIcon symbol="USDC" size={22} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
      <Input id={id} inputMode="decimal" className="h-12 pl-11 text-base num" placeholder={placeholder} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
    </div>
  );

  return (
    <section aria-labelledby="manage-heading" className="panel overflow-hidden">
      <div
        role="status"
        className={cn(
          "border-b px-5 py-5 sm:px-6",
          status.tone === "caution" && "bg-caution-soft",
          status.tone === "danger" && "bg-danger-soft",
        )}
      >
        <div className="flex items-center gap-2.5">
          <status.icon className={cn("size-5", status.tone === "safe" && "text-safe", status.tone === "caution" && "text-caution", status.tone === "danger" && "text-danger")} aria-hidden />
          <h2 id="manage-heading" className={cn("text-lg font-semibold", status.tone === "caution" && "text-caution", status.tone === "danger" && "text-danger")}>
            {status.title}
          </h2>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{status.body}</p>
        {cover.exitStatus === "AllowanceTooLow" && (
          <Button className="mt-3" size="sm" disabled={disabled || busy} onClick={() => void run("Approval", { address: collateral.aToken, abi: erc20Abi, functionName: "approve", args: [shield.executor!, maxUint256], chainId })}>
            Approve {collateral.symbol} again
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-4 border-b px-5 py-4 text-sm sm:px-6">
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Trigger</dt>
          <dd className="reading mt-0.5 text-lg font-semibold text-caution">{cover.trigger.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Max discount</dt>
          <dd className="reading mt-0.5 text-lg font-semibold">{cover.maxDiscountBps / 100}%</dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Collateral</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold">
            <TokenIcon symbol={collateral.symbol} size={18} />
            {collateral.symbol}
          </dd>
        </div>
      </dl>

      <div className="px-5 py-5 sm:px-6">
        <Tabs defaultValue="topup">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="topup">Top up</TabsTrigger>
            <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
            <TabsTrigger value="trigger">Trigger</TabsTrigger>
            <TabsTrigger value="optout">Opt out</TabsTrigger>
          </TabsList>
          <TabsContent value="topup" className="mt-4 space-y-3">
            <SectionLabel htmlFor="topup" aside={<span className="text-[0.8125rem] text-muted-foreground num">Balance {formatUsd(cover.usdcBalance)}</span>}>
              Add to the prepaid balance
            </SectionLabel>
            {amountInput("topup", "10.00")}
            {cover.usdcAllowance < units ? (
              <Button className="h-11 w-full" disabled={disabled || busy || units === 0n} onClick={() => void run("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.repricer!, units], chainId })}>
                Approve USDC
              </Button>
            ) : (
              <Button className="h-11 w-full" disabled={disabled || busy || units === 0n || Number(amount) > cover.usdcBalance} onClick={() => void run("Top-up", { address: shield.repricer!, abi: repricerAbi, functionName: "topUp", args: [units], chainId })}>
                Top up {amount ? formatUsd(Number(amount)) : ""}
              </Button>
            )}
          </TabsContent>
          <TabsContent value="withdraw" className="mt-4 space-y-3">
            <SectionLabel htmlFor="withdraw" aside={<span className="text-[0.8125rem] text-muted-foreground num">Prepaid {formatUsd(cover.prepaidUsd)}</span>}>
              Withdraw unused USDC
            </SectionLabel>
            {amountInput("withdraw", cover.prepaidUsd.toFixed(2))}
            <p className="text-[0.8125rem] text-muted-foreground">Withdrawing everything leaves the trigger unarmed until you top up.</p>
            <Button className="h-11 w-full" variant="outline" disabled={disabled || busy || units === 0n || Number(amount) > cover.prepaidUsd} onClick={() => void run("Withdrawal", { address: shield.repricer!, abi: repricerAbi, functionName: "withdrawUnused", args: [units], chainId })}>
              Withdraw {amount ? formatUsd(Number(amount)) : ""}
            </Button>
          </TabsContent>
          <TabsContent value="trigger" className="mt-4 space-y-3">
            <SectionLabel htmlFor="new-trigger" aside={<span className="reading text-lg font-semibold text-caution">{trigger.toFixed(2)}</span>}>
              New trigger
            </SectionLabel>
            <Slider id="new-trigger" className="pt-2" min={1.01} max={1.5} step={0.01} value={[trigger]} onValueChange={(v) => setTrigger(Number(v[0]!.toFixed(2)))} aria-label="New trigger health factor" />
            <Button className="h-11 w-full" variant="outline" disabled={disabled || busy || trigger === cover.trigger} onClick={() => void run("Trigger change", { address: shield.registry!, abi: positionRegistryAbi, functionName: "setTrigger", args: [Math.round(trigger * 1e4)], chainId })}>
              Set trigger to {trigger.toFixed(2)}
            </Button>
          </TabsContent>
          <TabsContent value="optout" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">Ends the cover. Your unused prepaid balance stays withdrawable here.</p>
            <Button className="h-11 w-full" variant="destructive" disabled={disabled || busy} onClick={() => void run("Opt-out", { address: shield.registry!, abi: positionRegistryAbi, functionName: "optOut", chainId })}>
              Opt out
            </Button>
          </TabsContent>
        </Tabs>
        <TxStatus state={tx.state} label={label} className="mt-3" />
      </div>
      <span className="sr-only">{user}</span>
    </section>
  );
}

/** After an exit: what happened, in one card, above the form to protect again. */
export function ExitSummary({ savedUsd, repaidUsd, hfBefore, hfAfter, collateralTaken, symbol }: { savedUsd: number; repaidUsd: number; hfBefore: number; hfAfter: number; collateralTaken?: number; symbol: string }) {
  return (
    <section className="panel overflow-hidden" aria-label="Last exit">
      <div className="bg-safe-soft px-5 py-5 sm:px-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-safe">
          <ShieldCheck className="size-5" aria-hidden />
          Exit completed
        </p>
        <p className="mt-2 text-[1.75rem] font-semibold leading-tight reading">{formatUsd(savedUsd)}</p>
        <p className="text-sm text-muted-foreground">liquidation penalty avoided</p>
      </div>
      <dl className="grid grid-cols-2 gap-4 px-5 py-4 text-sm sm:px-6">
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Debt repaid</dt>
          <dd className="font-semibold num">{formatUsd(repaidUsd)}</dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Health factor</dt>
          <dd className="font-semibold num">
            {hfBefore.toFixed(3)} to {hfAfter.toFixed(3)}
          </dd>
        </div>
        {collateralTaken !== undefined && (
          <div className="col-span-2">
            <dt className="text-[0.8125rem] text-muted-foreground">Collateral the vault took</dt>
            <dd className="font-semibold num">{formatToken(collateralTaken, symbol)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
