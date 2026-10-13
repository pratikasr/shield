import { formatUnits, parseUnits } from "viem";
import { formatUsd } from "./format";

/**
 * One parser for every amount field (prepay, top up, withdraw, vault deposit and withdraw). It works on the raw string
 * and in bigint units, so no amount ever passes through a float: 1e21 typed in a field is a validation message,
 * never exponent notation or a thrown error during render.
 */

/** Keeps what a person can mean in an amount: digits, points and commas. */
export function cleanAmountInput(raw: string): string {
  return raw.replace(/[^\d.,]/g, "");
}

/**
 * One comma and no point is a decimal comma ("2,5" is 2.5, never 25). With a point present, or with several commas,
 * commas are thousands separators and are dropped ("1,000.50" is 1000.50).
 */
export function normaliseAmount(raw: string): string {
  const s = raw.replace(/\s/g, "");
  const commas = (s.match(/,/g) ?? []).length;
  if (commas === 1 && !s.includes(".")) return s.replace(",", ".");
  return s.replace(/,/g, "");
}

export type AmountTone = "muted" | "danger";

export interface AmountCheck {
  /** The parsed amount in token units; 0n when the field is empty or invalid. */
  units: bigint;
  /** True when `units` can be sent as is. */
  ok: boolean;
  /** Why the amount cannot be sent, in one sentence; undefined when empty or fine. */
  message?: string;
  tone: AmountTone;
}

export interface AmountLimits {
  decimals?: number;
  symbol?: string;
  /** The wallet balance; above it the field is red. */
  balance?: bigint;
  /** Less than the balance when only part of it can be used (for example "Available now"). */
  available?: bigint;
  /** Sentence for an amount above `available`. */
  availableMessage?: (available: bigint) => string;
  /** The least that can be sent. */
  min?: bigint;
  minMessage?: (min: bigint) => string;
}

const usd = (units: bigint, decimals: number) => formatUsd(Number(formatUnits(units, decimals)));

/** Parses and checks an amount field. Never throws. */
export function checkAmount(raw: string, limits: AmountLimits = {}): AmountCheck {
  const decimals = limits.decimals ?? 6;
  const symbol = limits.symbol ?? "USDC";
  const bad = (message: string): AmountCheck => ({ units: 0n, ok: false, message, tone: "danger" });
  const s = normaliseAmount(raw);
  if (s === "") return { units: 0n, ok: false, tone: "muted" };
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return bad("Enter a number, like 25 or 25.50.");
  const [whole = "", frac = ""] = s.split(".");
  if (frac.length > decimals) {
    const kept = frac.slice(0, decimals);
    const belowUnit = /^0*$/.test(whole) && /^0*$/.test(kept) && /[1-9]/.test(frac);
    return bad(
      belowUnit
        ? `The smallest amount is ${(10 ** -decimals).toFixed(decimals)} ${symbol}.`
        : `${symbol} has ${decimals} decimals. Use at most ${decimals} digits after the point.`,
    );
  }
  let units: bigint;
  try {
    units = parseUnits(`${whole || "0"}.${frac || "0"}`, decimals);
  } catch {
    return bad("Enter a number, like 25 or 25.50.");
  }
  if (units === 0n) return bad("Enter more than 0.");
  if (limits.balance !== undefined && units > limits.balance) {
    return { units, ok: false, tone: "danger", message: `This wallet holds ${usd(limits.balance, decimals)} of ${symbol}. Lower the amount or add ${symbol}.` };
  }
  if (limits.available !== undefined && units > limits.available) {
    return {
      units,
      ok: false,
      tone: "danger",
      message: limits.availableMessage?.(limits.available) ?? `Only ${usd(limits.available, decimals)} is available. Lower the amount.`,
    };
  }
  if (limits.min !== undefined && units < limits.min) {
    return { units, ok: false, tone: "danger", message: limits.minMessage?.(limits.min) ?? `Enter at least ${usd(limits.min, decimals)}.` };
  }
  return { units, ok: true, tone: "muted" };
}

/** The exact field text for a bigint amount, for Max buttons: no float, no exponent. */
export function amountText(units: bigint, decimals = 6): string {
  return formatUnits(units, decimals);
}

/** Dollars for a button label ("Top up $12.50"), from units. */
export function unitsUsd(units: bigint, decimals = 6): string {
  return usd(units, decimals);
}

/** Rounds a dollar figure up to the cent and returns USDC units: the prepay the app suggests. */
export function centsUp(value: number, decimals = 6): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  const cents = BigInt(Math.ceil(value * 100 - 1e-9));
  return cents * 10n ** BigInt(decimals - 2);
}
