/**
 * Number and hash formatting used everywhere in the app. Every number on screen goes through here.
 */
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });

/** USD with cents; compact above $100k; significant digits for amounts below one cent. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs === 0) return "$0.00";
  if (abs >= 100_000) return usdCompact.format(value);
  if (abs >= 0.01) return usd2.format(value);
  // Per-block premiums are tiny by design: show two significant digits in fixed notation, never 1e-8.
  const decimals = Math.min(Math.max(-Math.floor(Math.log10(abs)) + 1, 2), 12);
  return `${value < 0 ? "-" : ""}$${abs.toFixed(decimals)}`;
}

/** A token amount with up to `max` decimals, grouped thousands. */
export function formatToken(value: number, symbol?: string, max = 4): string {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? Math.min(max, 4) : max;
  const text =
    abs > 0 && abs < 10 ** -max
      ? `<${(10 ** -max).toFixed(max)}`
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
  return symbol ? `${text} ${symbol}` : text;
}

/** Health factor rounded down, as Aave does: three decimals so per-block moves show; "No debt" at Aave's max. */
export function formatHf(hf: number): string {
  if (!Number.isFinite(hf) || hf > 1e9) return "No debt";
  const d = hf < 10 ? 3 : 2;
  return (Math.floor(hf * 10 ** d) / 10 ** d).toFixed(d);
}

export function formatPct(fraction: number, digits = 2): string {
  if (!Number.isFinite(fraction)) return "n/a";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** 0x1234…abcd for addresses and hashes. */
export function truncateHex(hex: string, head = 6, tail = 4): string {
  if (!hex || hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export function timeAgo(unixSeconds: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(now - unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** bigint with `decimals` to a JS number (display only). */
export function toNumber(value: bigint | undefined, decimals: number): number {
  if (value === undefined) return Number.NaN;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  return Number(whole) + Number(frac) / Number(base);
}
