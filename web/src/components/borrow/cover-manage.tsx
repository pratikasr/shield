"use client";

import { Clock3, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { maxUint256, type Address } from "viem";
import { FundingSource } from "@/components/aurora/funding-source";
import { AmountHint, AmountInput } from "@/components/data/amount-input";
import { Chip } from "@/components/data/chip";
import { TokenIcon } from "@/components/data/token";
import { SwitchButton } from "@/components/shell/network-guard";
import { TxStatus, latestTx } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { priceAtHf } from "@/components/borrow/position-panel";
import { AAVE_APP, ProtectionCheck, RunExitButton, SectionLabel, useQuote, useSentLock } from "@/components/borrow/cover-shared";
import { TRIGGER_MAX, TRIGGER_MIN, TRIGGER_PRESETS } from "@/components/borrow/cover-setup";
import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import { useLiveBlock } from "@/hooks/useLiveBlock";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import type { Cover } from "@/hooks/useShieldPosition";
import { useTx, type TxHandle } from "@/hooks/useTx";
import { erc20Abi, positionRegistryAbi, repricerAbi } from "@/lib/abis";
import { amountText, checkAmount, unitsUsd } from "@/lib/amount";
import { livePrepaid, type ArmState } from "@/lib/cover-status";
import { aave, shield } from "@/lib/env";
import { formatClock, formatDuration, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const DISCOUNTS = [100, 200, 300, 500];
/** Blocks of premium kept back from Max withdraw: the accrual between this read and the transaction's block. */
const WITHDRAW_MARGIN_BLOCKS = 30n;

const TONE_BG = { caution: "bg-caution-soft", danger: "bg-danger-soft", safe: "", neutral: "" } as const;
const TONE_TEXT = { caution: "text-caution", danger: "text-danger", safe: "text-safe", neutral: "text-foreground" } as const;

/**
 * The active cover. Always rendered while the cover is active, whatever happened to the position, so the borrower can
 * always top up, withdraw, move the trigger or opt out; when exits cannot run, the header says why and names the fix.
 */
export function CoverManage({
  user,
  position,
  cover,
  collateral,
  config,
  arm,
  disabled,
  refetch,
  lifecycle,
  keeperIdle,
}: {
  user: Address;
  position: AavePosition;
  cover: Cover;
  collateral: ReserveLine;
  config: ShieldConfig;
  arm: ArmState;
  disabled: boolean;
  refetch: () => Promise<unknown>;
  lifecycle: TxHandle;
  /** The exit has been due for a while and the keeper has not run it. */
  keeperIdle: boolean;
}) {
  const [tab, setTab] = useState("topup");
  const { data: block } = useLiveBlock();
  const live = livePrepaid(cover, block);
  const symbol = collateral.symbol;
  const lock = useSentLock();
  const after = async (receipt: unknown, key?: string) => {
    if (!receipt) return false;
    if (key) lock.hold(key);
    await refetch();
    return true;
  };

  // Header fix: approve again, or jump to the tab that fixes it.
  const approveTx = useTx();
  const goTo = (value: string, focusId?: string) => {
    setTab(value);
    if (focusId) setTimeout(() => document.getElementById(focusId)?.focus(), 50);
  };

  // Top up.
  const [topup, setTopup] = useState("");
  const topupTx = useTx();
  const topupCheck = checkAmount(topup, { balance: cover.usdcBalanceRaw });
  const needsApproval = topupCheck.units > 0n && cover.usdcAllowance < topupCheck.units;
  const approveKey = `approve:${topupCheck.units}`;

  // Withdraw: the live balance less the premium owed since the last reprice, plus a margin for blocks to inclusion.
  const [withdraw, setWithdraw] = useState("");
  const withdrawTx = useTx();
  const owedWad = BigInt(Math.ceil(live.rate * 1e18)) * (BigInt(live.blocksSince) + WITHDRAW_MARGIN_BLOCKS);
  const availableWad = cover.lapsed ? cover.prepaidWad : cover.prepaidWad > owedWad ? cover.prepaidWad - owedWad : 0n;
  const availableUnits = availableWad / 10n ** 12n;
  const withdrawCheck = checkAmount(withdraw, {
    available: availableUnits,
    availableMessage: (a) => `About ${unitsUsd(a)} can be withdrawn now: the prepaid balance less the premium owed since the last reprice. Lower the amount or use Max.`,
  });

  // Trigger and max discount.
  const [newTrigger, setNewTrigger] = useState(cover.trigger);
  const [ackNew, setAckNew] = useState(false);
  const triggerTx = useTx();
  const q = useQuote(user, collateral.asset, newTrigger, tab === "trigger");
  const raising = newTrigger > cover.trigger;
  const dueNow = position.healthFactor <= newTrigger;
  const nearOne = newTrigger <= 1.02;
  const newPrice = priceAtHf(position, collateral, newTrigger);
  const [discount, setDiscount] = useState(cover.maxDiscountBps);
  const discountTx = useTx();

  // Opt out, with a confirmation.
  const [confirming, setConfirming] = useState(false);

  const busy = approveTx.busy || topupTx.busy || withdrawTx.busy || triggerTx.busy || discountTx.busy || lifecycle.busy;
  const Icon = arm.kind === "armed" ? ShieldCheck : arm.kind === "warming" || arm.kind === "due" || arm.kind === "loading" ? Clock3 : ShieldAlert;
  const wait = formatDuration(config.minCoverSeconds);

  const fixButton = (() => {
    if (disabled) return <SwitchButton action="manage this cover" size="default" className="mt-3" />;
    switch (arm.fix) {
      case "approve":
        return (
          <Button
            className="mt-3"
            size="sm"
            disabled={busy || lock.isHeld("reapprove")}
            onClick={async () =>
              after(await approveTx.send("Approval", { address: collateral.aToken, abi: erc20Abi, functionName: "approve", args: [shield.executor!, maxUint256] }), "reapprove")
            }
          >
            Approve {symbol} again
          </Button>
        );
      case "topup":
        return (
          <Button className="mt-3" size="sm" onClick={() => goTo("topup", "topup")}>
            Top up
          </Button>
        );
      case "raiseDiscount":
        return (
          <Button className="mt-3" size="sm" onClick={() => goTo("trigger")}>
            Raise max discount
          </Button>
        );
      case "leaveEmode":
      case "fixCollateral":
      case "borrowUsdc":
      case "supply":
        return (
          <Button asChild className="mt-3" size="sm" variant="outline">
            <a href={AAVE_APP} target="_blank" rel="noreferrer">
              {arm.fix === "leaveEmode" ? "Leave eMode on Aave" : arm.fix === "fixCollateral" ? "Fix collateral on Aave" : "Open Aave on Monad"}
            </a>
          </Button>
        );
      default:
        return null;
    }
  })();

  return (
    <section aria-labelledby="manage-heading" className="panel overflow-hidden">
      <div className={cn("border-b px-5 py-5 sm:px-6", TONE_BG[arm.tone])}>
        <div className="flex items-center gap-2.5">
          <Icon className={cn("size-5 shrink-0", TONE_TEXT[arm.tone])} aria-hidden />
          <h2 id="manage-heading" className={cn("text-lg font-semibold num", arm.tone !== "safe" && TONE_TEXT[arm.tone])}>
            {arm.title}
          </h2>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{arm.body}</p>
        {/* Announced once per state change, not every second of the countdown. */}
        <p className="sr-only" aria-live="polite">
          {arm.kind === "warming" ? "Cover is arming." : arm.title}
        </p>
        {fixButton}
        {arm.kind === "due" && keeperIdle && !disabled && <RunExitButton borrower={user} className="mt-3" onDone={() => void refetch()} />}
        <TxStatus state={approveTx.state} className="mt-3" />
        {lifecycle.state.label === "Opt-in" && <TxStatus state={lifecycle.state} className="mt-3" />}
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
            <TokenIcon symbol={symbol} size={18} />
            {symbol}
          </dd>
        </div>
      </dl>

      <div className="border-b px-5 py-4 sm:px-6">
        <ProtectionCheck checks={arm.checks} />
      </div>

      <div className="px-5 py-5 sm:px-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="topup">Top up</TabsTrigger>
            <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
            <TabsTrigger value="trigger">Trigger</TabsTrigger>
            <TabsTrigger value="optout">Opt out</TabsTrigger>
          </TabsList>

          <TabsContent value="topup" className="mt-4">
            <FundingSource kind="premium" owner={user} refundTo={user} wrongNetwork={disabled} onSwept={() => void refetch()}>
              <SectionLabel htmlFor="topup" aside={<span className="text-[0.8125rem] text-muted-foreground num">Balance {formatUsd(cover.usdcBalance)}</span>}>
                Add to the prepaid balance
              </SectionLabel>
              <AmountInput
                id="topup"
                value={topup}
                onChange={setTopup}
                onMax={() => setTopup(amountText(cover.usdcBalanceRaw))}
                maxDisabled={cover.usdcBalanceRaw === 0n}
                check={topupCheck}
                hintId="topup-help"
                placeholder="10.00"
              />
              <AmountHint id="topup-help" check={topupCheck}>
                {cover.lapsed ? "Topping up re-arms the cover after the waiting period." : "Adds to the balance the premium is charged from, block by block."}
              </AmountHint>
              {needsApproval ? (
                <Button
                  className="h-11 w-full"
                  disabled={disabled || busy || !topupCheck.ok || lock.isHeld(approveKey)}
                  onClick={async () =>
                    // The typed amount stays after the approval, so the top-up is one more click.
                    after(await topupTx.send("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.repricer!, topupCheck.units] }), approveKey)
                  }
                >
                  Approve USDC
                </Button>
              ) : (
                <Button
                  className="h-11 w-full"
                  disabled={disabled || busy || !topupCheck.ok}
                  onClick={async () => {
                    if (await after(await topupTx.send("Top-up", { address: shield.repricer!, abi: repricerAbi, functionName: "topUp", args: [topupCheck.units] }))) setTopup("");
                  }}
                >
                  {topup.trim() === "" ? "Enter an amount" : `Top up ${topupCheck.units > 0n ? unitsUsd(topupCheck.units) : ""}`}
                </Button>
              )}
              <TxStatus state={topupTx.state} />
            </FundingSource>
          </TabsContent>

          <TabsContent value="withdraw" className="mt-4 space-y-3">
            <SectionLabel htmlFor="withdraw" aside={<span className="text-[0.8125rem] text-muted-foreground num">Prepaid {formatUsd(live.prepaidUsd)}</span>}>
              Withdraw unused USDC
            </SectionLabel>
            <AmountInput
              id="withdraw"
              value={withdraw}
              onChange={setWithdraw}
              onMax={() => setWithdraw(amountText(availableUnits))}
              maxDisabled={availableUnits === 0n}
              check={withdrawCheck}
              hintId="withdraw-help"
              placeholder={Number(amountText(availableUnits)).toFixed(2)}
            />
            <AmountHint id="withdraw-help" check={withdrawCheck}>
              About {unitsUsd(availableUnits)} can be withdrawn now; the premium owed since the last reprice is charged first. Withdrawing everything leaves
              the trigger unarmed until you top up. To take it all, opt out first, then withdraw the rest.
            </AmountHint>
            <Button
              className="h-11 w-full"
              variant="outline"
              disabled={disabled || busy || !withdrawCheck.ok}
              onClick={async () => {
                if (await after(await withdrawTx.send("Withdrawal", { address: shield.repricer!, abi: repricerAbi, functionName: "withdrawUnused", args: [withdrawCheck.units] }))) setWithdraw("");
              }}
            >
              {withdraw.trim() === "" ? "Enter an amount" : `Withdraw ${withdrawCheck.units > 0n ? unitsUsd(withdrawCheck.units) : ""}`}
            </Button>
            <TxStatus state={withdrawTx.state} />
          </TabsContent>

          <TabsContent value="trigger" className="mt-4 space-y-4">
            <div className="space-y-3">
              <SectionLabel htmlFor="new-trigger" aside={<span className="reading text-lg font-semibold text-caution">{newTrigger.toFixed(2)}</span>}>
                New trigger
              </SectionLabel>
              <Slider
                id="new-trigger"
                className="pt-2"
                min={TRIGGER_MIN}
                max={TRIGGER_MAX}
                step={0.01}
                value={[newTrigger]}
                onValueChange={(v) => setNewTrigger(Math.round(v[0]! * 100) / 100)}
                aria-label="New trigger health factor"
                valueText={`Health factor ${newTrigger.toFixed(2)}`}
              />
              <div className="flex flex-wrap gap-2" role="group" aria-label="Common triggers">
                {TRIGGER_PRESETS.map((t) => (
                  <Chip key={t} active={newTrigger === t} onClick={() => setNewTrigger(t)}>
                    {t.toFixed(2)}
                  </Chip>
                ))}
              </div>
              <p className="text-[0.8125rem] text-muted-foreground">
                {dueNow ? (
                  <span className="text-caution" role="note">
                    Your health factor is already at or below this trigger, so cover is priced at its highest rate
                    {raising ? ` and the exit runs as soon as the cover arms again, ${wait} after the change` : ""}.
                  </span>
                ) : Number.isFinite(newPrice) && newPrice > 0 ? (
                  <>
                    Exits if {symbol} falls to <span className="font-medium text-foreground num">{formatUsd(newPrice)}</span>. The exit restores{" "}
                    {(newTrigger + config.exitHfBuffer).toFixed(2)}.
                  </>
                ) : (
                  <>The exit restores {(newTrigger + config.exitHfBuffer).toFixed(2)}.</>
                )}
              </p>
              <p className="text-[0.8125rem] text-muted-foreground num">
                Cover at {newTrigger.toFixed(2)}: {q ? `${formatUsd(q.annualUsd)} a year` : "fetching the rate"}, against {formatUsd(cover.annualPremiumUsd)} a year now.
              </p>
              {raising && (
                <p className="rounded-lg border border-caution/40 bg-caution-soft p-3 text-[0.8125rem]" role="note">
                  Raising the trigger restarts the {wait} waiting period: no exit can run until about {formatClock(Date.now() / 1000 + config.minCoverSeconds)},
                  even at the trigger.
                </p>
              )}
              {nearOne && (
                <label className="flex items-start gap-3 rounded-lg border border-caution/40 bg-caution-soft p-3 text-[0.8125rem]">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--caution)]" checked={ackNew} onChange={(e) => setAckNew(e.target.checked)} />
                  <span>
                    I understand a trigger this close to 1.00 leaves little room: a sharp price drop can cross it and Aave&rsquo;s liquidation line in the same
                    block, before an exit can run.
                  </span>
                </label>
              )}
              <Button
                className="h-11 w-full"
                variant="outline"
                disabled={disabled || busy || newTrigger === cover.trigger || (nearOne && !ackNew)}
                onClick={async () =>
                  after(await triggerTx.send("Trigger change", { address: shield.registry!, abi: positionRegistryAbi, functionName: "setTrigger", args: [Math.round(newTrigger * 1e4)] }))
                }
              >
                Set trigger to {newTrigger.toFixed(2)}
              </Button>
            </div>

            <div className="space-y-3 border-t pt-4">
              <p className="text-sm font-medium">Most discount you accept</p>
              <div className="grid grid-cols-4 gap-2" role="group" aria-label="Most discount you accept">
                {DISCOUNTS.filter((d) => d >= config.exitDiscountBps).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDiscount(d)}
                    aria-pressed={discount === d}
                    className={cn(
                      "hit relative h-9 rounded-md border text-sm num",
                      discount === d ? "border-foreground bg-foreground font-semibold text-background" : "bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d / 100}%
                  </button>
                ))}
              </div>
              <p className="text-[0.8125rem] text-muted-foreground">
                Shield charges {config.exitDiscountBps / 100}% today. An exit never takes more than your maximum; if the owner set a higher discount than you accept,
                the exit would not run.
              </p>
              <Button
                className="h-11 w-full"
                variant="outline"
                disabled={disabled || busy || discount === cover.maxDiscountBps || discount < config.exitDiscountBps}
                onClick={async () =>
                  after(await discountTx.send("Max discount change", { address: shield.registry!, abi: positionRegistryAbi, functionName: "setMaxDiscount", args: [discount] }))
                }
              >
                Set max discount to {discount / 100}%
              </Button>
            </div>
            <TxStatus state={latestTx(triggerTx.state, discountTx.state)} />
          </TabsContent>

          <TabsContent value="optout" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Ends the cover now. The premium owed since the last reprice is charged first; the rest of your prepaid balance, about {formatUsd(live.prepaidUsd)},
              stays withdrawable on this page after you opt out.
            </p>
            {!confirming ? (
              <Button className="h-11 w-full" variant="destructive" disabled={disabled || busy} onClick={() => setConfirming(true)}>
                Opt out
              </Button>
            ) : (
              <div className="rounded-lg border border-danger/30 bg-danger-soft p-3" role="group" aria-label="Confirm opt out">
                <p className="text-sm">Opt out now? Shield will no longer exit this position at {cover.trigger.toFixed(2)}.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    disabled={disabled || busy}
                    onClick={async () => {
                      await after(await lifecycle.send("Opt-out", { address: shield.registry!, abi: positionRegistryAbi, functionName: "optOut" }));
                      setConfirming(false);
                    }}
                  >
                    Confirm opt out
                  </Button>
                  <Button variant="outline" className="bg-card" disabled={busy} onClick={() => setConfirming(false)}>
                    Keep cover
                  </Button>
                </div>
              </div>
            )}
            {lifecycle.state.label === "Opt-out" && <TxStatus state={lifecycle.state} />}
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
