/**
 * Number and hash formatting used everywhere in the app. Every number on screen goes through here.
 */
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
// minimumFractionDigits is explicit: without it some ICU versions (Node 22, older browsers) pad "$200K" to "$200.00K".
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** The smallest dollar figure shown in digits; anything below reads "<$0.000000001". */
const USD_FLOOR = 1e-9;

/** USD with cents; compact above $100k; two significant digits for amounts below one cent. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs === 0) return "$0.00";
  if (abs < USD_FLOOR) return value > 0 ? "<$0.000000001" : "$0.00";
  if (abs >= 100_000) return usdCompact.format(value);
  if (abs >= 0.01) return usd2.format(value);
  // Per-block premiums are tiny by design: two significant digits in fixed notation, never 1e-8.
  const decimals = Math.min(Math.max(-Math.floor(Math.log10(abs)) + 1, 2), 10);
  return `${value < 0 ? "-" : ""}$${abs.toFixed(decimals)}`;
}

/** USD with a fixed number of decimals, for a table column that must line up ("Charged"). */
export function formatUsdFixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs > 0 && abs < 10 ** -decimals) return `<$${(10 ** -decimals).toFixed(decimals)}`;
  const text = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(abs);
  return `${value < 0 && abs >= 10 ** -decimals ? "-" : ""}$${text}`;
}

/** A token amount with up to `max` decimals, grouped thousands. Never "-0". */
export function formatToken(value: number, symbol?: string, max = 4): string {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? Math.min(max, 4) : max;
  let text: string;
  if (abs > 0 && abs < 10 ** -max) text = `<${(10 ** -max).toFixed(max)}`;
  else {
    // Values that round to zero at this precision print as "0", not "-0".
    const shown = abs < 0.5 * 10 ** -digits ? 0 : value;
    text = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(shown);
  }
  return symbol ? `${text} ${symbol}` : text;
}

/** Health factor rounded down, as Aave does: three decimals so per-block moves show; "No debt" at Aave's max. */
export function formatHf(hf: number): string {
  if (Number.isNaN(hf)) return "n/a";
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

/** A discount in whole percents, with at most one decimal: 100 bps is "1%", 125 bps is "1.3%". */
export function formatDiscount(bps: number): string {
  if (!Number.isFinite(bps)) return "n/a";
  return `${Math.round(bps / 10) / 10}%`;
}

/** 0x1234…abcd for addresses and hashes. */
export function truncateHex(hex: string, head = 6, tail = 4): string {
  if (!hex || hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** "12s ago" for a unix time in seconds; "n/a" when the time is missing. */
export function timeAgo(unixSeconds: number, now = Date.now() / 1000): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "n/a";
  const s = Math.max(0, Math.round(now - unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** A duration in words: "20 seconds", "15 minutes", "2 hours". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "no time";
  if (seconds < 90) return `${Math.round(seconds)} second${Math.round(seconds) === 1 ? "" : "s"}`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}

/** A countdown as m:ss, or h:mm:ss above an hour. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Local wall-clock time, HH:MM. */
export function formatClock(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "n/a";
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** bigint with `decimals` to a JS number (display only). */
export function toNumber(value: bigint | undefined, decimals: number): number {
  if (value === undefined) return Number.NaN;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  return Number(whole) + Number(frac) / Number(base);
}

/** One sentence from an error message: first line, no trailing period, so callers can add their own. */
export function firstLine(message: string): string {
  return (message.split("\n")[0] ?? "").trim().replace(/[.\s]+$/, "");
}
