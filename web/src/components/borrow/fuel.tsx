"use client";

import { useState, type ReactNode } from "react";
import type { Address } from "viem";
import { FundingSource } from "@/components/aurora/funding-source";
import { Card } from "@/components/cartoon/card";
import { ChoiceCards } from "@/components/cartoon/choice-cards";
import { CartoonButton } from "@/components/cartoon/button";
import { CartoonIcon } from "@/components/cartoon/icons";
import { useSentLock } from "@/components/borrow/cover-shared";
import { TxLine } from "@/components/borrow/protect-frame";
import { lastsFor, usdUnits } from "@/components/borrow/protect-model";
import { AmountHint, AmountInput } from "@/components/data/amount-input";
import { SwitchButton } from "@/components/shell/network-guard";
import type { Cover } from "@/hooks/useShieldPosition";
import { latestTx } from "@/components/tx/tx-status";
import { useTx } from "@/hooks/useTx";
import { erc20Abi, repricerAbi } from "@/lib/abis";
import { amountText, centsUp, checkAmount, unitsUsd } from "@/lib/amount";
import { BLOCKS_PER_DAY } from "@/lib/economics";
import { aave, shield } from "@/lib/env";
import { formatUsd } from "@/lib/format";

/** Blocks of premium kept back from a full take-back while cover is on: the accrual until the transaction lands. */
const WITHDRAW_MARGIN_BLOCKS = 30n;

/** Approve USDC if needed, then top up: one button, one or two wallet prompts. */
export function useAddFuel(cover: Cover, refetch: () => Promise<unknown>) {
  const approveTx = useTx();
  const topupTx = useTx();
  const add = async (units: bigint): Promise<boolean> => {
    if (units <= 0n) return false;
    if (cover.usdcAllowance < units) {
      const ok = await approveTx.send("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.repricer!, units] });
      if (!ok) return false;
      await refetch();
    }
    const done = await topupTx.send("Top-up", { address: shield.repricer!, abi: repricerAbi, functionName: "topUp", args: [units] });
    if (!done) return false;
    await refetch();
    return true;
  };
  return { add, busy: approveTx.busy || topupTx.busy, state: latestTx(approveTx.state, topupTx.state), phase: approveTx.busy ? approveTx.state.phase : topupTx.state.phase };
}

/** What a busy button says, by the transaction's phase. */
export function busyText(phase: string | undefined): string {
  return phase === "checking" ? "Checking with Monad" : phase === "pending" ? "Sending to Monad" : "Waiting for your wallet";
}

/** Fuel amounts by time at today's rate, at least `min` (USDC units). */
export function fuelAmounts(perBlockUsd: number, min = 0n) {
  const perDay = perBlockUsd * BLOCKS_PER_DAY;
  return [
    { id: "m1", label: "1 month", days: 30 },
    { id: "m3", label: "3 months", days: 91 },
    { id: "y1", label: "1 year", days: 365 },
  ].map((p) => {
    const raw = centsUp(perDay * p.days);
    return { ...p, units: raw > min ? raw : min };
  });
}

/**
 * The "Add fuel" tray: amounts by time at today's rate or a typed amount, paid as USDC on Monad or from another chain
 * (Aurora Intents). Adding fuel to a lapsed cover re-arms it after the waiting period.
 */
export function AddFuelTray({
  user,
  cover,
  perBlockUsd,
  liveBalanceUsd,
  wrongNetwork,
  refetch,
  rearmNote,
}: {
  user: Address;
  cover: Cover;
  perBlockUsd: number;
  liveBalanceUsd: number;
  wrongNetwork: boolean;
  refetch: () => Promise<unknown>;
  /** Shown when the cover is out of fuel: when it re-arms after a top-up. */
  rearmNote?: string;
}) {
  const options = fuelAmounts(perBlockUsd, 10_000n);
  const [pick, setPick] = useState<string | undefined>("m1");
  const [typed, setTyped] = useState("");
  const fuel = useAddFuel(cover, refetch);
  const lock = useSentLock();
  const chosen = options.find((o) => o.id === pick);
  const check = typed.trim() ? checkAmount(typed, { balance: cover.usdcBalanceRaw }) : undefined;
  const units = check ? check.units : (chosen?.units ?? 0n);
  const overBalance = !check && units > cover.usdcBalanceRaw;
  const ok = check ? check.ok : units > 0n && !overBalance;
  const perDay = perBlockUsd * BLOCKS_PER_DAY;
  const lastsAfter = perDay > 0 ? (liveBalanceUsd + Number(units) / 1e6) / perDay : Number.POSITIVE_INFINITY;
  const key = `add:${units}`;
  return (
    <div className="grid gap-4">
      <FundingSource kind="premium" owner={user} refundTo={user} wrongNetwork={wrongNetwork} onSwept={() => void refetch()}>
        <ChoiceCards
          label="How much fuel"
          value={check ? undefined : pick}
          onChange={(v) => {
            setPick(v);
            setTyped("");
          }}
          options={options.map((o) => ({ value: o.id, name: o.label, big: usdUnits(o.units), sub: o.units > cover.usdcBalanceRaw ? "More than your USDC" : undefined }))}
        />
        <div className="grid gap-1.5">
          <label htmlFor="fuel-amount" className="text-[15px] font-semibold">
            Or type an amount
          </label>
          <AmountInput
            id="fuel-amount"
            value={typed}
            onChange={setTyped}
            onMax={() => setTyped(amountText(cover.usdcBalanceRaw))}
            maxDisabled={cover.usdcBalanceRaw === 0n}
            check={check}
            hintId="fuel-amount-help"
            placeholder="10.00"
          />
          <AmountHint id="fuel-amount-help" check={check}>
            {overBalance
              ? `This wallet holds ${formatUsd(cover.usdcBalance)} of USDC. Pick less, or pay from another chain.`
              : `Your fuel then lasts ${lastsFor(lastsAfter)} at today's rate. This wallet holds ${formatUsd(cover.usdcBalance)} of USDC.`}
            {rearmNote ? ` ${rearmNote}` : ""}
          </AmountHint>
        </div>
        {wrongNetwork ? (
          <SwitchButton action="add fuel" className="c-btn-big w-full" />
        ) : (
          <CartoonButton
            size="big"
            disabled={!ok || lock.isHeld(key)}
            loading={fuel.busy}
            loadingText={busyText(fuel.phase)}
            onClick={async () => {
              if (await fuel.add(units)) {
                lock.hold(key);
                setTyped("");
              }
            }}
          >
            {units > 0n ? `Add ${unitsUsd(units)} of fuel` : "Pick an amount"}
          </CartoonButton>
        )}
        <TxLine state={fuel.state} done={fuel.state.label === "Top-up" ? "Fuel added" : undefined} />
      </FundingSource>
    </div>
  );
}

/**
 * "Take back fuel": unused prepaid USDC back to the wallet. While cover is on, the premium owed since the last
 * reprice (and a margin for the blocks until the transaction lands) stays behind.
 */
export function TakeBackTray({ cover, rate, blocksSince, wrongNetwork, refetch }: { cover: Cover; rate: number; blocksSince: number; wrongNetwork: boolean; refetch: () => Promise<unknown> }) {
  const [raw, setRaw] = useState("");
  const tx = useTx();
  const active = cover.active && !cover.lapsed;
  const owedWad = active ? BigInt(Math.ceil(rate * 1e18)) * (BigInt(blocksSince) + WITHDRAW_MARGIN_BLOCKS) : 0n;
  const availableWad = cover.prepaidWad > owedWad ? cover.prepaidWad - owedWad : 0n;
  const available = availableWad / 10n ** 12n;
  const check = checkAmount(raw, {
    available,
    availableMessage: (a) => `About ${unitsUsd(a)} can come back now: the fuel left less what Shield has used since its last update. Lower the amount or use Max.`,
  });
  return (
    <div className="grid gap-3">
      <label htmlFor="take-back" className="text-[15px] font-semibold">
        Take back unused fuel
      </label>
      <AmountInput
        id="take-back"
        value={raw}
        onChange={setRaw}
        onMax={() => setRaw(amountText(available))}
        maxDisabled={available === 0n}
        check={check}
        hintId="take-back-help"
        placeholder={Number(amountText(available)).toFixed(2)}
      />
      <AmountHint id="take-back-help" check={check}>
        About {unitsUsd(available)} can come back now.{" "}
        {active ? "Taking it all leaves Shield to switch off when the rest runs out. To take everything, turn Shield off first." : ""}
      </AmountHint>
      {wrongNetwork ? (
        <SwitchButton action="take back fuel" className="c-btn-big w-full" />
      ) : (
        <CartoonButton
          variant="white"
          size="big"
          disabled={!check.ok}
          loading={tx.busy}
          loadingText={busyText(tx.state.phase)}
          onClick={async () => {
            if (await tx.send("Withdrawal", { address: shield.repricer!, abi: repricerAbi, functionName: "withdrawUnused", args: [check.units] })) {
              setRaw("");
              await refetch();
            }
          }}
        >
          {raw.trim() && check.units > 0n ? `Take back ${unitsUsd(check.units)}` : "Enter an amount"}
        </CartoonButton>
      )}
      <TxLine state={tx.state} done="Fuel taken back" />
    </div>
  );
}

/**
 * Fuel left with no cover running (after turning off or a rescue): all of it is the borrower's. One button takes it
 * all back; `keep` is the other choice where the page offers one.
 */
export function LeftoverFuel({
  cover,
  wrongNetwork,
  readOnly,
  refetch,
  title,
  text,
  keep,
}: {
  cover: Cover;
  wrongNetwork: boolean;
  readOnly?: boolean;
  refetch: () => Promise<unknown>;
  title?: ReactNode;
  text?: ReactNode;
  keep?: ReactNode;
}) {
  const tx = useTx();
  const all = cover.prepaidWad / 10n ** 12n;
  return (
    <Card className="grid gap-3">
      <div className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3">
        <div className="grid size-11 place-items-center rounded-xl border-2 border-ink bg-heads-tint" aria-hidden>
          <CartoonIcon name="fuel" size={26} />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-[22px] leading-[1.1]">{title ?? `You have ${formatUsd(cover.prepaidUsd)} of fuel left.`}</h2>
          <p className="mb-0 mt-1">{text ?? "It is yours. Take it back, or keep it for when you protect again."}</p>
        </div>
      </div>
      {!readOnly && (
        <div className="c-row">
          {wrongNetwork ? (
            <SwitchButton action="take back your fuel" size="default" />
          ) : (
            <CartoonButton
              variant={keep ? "primary" : "white"}
              disabled={all === 0n}
              loading={tx.busy}
              loadingText={busyText(tx.state.phase)}
              onClick={async () => {
                if (await tx.send("Withdrawal", { address: shield.repricer!, abi: repricerAbi, functionName: "withdrawUnused", args: [all] })) await refetch();
              }}
            >
              Take it back
            </CartoonButton>
          )}
          {keep}
        </div>
      )}
      <TxLine state={tx.state} done="Fuel taken back" />
    </Card>
  );
}
