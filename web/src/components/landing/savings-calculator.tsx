"use client";

import { useState } from "react";
import { Chip } from "@/components/data/chip";
import { Slider } from "@/components/ui/slider";
import { LAUNCH_EXIT, aaveLiquidation, annualPremiumUsd, shieldExit } from "@/lib/economics";
import { formatUsd } from "@/lib/format";

const LT = 0.84;
const BONUS = 1.055;
const TRIGGER = 1.05;
const K = 0.00125;
const SIGMA = 0.8;
const PRESETS = [10_000, 50_000, 250_000, 1_000_000];
/** Slider position 0..100 maps to $5,000..$2,000,000 on a log scale. */
const MIN = Math.log10(5_000);
const MAX = Math.log10(2_000_000);
const toDebt = (p: number) => Math.round(10 ** (MIN + ((MAX - MIN) * p) / 100) / 1000) * 1000;
const toPos = (d: number) => ((Math.log10(d) - MIN) / (MAX - MIN)) * 100;

const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

const BASIS: Record<string, string> = { half: "half the debt", all: "all of the debt", collateral: "as much debt as the collateral covers" };

/**
 * What a liquidation would take from a WETH-backed USDC loan, against what a Shield exit at 1.05 costs, on the same
 * definitions as the app (lib/economics.ts).
 */
export function SavingsCalculator() {
  const [debt, setDebt] = useState(100_000);
  // At a liquidation the health factor is 1.00, so the WETH is worth debt / LT.
  const aave = aaveLiquidation({ totalDebtUsd: debt, debtReserveUsd: debt, collateralUsd: debt / LT, bonus: BONUS });
  const exit = shieldExit({ totalDebtUsd: debt, usdcDebtUsd: debt, trigger: TRIGGER, liquidationThreshold: LT, discountBps: LAUNCH_EXIT.discountBps, hfBuffer: LAUNCH_EXIT.hfBuffer });
  const premiumAt = (distance: number) => annualPremiumUsd({ debtUsd: debt, healthFactor: TRIGGER + distance, trigger: TRIGGER, k: K, sigma: SIGMA, dMin: LAUNCH_EXIT.dMin });
  const max = Math.max(aave.penaltyUsd, exit.costUsd);

  return (
    <div className="panel grid overflow-hidden lg:grid-cols-[1fr_1.15fr]">
      <div className="border-b p-6 sm:p-8 lg:border-b-0 lg:border-r">
        <label htmlFor="calc-debt" className="text-sm font-medium">
          USDC borrowed against WETH
        </label>
        <p className="reading mt-2 text-[2.5rem] font-medium leading-none">{whole.format(debt)}</p>
        <Slider
          id="calc-debt"
          className="mt-6"
          min={0}
          max={100}
          step={0.5}
          value={[toPos(debt)]}
          onValueChange={(v) => setDebt(toDebt(v[0]!))}
          aria-label="USDC borrowed"
          valueText={whole.format(debt)}
        />
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Loan sizes">
          {PRESETS.map((p) => (
            <Chip key={p} active={debt === p} onClick={() => setDebt(p)} label={whole.format(p)}>
              {compact.format(p)}
            </Chip>
          ))}
        </div>
        <p className="mt-6 text-[0.8125rem] text-muted-foreground">
          Assumes Aave V3 Monad&rsquo;s WETH terms: liquidation threshold 84% and a 5.5% bonus on the debt a liquidator repays, which is half the debt at these
          sizes. Shield exits at a health factor of {TRIGGER.toFixed(2)}, repays enough to restore {(TRIGGER + LAUNCH_EXIT.hfBuffer).toFixed(2)} and takes{" "}
          {LAUNCH_EXIT.discountBps / 100}% of that. Volatility 80% a year.
        </p>
      </div>
      <div className="p-6 sm:p-8">
        <dl className="grid gap-6">
          <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
            <dt className="text-sm text-muted-foreground">If Aave liquidates you</dt>
            <dd className="reading text-[1.5rem] font-semibold text-danger">&minus;{formatUsd(aave.penaltyUsd)}</dd>
            <dd className="col-span-2 mt-2 h-3 rounded-full bg-muted" aria-hidden>
              <div className="h-3 rounded-full bg-danger/85" style={{ width: `${(aave.penaltyUsd / max) * 100}%` }} />
            </dd>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
            <dt className="text-sm text-muted-foreground">If Shield exits first</dt>
            <dd className="reading text-[1.5rem] font-semibold text-safe">&minus;{formatUsd(exit.costUsd)}</dd>
            <dd className="col-span-2 mt-2 h-3 rounded-full bg-muted" aria-hidden>
              <div className="h-3 rounded-full bg-safe" style={{ width: `${Math.max((exit.costUsd / max) * 100, 1)}%` }} />
            </dd>
          </div>
        </dl>
        <div className="mt-8 rounded-lg bg-raised p-4">
          <p className="text-sm">
            Against a liquidation of {BASIS[aave.basis]} you keep <strong className="font-semibold num">{formatUsd(aave.penaltyUsd - exit.costUsd)}</strong> more
            collateral, before the premium you pay for cover.
          </p>
          <p className="mt-1.5 text-[0.8125rem] text-muted-foreground num">
            Cover costs about {formatUsd(premiumAt(0.2))} a year with your health factor 0.20 above the trigger, {formatUsd(premiumAt(0.05))} at 0.05, and up to{" "}
            {formatUsd(premiumAt(LAUNCH_EXIT.dMin))} at 0.01 or closer. It is paid only while you hold cover.
          </p>
        </div>
      </div>
    </div>
  );
}
