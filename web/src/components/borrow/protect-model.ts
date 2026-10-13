import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import type { Cover } from "@/hooks/useShieldPosition";
import { aaveLiquidation, BLOCKS_PER_DAY, shieldExit } from "@/lib/economics";

/**
 * The borrower page's pure rules: which collateral it works with, the price at a health factor, the three trigger
 * presets, the fuel presets and the plain-word safety and runway texts. No React, so the rules are unit tested.
 */

/**
 * The one collateral the page works with: the cover's own while it is active or after it exited (the registry's
 * collateral is read only when the record exists), else the largest supply the registry has enabled.
 */
export function pickCollateral(position: AavePosition, cover: Cover | undefined, config: ShieldConfig | undefined): ReserveLine | undefined {
  const own =
    cover?.exists && (cover.active || cover.exited) && cover.collateral
      ? position.allReserves.find((r) => r.asset.toLowerCase() === cover.collateral!.toLowerCase())
      : undefined;
  if (own && cover?.active) return own;
  const enabled = new Set((config?.assets ?? []).filter((a) => a.enabled).map((a) => a.asset.toLowerCase()));
  const supplies = position.reserves.filter((r) => r.suppliedRaw > 0n && enabled.has(r.asset.toLowerCase())).sort((a, b) => b.suppliedUsd - a.suppliedUsd);
  // After an exit, protecting again starts from the same collateral when it can still be covered.
  if (own && supplies.some((r) => r.asset === own.asset)) return own;
  return supplies[0] ?? own;
}

/** The collateral price at which the health factor reaches `hf`, holding the debt and other collateral still. */
export function priceAtHf(position: Pick<AavePosition, "healthFactor" | "debtUsd">, collateral: Pick<ReserveLine, "priceUsd" | "supplied" | "liquidationThreshold">, hf: number): number {
  if (!Number.isFinite(position.healthFactor) || collateral.supplied <= 0 || position.debtUsd <= 0) return Number.NaN;
  return collateral.priceUsd - ((position.healthFactor - hf) * position.debtUsd) / (collateral.supplied * collateral.liquidationThreshold);
}

/** How far the price can fall from `now` to `price`, as a fraction (0.065 for 6.5%); NaN when it cannot be said. */
export function dropTo(now: number, price: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(price) || now <= 0) return Number.NaN;
  return (now - price) / now;
}

/** Percent with one decimal: 0.0654 is "6.5%". */
export function pct1(fraction: number): string {
  if (!Number.isFinite(fraction)) return "n/a";
  return `${(Math.max(fraction, 0) * 100).toFixed(1)}%`;
}

/** Whole dollars for headline prices ("$2,640"); cents only below $100. */
export function usdWhole(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (Math.abs(value) < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Aave's liquidation and Shield's exit for this position at `trigger`, on the definitions in lib/economics.ts. */
export function compareCosts(position: AavePosition, collateral: ReserveLine, trigger: number, config: Pick<ShieldConfig, "exitDiscountBps" | "exitHfBuffer">) {
  const liqPrice = priceAtHf(position, collateral, 1);
  const trigPrice = priceAtHf(position, collateral, trigger);
  const valueAt = (price: number) => (Number.isFinite(price) && price > 0 ? collateral.supplied * price : collateral.suppliedUsd);
  const aave = aaveLiquidation({
    totalDebtUsd: position.debtUsd,
    debtReserveUsd: position.usdc?.borrowedUsd ?? 0,
    collateralUsd: valueAt(liqPrice),
    bonus: collateral.liquidationBonus,
  });
  const exit = shieldExit({
    totalDebtUsd: position.debtUsd,
    usdcDebtUsd: position.usdc?.borrowedUsd ?? 0,
    trigger,
    liquidationThreshold: collateral.liquidationThreshold,
    collateralUsd: valueAt(trigPrice),
    discountBps: config.exitDiscountBps,
    hfBuffer: config.exitHfBuffer,
  });
  /** What Shield takes for its repayment, and what Aave's bonus would take for the same repayment. */
  const shieldTakesUsd = exit.repayUsd * (1 + config.exitDiscountBps / 10_000);
  const aaveTakesUsd = exit.repayUsd * collateral.liquidationBonus;
  return { aave, exit, shieldTakesUsd, aaveTakesUsd };
}

/** "Safe", "Careful" or "Danger" from how far the price can fall before Aave liquidates. */
export type Safety = "safe" | "careful" | "danger";
export function safetyOf(drop: number): Safety {
  if (!Number.isFinite(drop)) return "safe";
  if (drop >= 0.15) return "safe";
  if (drop >= 0.05) return "careful";
  return "danger";
}
export const SAFETY_WORD: Record<Safety, string> = { safe: "Safe", careful: "Careful", danger: "Danger" };

export interface TriggerPreset {
  id: "early" | "balanced" | "last";
  name: string;
  /** Health factor where Shield steps in, two decimals as the registry stores it in bps. */
  trigger: number;
  note: string;
  /** Why the card cannot be picked: at or above today's health factor, or below the floor near Aave's line. */
  disabled?: "above" | "floor";
}

/** The lowest trigger a preset offers: below it a sharp move can cross the trigger and Aave's line in one block. */
export const PRESET_FLOOR = 1.02;
/** The highest trigger a preset offers (the contract accepts up to 2.00). */
export const PRESET_CEILING = 1.5;
/** Triggers at or below this ask the borrower to confirm they understand how little room is left. */
export const NEAR_ONE = 1.02;
/** How far down the room between today and Aave's line each preset sits (the share of the room left above Aave). */
const PRESET_SHARES: { id: TriggerPreset["id"]; name: string; share: number; note: string }[] = [
  { id: "early", name: "Early", share: 0.85, note: "Steps in soonest. Costs the most." },
  { id: "balanced", name: "Balanced", share: 0.57, note: "Room to spare at a fair price." },
  { id: "last", name: "Last call", share: 0.29, note: "Cheapest. Cuts it closest to Aave." },
];

/**
 * Three triggers spread across the room between today's health factor and Aave's 1.00, computed from the live
 * position: Early sits near today, Last call near Aave. A preset at or above today's health factor (the exit would be
 * due at once) or below the floor comes back disabled, with the reason; one that rounds to the same trigger as an
 * earlier card is left out.
 */
export function triggerPresets(healthFactor: number): TriggerPreset[] {
  if (!Number.isFinite(healthFactor) || healthFactor <= 1) return [];
  const room = Math.min(healthFactor - 1, PRESET_CEILING - 1 + 0.1);
  const out: TriggerPreset[] = [];
  for (const p of PRESET_SHARES) {
    const t = Math.min(Math.round((1 + room * p.share) * 100) / 100, PRESET_CEILING);
    if (out.some((o) => o.trigger === t)) continue;
    const disabled = t >= healthFactor ? "above" : t < PRESET_FLOOR ? "floor" : undefined;
    out.push({ id: p.id, name: p.name, trigger: t, note: p.note, disabled });
  }
  return out;
}

/** The presets that can be picked. */
export function validPresets(presets: TriggerPreset[]): TriggerPreset[] {
  return presets.filter((p) => !p.disabled);
}

/** The preset chosen by default: Balanced when it exists, else the middle one left. */
export function defaultPreset(presets: TriggerPreset[]): TriggerPreset | undefined {
  const ok = validPresets(presets);
  return ok.find((p) => p.id === "balanced") ?? ok[Math.floor((ok.length - 1) / 2)];
}

export interface FuelOption {
  id: string;
  label: string;
  /** USDC units (6 decimals) to add; 0 keeps the fuel already there. */
  units: bigint;
  /** Days the fuel lasts at today's rate, counting fuel already there. */
  days: number;
  sub: string;
}

const DAY_MONTH = 30;

/** Rounds a dollar figure up to the cent, in USDC units. */
function centsUpUnits(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  return BigInt(Math.ceil(usd * 100 - 1e-9)) * 10_000n;
}

/** "about 5 days", "about 3 months", "about 1 year", "less than a day". */
export function lastsFor(days: number): string {
  if (!Number.isFinite(days)) return "as long as the rate stays at zero";
  if (days < 1) return days * 24 < 1 ? "less than an hour" : `about ${Math.max(1, Math.round(days * 24))} hours`;
  if (days < 45) return `about ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`;
  if (days < 335) return `about ${Math.round(days / DAY_MONTH)} months`;
  const years = days / 365;
  const shown = years < 3 ? Math.round(years * 2) / 2 : Math.round(years);
  return shown <= 1 ? "about 1 year" : `about ${shown} years`;
}

/**
 * Fuel cards: 1 month, 3 months and 1 year of the premium at today's rate, each at least `minUnits` (the registry
 * needs 1 USDC prepaid to opt in). When the minimum already buys more than a month the first card becomes "Minimum"
 * and the others move to longer periods, so two cards never show the same price. With fuel already prepaid
 * (`prepaidUsd`, enough to opt in) the first card keeps it and the others add to it.
 */
export function fuelOptions({ perBlockUsd, minUnits, prepaidUsd = 0, funded = false }: { perBlockUsd: number; minUnits: bigint; prepaidUsd?: number; funded?: boolean }): FuelOption[] {
  const perDay = perBlockUsd * BLOCKS_PER_DAY;
  const daysFor = (units: bigint) => (perDay > 0 ? (Number(units) / 1e6 + prepaidUsd) / perDay : Number.POSITIVE_INFINITY);
  const month = perDay * DAY_MONTH;
  const out: FuelOption[] = [];
  const label = (m: number) => (m === 12 ? "1 year" : m === 24 ? "2 years" : `${m} months`);
  if (funded) {
    const have = daysFor(0n);
    out.push({ id: "keep", label: "Keep what’s there", units: 0n, days: have, sub: `Lasts ${lastsFor(have)} at today's rate.` });
    // Additions that make a visible difference to what is already there.
    const periods = [1, 3, 12, 24];
    const useful = periods.filter((m) => m * DAY_MONTH >= have * 0.25);
    for (const m of (useful.length >= 2 ? useful : periods).slice(useful.length >= 2 ? 0 : -2).slice(0, 2)) {
      const units = centsUpUnits(month * m);
      if (units <= 0n) continue;
      out.push({ id: `m${m}`, label: `Add ${label(m)}`, units, days: daysFor(units), sub: `Lasts ${lastsFor(daysFor(units))} in all.` });
    }
    return out;
  }
  const monthUnits = centsUpUnits(month);
  const isMin = monthUnits < minUnits;
  const firstUnits = isMin ? minUnits : monthUnits;
  const firstDays = daysFor(firstUnits);
  const firstMonths = firstDays / DAY_MONTH;
  const minimum = isMin && firstMonths >= 1.5;
  out.push({
    id: minimum ? "min" : "m1",
    label: minimum ? "Minimum" : "1 month",
    units: firstUnits,
    days: firstDays,
    sub: minimum ? `${usdUnits(minUnits)} is the least you can add. Lasts ${lastsFor(firstDays)}.` : `Lasts ${lastsFor(firstDays)}.`,
  });
  const need = Math.max(firstMonths * 1.5, 1.5);
  const picks = [3, 12, 6, 24].filter((m) => m >= need).slice(0, 2).sort((a, b) => a - b);
  for (const m of picks) {
    const units = centsUpUnits(month * m);
    if (units <= firstUnits) continue;
    out.push({ id: `m${m}`, label: label(m), units, days: daysFor(units), sub: `Lasts ${lastsFor(daysFor(units))} at today's rate.` });
  }
  return out;
}

/** "One wallet prompt", "Three wallet prompts". */
export function promptsText(n: number): string {
  const words = ["No", "One", "Two", "Three", "Four", "Five"];
  return `${words[n] ?? n} wallet prompt${n === 1 ? "" : "s"}`;
}

/** "$1.00" from USDC units. */
export function usdUnits(units: bigint): string {
  const cents = Number(units / 10_000n);
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Fuel left below this many days is "low". */
export const LOW_FUEL_DAYS = 7;

/** Segments of the 10-segment fuel bar: a year of fuel fills it; any fuel at all shows one. */
export function fuelSegments(days: number): number {
  if (!(days > 0)) return 0;
  if (!Number.isFinite(days)) return 10;
  return Math.min(10, Math.max(1, Math.ceil(days / 36.5)));
}
