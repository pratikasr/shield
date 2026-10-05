"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { maxUint256, parseUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { Info } from "@/components/data/info";
import { SwitchButton } from "@/components/shell/network-guard";
import { TxStatus } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import { useOnBlock } from "@/hooks/useLiveBlock";
import type { Cover } from "@/hooks/useShieldPosition";
import { useTx } from "@/hooks/useTx";
import { erc20Abi, positionRegistryAbi, repricerAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { BLOCKS_PER_DAY, EXIT_BUFFER, aavePenaltyUsd, formatRunway, runwayDays, shieldExitUsd } from "@/lib/economics";
import { aave, shield } from "@/lib/env";
import { formatHf, formatToken, formatUsd, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const chainId = monadMainnet.id;
const DISCOUNTS = [100, 200, 300, 500];

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
  return d
    ? { perBlockUsd: toNumber(d[0], 18), sigma: toNumber(d[2], 18), annualUsd: toNumber(d[3], 18) }
    : undefined;
}

function Step({ n, title, detail, state }: { n: number; title: string; detail: string; state: "done" | "current" | "todo" }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-x-3" aria-current={state === "current" ? "step" : undefined}>
      <span
        className={cn(
          "mt-0.5 inline-flex size-6 items-center justify-center rounded-full border text-[0.75rem] num",
          state === "done" && "border-safe bg-safe text-background",
          state === "current" && "border-foreground text-foreground",
          state === "todo" && "text-muted-foreground",
        )}
      >
        {state === "done" ? <Check className="size-3.5" aria-label="Done" /> : n}
      </span>
      <div>
        <p className={cn("text-sm font-medium", state === "todo" && "text-muted-foreground")}>{title}</p>
        <p className="text-[0.8125rem] text-muted-foreground">{detail}</p>
      </div>
    </li>
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
    <div className="rounded-xl border bg-card p-5 sm:p-6">
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

  const suggested = quote ? Math.max(1, Math.ceil(quote.perBlockUsd * BLOCKS_PER_DAY * 30)) : 1;
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
  const usdcDebt = position.reserves.find((r) => r.symbol === "USDC")?.borrowedUsd ?? 0;
  // The collateral price at which HF reaches the trigger, holding debt and other collateral where they are.
  const triggerPrice =
    Number.isFinite(position.healthFactor) && collateral.supplied > 0
      ? collateral.priceUsd - ((position.healthFactor - trigger) * position.debtUsd) / (collateral.supplied * collateral.liquidationThreshold)
      : Number.NaN;
  const atExit = shieldExitUsd({ debtUsd: usdcDebt, trigger, liquidationThreshold: collateral.liquidationThreshold, discountBps: 100 });
  const penalty = aavePenaltyUsd(position.debtUsd, position.collateralUsd, collateral.liquidationBonus);

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

  return (
    <section aria-labelledby="setup-heading" className="rounded-xl border bg-card p-5 sm:p-6">
      <h2 id="setup-heading" className="text-lg font-semibold">
        Protect this position
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose where Shield steps in. Below 1.00 Aave&rsquo;s liquidators take {((collateral.liquidationBonus - 1) * 100).toFixed(1)}%; at your trigger
        Shield takes 1%.
      </p>

      <div className="mt-6">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="trigger">Trigger</Label>
          <span className="reading text-xl font-semibold text-caution">{trigger.toFixed(2)}</span>
        </div>
        <Slider
          id="trigger"
          className="mt-3"
          min={1.01}
          max={1.5}
          step={0.01}
          value={[trigger]}
          onValueChange={(v) => setTrigger(Number(v[0]!.toFixed(2)))}
          aria-label="Trigger health factor"
          disabled={optedIn || disabled}
        />
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          Your health factor is {formatHf(position.healthFactor)}.{" "}
          {Number.isFinite(triggerPrice) && triggerPrice > 0 && !dueNow && (
            <>
              At today&rsquo;s debt that is {collateral.symbol} at <span className="text-foreground num">{formatUsd(triggerPrice)}</span>, now{" "}
              <span className="num">{formatUsd(collateral.priceUsd)}</span>.{" "}
            </>
          )}
          An exit restores it to {(trigger + EXIT_BUFFER).toFixed(2)}.
        </p>
        {dueNow && !optedIn && (
          <p className="mt-2 text-[0.8125rem] text-caution" role="note">
            Your health factor is already at or below this trigger, so the exit would run at the next block after you opt in.
          </p>
        )}
      </div>

      <fieldset className="mt-6" disabled={optedIn || disabled}>
        <legend className="text-sm font-medium">Most discount you accept</legend>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {DISCOUNTS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setMaxDiscount(d)}
              aria-pressed={maxDiscount === d}
              className={cn(
                "h-10 rounded-md border text-sm num disabled:opacity-50",
                maxDiscount === d ? "border-foreground bg-muted font-semibold" : "text-muted-foreground hover:text-foreground",
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

      <div className="mt-6">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="prepay">Prepay, USDC</Label>
          <span className="text-[0.8125rem] text-muted-foreground num">Wallet {formatUsd(usdcBalance)}</span>
        </div>
        <Input
          id="prepay"
          inputMode="decimal"
          className="mt-2 h-11 text-base num"
          placeholder={String(suggested)}
          value={prepay}
          onChange={(e) => setPrepay(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-describedby="prepay-help"
          disabled={funded || disabled}
        />
        <p id="prepay-help" className={cn("mt-2 text-[0.8125rem]", tooLittle ? "text-danger" : "text-muted-foreground")}>
          {tooLittle
            ? `This wallet holds ${formatUsd(usdcBalance)} of USDC. Lower the amount or add USDC.`
            : quote
              ? `At ${formatUsd(quote.perBlockUsd)} a block (${formatUsd(quote.annualUsd)} a year) this lasts ${formatRunway(
                  runwayDays(prepayValue, quote.perBlockUsd),
                )}. Unused balance can be withdrawn any time.`
              : "Fetching the premium for this trigger."}
        </p>
      </div>

      <div className="mt-6 rounded-lg border bg-raised p-4">
        <p className="flex items-center text-sm font-medium">
          At the trigger
          <Info>
            Estimates at today&rsquo;s debt. The exit repays enough USDC to bring the health factor from the trigger to trigger + 0.06,
            and the vault takes 1.01 times that in {collateral.symbol} at Aave&rsquo;s price. Aave&rsquo;s figure assumes a liquidation just
            below 1.00: half the debt (all of it under $2,000) repaid at a {((collateral.liquidationBonus - 1) * 100).toFixed(1)}% bonus.
          </Info>
        </p>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[0.8125rem] num">
          <dt className="text-muted-foreground">Debt repaid, est.</dt>
          <dd className="text-right">{formatUsd(atExit.repayUsd)}</dd>
          <dt className="text-muted-foreground">Vault takes, est.</dt>
          <dd className="text-right">
            {formatToken((atExit.repayUsd * 1.01) / Math.max(triggerPrice > 0 ? triggerPrice : collateral.priceUsd, 1e-9), collateral.symbol)}
          </dd>
          <dt className="text-muted-foreground">Your cost at the exit</dt>
          <dd className="text-right text-safe">{formatUsd(atExit.costUsd)}</dd>
          <dt className="text-muted-foreground">Aave penalty if liquidated</dt>
          <dd className="text-right text-danger">{formatUsd(penalty)}</dd>
        </dl>
      </div>

      {nearOne && (
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-caution/40 bg-caution-soft p-3 text-[0.8125rem]">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--caution)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>
            I understand a trigger this close to 1.00 leaves little room: a sharp price drop can cross it and Aave&rsquo;s liquidation line
            in the same block, before an exit can run.
          </span>
        </label>
      )}

      <ol className="mt-6 grid gap-3" aria-label="Steps">
        <Step n={1} title={`Approve ${collateral.symbol}`} detail={`Lets Shield move a${collateral.symbol} only inside an exit`} state={step > 1 ? "done" : step === 1 ? "current" : "todo"} />
        <Step n={2} title="Approve USDC" detail="For the prepaid premium" state={step > 2 ? "done" : step === 2 ? "current" : "todo"} />
        <Step n={3} title="Prepay" detail="Funds the premium, charged block by block" state={funded ? "done" : step === 3 ? "current" : "todo"} />
        <Step n={4} title="Opt in" detail={`Arms the trigger at ${trigger.toFixed(2)}, max discount ${maxDiscount / 100}%`} state={optedIn ? "done" : step === 4 ? "current" : "todo"} />
      </ol>

      {disabled ? (
        <SwitchButton action="opt in" className="mt-6 w-full" />
      ) : (
        <Button
          size="lg"
          className="mt-6 w-full"
          onClick={() => void action()}
          disabled={busy || step === 5 || ((step === 2 || step === 3) && (prepayUnits === 0n || tooLittle)) || (step === 4 && nearOne && !ack)}
        >
          {busy ? "Check your wallet" : step === 4 && nearOne && !ack ? "Confirm the note above to opt in" : buttonText}
        </Button>
      )}
      <TxStatus state={tx.state} label={lastLabel} className="mt-3" />
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
    if (cover.exitStatus === "Ready") return { tone: "caution", title: "Exit due", body: "Your health factor reached the trigger. The keeper exits in the next block; anyone else may too." };
    if (cover.exitStatus === "AllowanceTooLow")
      return { tone: "danger", title: "Unprotected", body: `Shield can no longer move your a${collateral.symbol} at an exit. Approve it again to re-arm the trigger.` };
    if (cover.lapsed) return { tone: "caution", title: "Unprotected", body: "Your prepaid balance ran out, so the trigger is not armed. Top up to re-arm it." };
    if (disabled) return { tone: "caution", title: "Wrong network", body: "Your wallet is on another network. Switch to Monad to manage this cover." };
    if (cover.exitStatus === "PythStale") return { tone: "caution", title: "Waiting for a price", body: "The exit needs a Pyth price from the last hour. Pyth pushes one whenever ETH moves." };
    return { tone: "safe", title: "Protected", body: `Shield exits if your health factor reaches ${cover.trigger.toFixed(2)}.` };
  })();

  return (
    <section aria-labelledby="manage-heading" className="rounded-xl border bg-card p-5 sm:p-6">
      <div role="status" className={cn("rounded-lg border p-4", status.tone === "safe" && "border-safe/40 bg-safe-soft", status.tone === "caution" && "border-caution/40 bg-caution-soft", status.tone === "danger" && "border-danger/40 bg-danger-soft")}>
        <h2 id="manage-heading" className={cn("text-lg font-semibold", status.tone === "safe" && "text-safe", status.tone === "caution" && "text-caution", status.tone === "danger" && "text-danger")}>
          {status.title}
        </h2>
        <p className="mt-1 text-sm">{status.body}</p>
        {cover.exitStatus === "AllowanceTooLow" && (
          <Button className="mt-3" size="sm" disabled={disabled || busy} onClick={() => void run("Approval", { address: collateral.aToken, abi: erc20Abi, functionName: "approve", args: [shield.executor!, maxUint256], chainId })}>
            Approve {collateral.symbol} again
          </Button>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Trigger</dt>
          <dd className="reading text-lg font-semibold text-caution">{cover.trigger.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Max discount</dt>
          <dd className="reading text-lg font-semibold">{cover.maxDiscountBps / 100}%</dd>
        </div>
      </dl>

      <Tabs defaultValue={cover.lapsed ? "topup" : "topup"} className="mt-5">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="topup">Top up</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
          <TabsTrigger value="trigger">Trigger</TabsTrigger>
          <TabsTrigger value="optout">Opt out</TabsTrigger>
        </TabsList>
        <TabsContent value="topup" className="mt-4 space-y-3">
          <Label htmlFor="topup">Add USDC to the prepaid balance</Label>
          <Input id="topup" inputMode="decimal" className="h-11 num" placeholder="10" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          <p className="text-[0.8125rem] text-muted-foreground num">Wallet {formatUsd(cover.usdcBalance)}</p>
          {cover.usdcAllowance < units ? (
            <Button className="w-full" disabled={disabled || busy || units === 0n} onClick={() => void run("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.repricer!, units], chainId })}>
              Approve USDC
            </Button>
          ) : (
            <Button className="w-full" disabled={disabled || busy || units === 0n || Number(amount) > cover.usdcBalance} onClick={() => void run("Top-up", { address: shield.repricer!, abi: repricerAbi, functionName: "topUp", args: [units], chainId })}>
              Top up {amount ? formatUsd(Number(amount)) : ""}
            </Button>
          )}
        </TabsContent>
        <TabsContent value="withdraw" className="mt-4 space-y-3">
          <Label htmlFor="withdraw">Withdraw unused USDC</Label>
          <Input id="withdraw" inputMode="decimal" className="h-11 num" placeholder={cover.prepaidUsd.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          <p className="text-[0.8125rem] text-muted-foreground">Withdrawing everything leaves the trigger unarmed until you top up.</p>
          <Button className="w-full" variant="outline" disabled={disabled || busy || units === 0n || Number(amount) > cover.prepaidUsd} onClick={() => void run("Withdrawal", { address: shield.repricer!, abi: repricerAbi, functionName: "withdrawUnused", args: [units], chainId })}>
            Withdraw {amount ? formatUsd(Number(amount)) : ""}
          </Button>
        </TabsContent>
        <TabsContent value="trigger" className="mt-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="new-trigger">New trigger</Label>
            <span className="reading text-lg font-semibold text-caution">{trigger.toFixed(2)}</span>
          </div>
          <Slider id="new-trigger" min={1.01} max={1.5} step={0.01} value={[trigger]} onValueChange={(v) => setTrigger(Number(v[0]!.toFixed(2)))} aria-label="New trigger health factor" />
          <Button className="w-full" variant="outline" disabled={disabled || busy || trigger === cover.trigger} onClick={() => void run("Trigger change", { address: shield.registry!, abi: positionRegistryAbi, functionName: "setTrigger", args: [Math.round(trigger * 1e4)], chainId })}>
            Set trigger to {trigger.toFixed(2)}
          </Button>
        </TabsContent>
        <TabsContent value="optout" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">Ends the cover. Your unused prepaid balance stays withdrawable here.</p>
          <Button className="w-full" variant="destructive" disabled={disabled || busy} onClick={() => void run("Opt-out", { address: shield.registry!, abi: positionRegistryAbi, functionName: "optOut", chainId })}>
            Opt out
          </Button>
        </TabsContent>
      </Tabs>
      <TxStatus state={tx.state} label={label} className="mt-3" />
      <span className="sr-only">{user}</span>
    </section>
  );
}
