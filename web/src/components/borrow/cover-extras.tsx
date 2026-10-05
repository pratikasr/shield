"use client";

import { ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import type { Address } from "viem";
import { AmountHint, AmountInput } from "@/components/data/amount-input";
import { SwitchButton } from "@/components/shell/network-guard";
import { TxStatus } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProtectionCheck, RunExitButton, SectionLabel, useSentLock } from "@/components/borrow/cover-shared";
import { SAVED_LABEL } from "@/components/borrow/history";
import { useLiveBlock } from "@/hooks/useLiveBlock";
import type { Cover } from "@/hooks/useShieldPosition";
import { useTx } from "@/hooks/useTx";
import { erc20Abi, repricerAbi } from "@/lib/abis";
import { amountText, checkAmount, unitsUsd } from "@/lib/amount";
import { headerStatus, livePrepaid, type ArmState } from "@/lib/cover-status";
import { aave, shield } from "@/lib/env";
import { formatHf, formatToken, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Prepaid USDC with no active cover behind it (after an opt-out or an exit, or before opting in). Always withdrawable,
 * and it can be topped up before opting in.
 */
export function PrepaidCard({ cover, disabled, refetch }: { cover: Cover; disabled: boolean; refetch: () => Promise<unknown> }) {
  const [tab, setTab] = useState("withdraw");
  const [withdraw, setWithdraw] = useState("");
  const [topup, setTopup] = useState("");
  const withdrawTx = useTx();
  const topupTx = useTx();
  const lock = useSentLock();
  // No accrual without active cover, so the whole balance (in USDC units) is withdrawable.
  const available = cover.prepaidWad / 10n ** 12n;
  const withdrawCheck = checkAmount(withdraw, { available, availableMessage: (a) => `The prepaid balance is ${unitsUsd(a)}. Lower the amount or use Max.` });
  const topupCheck = checkAmount(topup, { balance: cover.usdcBalanceRaw });
  const needsApproval = topupCheck.units > 0n && cover.usdcAllowance < topupCheck.units;
  const approveKey = `approve:${topupCheck.units}`;
  const busy = withdrawTx.busy || topupTx.busy;
  const after = async (receipt: unknown, key?: string) => {
    if (!receipt) return false;
    if (key) lock.hold(key);
    await refetch();
    return true;
  };
  const why = cover.exited
    ? "Left over after the exit."
    : cover.exists
      ? "Left over from your last cover."
      : "Prepaid for a cover you have not opted in to yet.";

  return (
    <section aria-labelledby="prepaid-heading" className="panel overflow-hidden">
      <div className="border-b px-5 py-5 sm:px-6">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="size-4" aria-hidden />
          <span id="prepaid-heading">Prepaid balance</span>
        </p>
        <p className="reading mt-1 text-[1.5rem] font-semibold leading-tight">{formatUsd(cover.prepaidUsd)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{why} Withdraw it at any time, or keep it for your next opt-in.</p>
      </div>
      <div className="px-5 py-5 sm:px-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
            <TabsTrigger value="add">Add</TabsTrigger>
          </TabsList>
          <TabsContent value="withdraw" className="mt-4 space-y-3">
            <SectionLabel htmlFor="prepaid-withdraw">Withdraw to this wallet</SectionLabel>
            <AmountInput
              id="prepaid-withdraw"
              value={withdraw}
              onChange={setWithdraw}
              onMax={() => setWithdraw(amountText(available))}
              maxDisabled={available === 0n}
              check={withdrawCheck}
              hintId="prepaid-withdraw-help"
              placeholder={Number(amountText(available)).toFixed(2)}
            />
            <AmountHint id="prepaid-withdraw-help" check={withdrawCheck}>
              Max withdraws all {unitsUsd(available)}.
            </AmountHint>
            {disabled ? (
              <SwitchButton action="withdraw" size="default" className="h-11 w-full" />
            ) : (
              <Button
                className="h-11 w-full"
                variant="outline"
                disabled={busy || !withdrawCheck.ok}
                onClick={async () => {
                  if (await after(await withdrawTx.send("Withdrawal", { address: shield.repricer!, abi: repricerAbi, functionName: "withdrawUnused", args: [withdrawCheck.units] })))
                    setWithdraw("");
                }}
              >
                {withdraw.trim() === "" ? "Enter an amount" : `Withdraw ${withdrawCheck.units > 0n ? unitsUsd(withdrawCheck.units) : ""}`}
              </Button>
            )}
            <TxStatus state={withdrawTx.state} />
          </TabsContent>
          <TabsContent value="add" className="mt-4 space-y-3">
            <SectionLabel htmlFor="prepaid-add" aside={<span className="text-[0.8125rem] text-muted-foreground num">Balance {formatUsd(cover.usdcBalance)}</span>}>
              Add to the prepaid balance
            </SectionLabel>
            <AmountInput
              id="prepaid-add"
              value={topup}
              onChange={setTopup}
              onMax={() => setTopup(amountText(cover.usdcBalanceRaw))}
              maxDisabled={cover.usdcBalanceRaw === 0n}
              check={topupCheck}
              hintId="prepaid-add-help"
              placeholder="10.00"
            />
            <AmountHint id="prepaid-add-help" check={topupCheck}>
              Nothing is charged until you opt in.
            </AmountHint>
            {disabled ? (
              <SwitchButton action="top up" size="default" className="h-11 w-full" />
            ) : needsApproval ? (
              <Button
                className="h-11 w-full"
                disabled={busy || !topupCheck.ok || lock.isHeld(approveKey)}
                onClick={async () =>
                  after(await topupTx.send("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.repricer!, topupCheck.units] }), approveKey)
                }
              >
                Approve USDC
              </Button>
            ) : (
              <Button
                className="h-11 w-full"
                disabled={busy || !topupCheck.ok}
                onClick={async () => {
                  if (await after(await topupTx.send("Top-up", { address: shield.repricer!, abi: repricerAbi, functionName: "topUp", args: [topupCheck.units] }))) setTopup("");
                }}
              >
                {topup.trim() === "" ? "Enter an amount" : `Add ${topupCheck.units > 0n ? unitsUsd(topupCheck.units) : ""}`}
              </Button>
            )}
            <TxStatus state={topupTx.state} />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}

/** After an exit: what happened, in one card, above the form to protect again. */
export function ExitSummary({
  savedUsd,
  repaidUsd,
  feeUsd,
  hfBefore,
  hfAfter,
  collateralTaken,
  symbol,
}: {
  savedUsd: number;
  repaidUsd: number;
  feeUsd?: number;
  hfBefore: number;
  hfAfter: number;
  collateralTaken?: number;
  symbol: string;
}) {
  return (
    <section className="panel overflow-hidden" aria-label="Last exit">
      <div className="bg-safe-soft px-5 py-5 sm:px-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-safe">
          <ShieldCheck className="size-5" aria-hidden />
          Exit completed
        </p>
        <p className="mt-2 text-[1.75rem] font-semibold leading-tight reading">{formatUsd(savedUsd)}</p>
        <p className="text-sm text-muted-foreground">{SAVED_LABEL}</p>
      </div>
      <dl className="grid grid-cols-2 gap-4 px-5 py-4 text-sm sm:px-6">
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Debt repaid</dt>
          <dd className="font-semibold num">{formatUsd(repaidUsd)}</dd>
        </div>
        {feeUsd !== undefined && (
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Fee paid</dt>
            <dd className="font-semibold num">{formatUsd(feeUsd)}</dd>
          </div>
        )}
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Health factor</dt>
          <dd className="font-semibold num">
            {formatHf(hfBefore)} to {formatHf(hfAfter)}
          </dd>
        </div>
        {collateralTaken !== undefined && (
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Collateral the vault took</dt>
            <dd className="font-semibold num">{formatToken(collateralTaken, symbol)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** A read-only view of someone else's cover, with the same status words as the owner sees. */
export function WatchedCover({
  cover,
  arm,
  borrower,
  canAct,
  keeperIdle,
  refetch,
}: {
  cover?: Cover;
  arm: ArmState;
  borrower: Address;
  /** A wallet is connected on Monad, so it may run a late exit (exits are permissionless). */
  canAct: boolean;
  keeperIdle: boolean;
  refetch: () => Promise<unknown>;
}) {
  const { data: block } = useLiveBlock();
  const live = cover ? livePrepaid(cover, block) : undefined;
  const tone = arm.tone === "safe" ? "text-safe" : arm.tone === "caution" ? "text-caution" : arm.tone === "danger" ? "text-danger" : "";
  return (
    <section className="panel p-5 sm:p-6" aria-label="Cover">
      <h2 className="text-lg font-semibold">Shield cover</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div className="col-span-2">
          <dt className="text-muted-foreground">Status</dt>
          <dd className={cn("font-semibold num", tone)}>{cover?.active ? headerStatus(arm, cover) : cover?.exited ? "Exited" : "No cover"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Trigger</dt>
          <dd className={cover?.active ? "reading font-semibold text-caution" : "reading font-semibold text-muted-foreground"}>
            {cover?.active ? cover.trigger.toFixed(2) : "Not set"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Prepaid</dt>
          <dd className="reading font-semibold">{formatUsd(live?.prepaidUsd ?? 0)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Premium paid</dt>
          <dd className="reading font-semibold">{formatUsd(live?.accruedUsd ?? 0)}</dd>
        </div>
      </dl>
      {cover?.active && arm.checks.length > 0 && (
        <div className="mt-5 border-t pt-4">
          <ProtectionCheck checks={arm.checks} />
        </div>
      )}
      {arm.kind === "due" && keeperIdle && canAct && <RunExitButton borrower={borrower} className="mt-5 border-t pt-4" onDone={() => void refetch()} />}
    </section>
  );
}
