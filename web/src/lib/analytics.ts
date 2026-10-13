/**
 * Analytics data: the Envio queries the public analytics page runs, and the pure shaping it needs (period totals from
 * earnings buckets, chart series, axis scales, the live block stream). No React and no network here, so every rule is
 * unit tested (analytics.test.ts) and the landing page can import the constants on the server.
 */
import type { ExitRow } from "./envio";
import { BLOCKS_PER_YEAR } from "./economics";
import { formatUsd, toNumber } from "./format";

// ------------------------------------------------------------------------------------------------ periods

export type Period = "24h" | "7d" | "30d" | "all";

export const PERIODS: { id: Period; label: string; phrase: string; unit: "hour" | "day" }[] = [
  { id: "24h", label: "24 hours", phrase: "in the last 24 hours", unit: "hour" },
  { id: "7d", label: "7 days", phrase: "in the last 7 days", unit: "hour" },
  { id: "30d", label: "30 days", phrase: "in the last 30 days", unit: "day" },
  { id: "all", label: "All time", phrase: "since launch", unit: "day" },
];

export function periodInfo(period: Period) {
  return PERIODS.find((p) => p.id === period)!;
}

export const HOUR = 3600;
export const DAY = 86_400;
/** Hour buckets the page fetches: enough for the 7-day view. */
export const HOURS_FETCHED = 7 * 24;
/** "All time" shows at least this many days, so one day of history reads as a bar on a timeline, not a block. */
export const MIN_ALL_TIME_DAYS = 7;

// ------------------------------------------------------------------------------------------------ queries

const BUCKET_FIELDS =
  "period start premiumCharged premiumToVault premiumToProtocol protocolPaid exitDiscount exits debtRepaid savedVsAave reprices optIns deposited withdrawn";
const EXIT_FIELDS = "borrower collateral repaid seized savedVsAave healthFactorBefore healthFactorAfter flashLoanAmount blockNumber timestamp txHash trigger discountBps";

/**
 * Everything the page shows from the indexer, in one request, for every period at once: the all-time row, the last
 * week of hour buckets and every day bucket. Switching period never refetches. `$hourFrom` moves once an hour.
 */
export const ANALYTICS_QUERY = `
  query Analytics($hourFrom: numeric!) {
    all: EarningsBucket(where: { id: { _eq: "all" } }) { ${BUCKET_FIELDS} }
    hours: EarningsBucket(where: { period: { _eq: "hour" }, start: { _gte: $hourFrom } }, order_by: { start: asc }, limit: ${HOURS_FETCHED + 2}) { ${BUCKET_FIELDS} }
    days: EarningsBucket(where: { period: { _eq: "day" } }, order_by: { start: desc }, limit: 400) { ${BUCKET_FIELDS} }
    ProtocolConfig(where: { id: { _eq: "config" } }) { treasury protocolShareBps exitDiscountBps }
    Position(order_by: [{ status: asc }, { optedInAt: desc }], limit: 50) {
      borrower collateral status trigger healthFactor premiumPerBlock premiumPaid repriceCount optedInAt
    }
    Exit(order_by: { blockNumber: desc }, limit: 20) { ${EXIT_FIELDS} }
    recentReprices: Reprice(order_by: { blockNumber: desc }, limit: 40) { txHash blockNumber }
  }`;

/** The indexer's progress, asked separately so an indexer without `_meta` still serves the page. */
export const INDEXER_META_QUERY = `query Meta { _meta { progressBlock isReady } }`;

export interface BucketRow {
  period: string;
  start: string;
  premiumCharged: string;
  premiumToVault: string;
  premiumToProtocol: string;
  protocolPaid: string;
  exitDiscount: string;
  exits: number;
  debtRepaid: string;
  savedVsAave: string;
  reprices: number;
  optIns: number;
  deposited: string;
  withdrawn: string;
}

export interface AnalyticsPositionRow {
  borrower: string;
  collateral: string;
  status: "Protected" | "Unprotected" | "OptedOut" | "Exited";
  trigger: number;
  healthFactor: string;
  premiumPerBlock: string;
  premiumPaid: string;
  repriceCount: number;
  optedInAt: string;
}

export interface AnalyticsExitRow extends ExitRow {
  trigger: number;
  discountBps: number;
}

export interface AnalyticsData {
  all: BucketRow[];
  hours: BucketRow[];
  days: BucketRow[];
  ProtocolConfig: { treasury: string | null; protocolShareBps: number; exitDiscountBps: number }[];
  Position: AnalyticsPositionRow[];
  Exit: AnalyticsExitRow[];
  recentReprices: { txHash: string; blockNumber: string }[];
}

export interface IndexerMeta {
  _meta: { progressBlock: number; isReady: boolean }[];
}

/** The `$hourFrom` variable: the start of the oldest hour bucket the 7-day view needs, so it changes once an hour. */
export function hourFrom(nowSec: number): string {
  const currentHour = Math.floor(nowSec / HOUR) * HOUR;
  return String(currentHour - (HOURS_FETCHED - 1) * HOUR);
}

// ------------------------------------------------------------------------------------------------ totals

/** Sums of earnings buckets. Premium fields are 18-decimal USDC units; the rest are 6-decimal USDC units. */
export interface Totals {
  premiumCharged: bigint;
  premiumToVault: bigint;
  premiumToProtocol: bigint;
  protocolPaid: bigint;
  exitDiscount: bigint;
  debtRepaid: bigint;
  savedVsAave: bigint;
  deposited: bigint;
  withdrawn: bigint;
  exits: number;
  reprices: number;
  optIns: number;
}

const BIG_FIELDS = ["premiumCharged", "premiumToVault", "premiumToProtocol", "protocolPaid", "exitDiscount", "debtRepaid", "savedVsAave", "deposited", "withdrawn"] as const;
const COUNT_FIELDS = ["exits", "reprices", "optIns"] as const;

export function emptyTotals(): Totals {
  return {
    premiumCharged: 0n,
    premiumToVault: 0n,
    premiumToProtocol: 0n,
    protocolPaid: 0n,
    exitDiscount: 0n,
    debtRepaid: 0n,
    savedVsAave: 0n,
    deposited: 0n,
    withdrawn: 0n,
    exits: 0,
    reprices: 0,
    optIns: 0,
  };
}

function big(v: string | undefined): bigint {
  try {
    return BigInt(v ?? "0");
  } catch {
    return 0n;
  }
}

export function sumBuckets(rows: readonly BucketRow[]): Totals {
  const t = emptyTotals();
  for (const r of rows) {
    for (const k of BIG_FIELDS) t[k] += big(r[k]);
    for (const k of COUNT_FIELDS) t[k] += Number(r[k]) || 0;
  }
  return t;
}

/**
 * Totals in dollars, for display. Vault income is premiums to the vault plus gross exit discounts; total income adds
 * the share of premiums paid to the treasury directly. All of it goes to the protocol, which holds the vault's shares.
 */
export interface TotalsUsd {
  premiumCharged: number;
  premiumToVault: number;
  premiumToProtocol: number;
  protocolPaid: number;
  exitDiscount: number;
  vaultIncome: number;
  totalIncome: number;
  debtRepaid: number;
  savedVsAave: number;
  deposited: number;
  withdrawn: number;
  exits: number;
  reprices: number;
  optIns: number;
}

export function totalsUsd(t: Totals): TotalsUsd {
  const premiumToVault = toNumber(t.premiumToVault, 18);
  const exitDiscount = toNumber(t.exitDiscount, 6);
  const premiumToProtocol = toNumber(t.premiumToProtocol, 18);
  return {
    premiumCharged: toNumber(t.premiumCharged, 18),
    premiumToVault,
    premiumToProtocol,
    protocolPaid: toNumber(t.protocolPaid, 6),
    exitDiscount,
    vaultIncome: premiumToVault + exitDiscount,
    totalIncome: premiumToVault + exitDiscount + premiumToProtocol,
    debtRepaid: toNumber(t.debtRepaid, 6),
    savedVsAave: toNumber(t.savedVsAave, 6),
    deposited: toNumber(t.deposited, 6),
    withdrawn: toNumber(t.withdrawn, 6),
    exits: t.exits,
    reprices: t.reprices,
    optIns: t.optIns,
  };
}

/** The first bucket start a period counts from: the last 24 or 168 hour buckets, or the last 30 day buckets. */
export function periodFrom(period: Exclude<Period, "all">, nowSec: number): number {
  const hour = Math.floor(nowSec / HOUR) * HOUR;
  const day = Math.floor(nowSec / DAY) * DAY;
  if (period === "24h") return hour - 23 * HOUR;
  if (period === "7d") return hour - (HOURS_FETCHED - 1) * HOUR;
  return day - 29 * DAY;
}

/** A period's totals: hour buckets for 24 hours and 7 days, day buckets for 30 days, the all-time row for all. */
export function periodTotals(data: Pick<AnalyticsData, "all" | "hours" | "days">, period: Period, nowSec: number): Totals {
  if (period === "all") return sumBuckets(data.all.slice(0, 1));
  const from = periodFrom(period, nowSec);
  const rows = periodInfo(period).unit === "hour" ? data.hours : data.days;
  return sumBuckets(rows.filter((r) => Number(r.start) >= from));
}

// ------------------------------------------------------------------------------------------------ chart series

export const SERIES = [
  { key: "vaultPremium", label: "Premiums to the vault" },
  { key: "protocolPremium", label: "Premiums to the treasury" },
  { key: "exitDiscount", label: "Exit discounts to the vault" },
] as const;

export interface Bar {
  /** Bucket start, unix seconds (UTC). */
  start: number;
  /** One value per SERIES entry, in dollars. */
  values: [number, number, number];
}

export interface EarningsSeries {
  unit: "hour" | "day";
  bars: Bar[];
}

function barOf(start: number, row?: BucketRow): Bar {
  return {
    start,
    values: row
      ? [toNumber(big(row.premiumToVault), 18), toNumber(big(row.premiumToProtocol), 18), toNumber(big(row.exitDiscount), 6)]
      : [0, 0, 0],
  };
}

/**
 * One bar per hour or day of the period, oldest first, with empty slots for hours or days without earnings so the
 * time axis is continuous. "All time" runs from the first day bucket to today, and spans at least MIN_ALL_TIME_DAYS.
 */
export function earningsSeries(data: Pick<AnalyticsData, "hours" | "days">, period: Period, nowSec: number): EarningsSeries {
  const unit = periodInfo(period).unit;
  const step = unit === "hour" ? HOUR : DAY;
  const rows = unit === "hour" ? data.hours : data.days;
  const byStart = new Map(rows.map((r) => [Number(r.start), r]));
  const last = Math.floor(nowSec / step) * step;
  let first: number;
  if (period === "all") {
    const starts = rows.map((r) => Number(r.start)).filter((s) => Number.isFinite(s) && s <= last);
    const earliest = starts.length ? Math.min(...starts) : last;
    first = Math.min(earliest, last - (MIN_ALL_TIME_DAYS - 1) * DAY);
  } else {
    first = periodFrom(period, nowSec);
  }
  const bars: Bar[] = [];
  for (let s = first; s <= last; s += step) bars.push(barOf(s, byStart.get(s)));
  return { unit, bars };
}

export function barTotal(b: Bar): number {
  return b.values[0] + b.values[1] + b.values[2];
}

// ------------------------------------------------------------------------------------------------ axis and numbers

/**
 * A y-axis for values from 0 to `max`: a "nice" step (1, 2 or 5 times a power of ten) and the ticks up to the first
 * multiple of the step at or above `max`. Works the same for sub-cent maxima as for thousands.
 */
export function niceTicks(max: number, count = 4): { ticks: number[]; top: number; step: number } {
  if (!(max > 0) || !Number.isFinite(max)) return { ticks: [0, 1], top: 1, step: 1 };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const n = Math.max(1, Math.ceil(max / step - 1e-9));
  const ticks = Array.from({ length: n + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  return { ticks, top: ticks[ticks.length - 1]!, step };
}

/** An axis label: as many decimals as the step needs (at least two below a dollar), none for whole-dollar steps. */
export function axisUsd(value: number, step: number): string {
  if (value === 0) return "$0";
  if (step >= 1) {
    if (Math.abs(value) >= 100_000) return formatUsd(value);
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  const decimals = Math.min(Math.max(2, Math.ceil(-Math.log10(step) - 1e-9)), 10);
  return `$${value.toFixed(decimals)}`;
}

/** A headline dollar figure. Below one cent the headline says "<$0.01" and `exact` carries the figure for a hint. */
export function usdHeadline(value: number): { text: string; exact?: string } {
  if (!Number.isFinite(value)) return { text: "n/a" };
  if (value > 0 && value < 0.01) return { text: "<$0.01", exact: formatUsd(value) };
  return { text: formatUsd(value) };
}

export function median(values: readonly number[]): number | undefined {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1]! + v[mid]!) / 2;
}

/** A cover's rate a year in dollars, from its per-block premium (18 decimals). */
export function ratePerYear(premiumPerBlock: string | bigint): number {
  return toNumber(typeof premiumPerBlock === "bigint" ? premiumPerBlock : big(premiumPerBlock), 18) * BLOCKS_PER_YEAR;
}

/** The protocol's part of a premium charge, rounded down exactly as the Repricer splits it. */
export function protocolCut(charged: bigint, shareBps: number): bigint {
  return (charged * BigInt(Math.max(0, Math.floor(shareBps)))) / 10_000n;
}

// ------------------------------------------------------------------------------------------------ exits and keeper

/** How close to the trigger an exit landed: the trigger, the health factor the exit started from, and the gap. */
export function exitLanding(e: { trigger: number; healthFactorBefore: string }): { trigger: number; hf: number; belowBy: number } {
  const trigger = e.trigger / 1e4;
  const hf = toNumber(big(e.healthFactorBefore), 18);
  return { trigger, hf, belowBy: trigger - hf };
}

export interface RepriceReceipt {
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  /** Repriced events in the transaction: a repriceMany prices several covers in one. */
  reprices: number;
}

/** Average gas and MON per reprice over a few receipts. MON in whole tokens. */
export function repriceCost(receipts: readonly RepriceReceipt[]) {
  const txs = receipts.filter((r) => r.reprices > 0);
  const reprices = txs.reduce((n, r) => n + r.reprices, 0);
  if (!txs.length || !reprices) return undefined;
  const gas = txs.reduce((s, r) => s + r.gasUsed, 0n);
  const wei = txs.reduce((s, r) => s + r.gasUsed * r.effectiveGasPrice, 0n);
  return {
    txs: txs.length,
    reprices,
    gasPerTx: Number(gas) / txs.length,
    gasPerReprice: Number(gas) / reprices,
    monPerReprice: toNumber(wei, 18) / reprices,
    gasPriceGwei: toNumber(wei, 9) / Number(gas),
  };
}

/** The latest distinct transaction hashes in a newest-first list, at most `n`. */
export function latestTxHashes(rows: readonly { txHash: string }[], n: number): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const h = r.txHash.toLowerCase();
    if (!out.includes(h)) out.push(h);
    if (out.length >= n) break;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ live block stream

export const COMMIT_STATES = ["Proposed", "Voted", "Finalized", "Verified"] as const;
export type CommitState = (typeof COMMIT_STATES)[number];

export interface HeadMessage {
  number: number;
  blockId: string;
  commitState: CommitState;
  /** Block timestamp, unix seconds (Monad's are whole seconds). */
  timestamp: number;
}

/** A `monadNewHeads` notification's result, or null for anything else. */
export function parseHead(result: unknown): HeadMessage | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const state = r.commitState;
  if (typeof r.number !== "string" || typeof state !== "string" || !(COMMIT_STATES as readonly string[]).includes(state)) return null;
  const number = Number.parseInt(r.number, 16);
  if (!Number.isFinite(number)) return null;
  const timestamp = typeof r.timestamp === "string" ? Number.parseInt(r.timestamp, 16) : 0;
  return { number, blockId: typeof r.blockId === "string" ? r.blockId : "", commitState: state as CommitState, timestamp };
}

export interface StreamBlock {
  number: number;
  blockId: string;
  /** The furthest commit state seen; null when the block was polled (a local fork has no commit states). */
  state: CommitState | null;
  /** Browser time (ms) each commit state arrived. */
  at: Partial<Record<CommitState, number>>;
  /** Browser time (ms) the block was first seen. */
  seenAt: number;
}

/** Blocks kept in the stream. */
export const STREAM_KEEP = 10;

function stateRank(s: CommitState | null): number {
  return s === null ? -1 : COMMIT_STATES.indexOf(s);
}

/**
 * Folds one `monadNewHeads` message into the newest-first list. A block moves forward through the commit states and
 * never back; a different proposal at the same height replaces a block that was only proposed. Messages for blocks
 * older than the kept window are ignored.
 */
export function applyHead(blocks: readonly StreamBlock[], head: HeadMessage, at: number, keep = STREAM_KEEP): StreamBlock[] {
  const i = blocks.findIndex((b) => b.number === head.number);
  if (i >= 0) {
    const b = blocks[i]!;
    let next: StreamBlock;
    if (b.blockId && head.blockId && b.blockId !== head.blockId) {
      // Another proposal for this height: the later message wins once it is past Proposed, or if ours never was.
      if (stateRank(head.commitState) <= stateRank(b.state) && head.commitState === "Proposed") return blocks as StreamBlock[];
      next = { number: b.number, blockId: head.blockId, state: head.commitState, at: { [head.commitState]: at }, seenAt: b.seenAt };
    } else {
      if (b.at[head.commitState] !== undefined && stateRank(head.commitState) <= stateRank(b.state)) return blocks as StreamBlock[];
      next = {
        ...b,
        blockId: b.blockId || head.blockId,
        state: stateRank(head.commitState) > stateRank(b.state) ? head.commitState : b.state,
        at: { ...b.at, [head.commitState]: b.at[head.commitState] ?? at },
      };
    }
    const out = blocks.slice();
    out[i] = next;
    return out;
  }
  const oldest = blocks.length >= keep ? blocks[blocks.length - 1]!.number : -Infinity;
  if (head.number < oldest) return blocks as StreamBlock[];
  const added: StreamBlock = { number: head.number, blockId: head.blockId, state: head.commitState, at: { [head.commitState]: at }, seenAt: at };
  return [...blocks, added].sort((a, b) => b.number - a.number).slice(0, keep);
}

/** Adds a polled block (a fork, which has no commit states). Blocks skipped between polls are not invented. */
export function applyPolledBlock(blocks: readonly StreamBlock[], number: number, at: number, keep = STREAM_KEEP): StreamBlock[] {
  if (blocks.some((b) => b.number === number)) return blocks as StreamBlock[];
  if (blocks.length >= keep && number < blocks[blocks.length - 1]!.number) return blocks as StreamBlock[];
  return [...blocks, { number, blockId: "", state: null, at: {}, seenAt: at }].sort((a, b) => b.number - a.number).slice(0, keep);
}

/** Proposals remembered for the block-time average: about 20 seconds of Monad blocks. */
export const TIMING_WINDOW = 64;

/**
 * Average milliseconds per block over a window of (block number, arrival) points: the time from the oldest to the
 * newest arrival over the blocks between them. One browser tick can deliver two blocks at once, so single gaps jitter;
 * the average over the window does not. Undefined until the window spans at least `minBlocks`.
 */
export function averageBlockMs(points: readonly { n: number; t: number }[], minBlocks = 5): number | undefined {
  if (points.length < 2) return undefined;
  let first = points[0]!;
  let last = points[0]!;
  for (const p of points) {
    if (p.n < first.n) first = p;
    if (p.n > last.n) last = p;
  }
  const blocks = last.n - first.n;
  if (blocks < minBlocks || !(last.t > first.t)) return undefined;
  return (last.t - first.t) / blocks;
}

/** Keeps the newest `keep` items of a list after adding one. */
export function pushWindow<T>(list: readonly T[], item: T, keep = TIMING_WINDOW): T[] {
  const out = [...list, item];
  return out.length > keep ? out.slice(out.length - keep) : out;
}

// ------------------------------------------------------------------------------------------------ fixed references

/**
 * The one liquidation in Aave V3 Monad's history to 5 Oct 2026, valued at Pyth's last on-chain ETH price before it.
 * Source: docs/TECH-DECISIONS.md, Verified facts (5 Oct 2026): the Pool's LiquidationCall logs and the transaction
 * receipt, and Pyth's PriceFeedUpdate logs on Monad.
 */
export const AAVE_MONAD_LIQUIDATION = {
  block: 98_106_057,
  date: "22 Aug 2026",
  tx: "0xa5ce55310328c30e978a1c778a9cd11f95bf08c8eb4f21affb853d44fcfe7794",
  collateral: "WETH",
  debt: "USDC",
  repaidUsdc: 1670.69,
  wethTaken: 0.7325,
  wethToLiquidator: 0.7287,
  wethToAaveTreasury: 0.0038,
  /** The receipt's exact amounts; the rounded figures above are derived from these. */
  exact: { repaidUsdc: 1670.68619, wethToLiquidator: 0.728710735618030097, wethToAaveTreasury: 0.003818874745973479, wethTaken: 0.732529610364003697 },
  pythEthUsd: 2400.81,
  pythBlock: 98_106_025,
  takenUsd: 1758.66,
  paidAboveDebtUsd: 87.98,
  shieldExitUsd: 16.71,
  differenceUsd: 71.27,
  bonusPct: 5.5,
  shieldDiscountPct: 1,
} as const;

export type LenderStatus = "Live" | "Coming soon";

/**
 * Lending protocols on Monad mainnet by DefiLlama's Monad TVL. Source: docs/TECH-DECISIONS.md, Verified facts
 * (5 Oct 2026), https://api.llama.fi/protocols filtered to chain Monad, category Lending.
 */
export const MONAD_LENDERS: { name: string; initials: string; status: LenderStatus; tvlUsd: number }[] = [
  { name: "Aave V3", initials: "AV", status: "Live", tvlUsd: 324.0e6 },
  { name: "Euler V2", initials: "EU", status: "Coming soon", tvlUsd: 258.6e6 },
  { name: "Morpho Blue", initials: "MB", status: "Coming soon", tvlUsd: 192.7e6 },
  { name: "Curvance", initials: "CU", status: "Coming soon", tvlUsd: 128.7e6 },
  { name: "Neverland", initials: "NE", status: "Coming soon", tvlUsd: 8.5e6 },
];

/** The API the figures were read from (the site's pages sit behind a bot check, so the API is the checkable source). */
export const LENDERS_SOURCE = { name: "DefiLlama", date: "5 Oct 2026", url: "https://api.llama.fi/protocols" };

/** "$324.0M": TVL in millions with one decimal, as DefiLlama rounds it. */
export function formatTvl(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  return `$${(usd / 1e6).toFixed(1)}M`;
}
