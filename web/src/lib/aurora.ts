import { formatUnits, getAddress, isAddress, type Address } from "viem";

/**
 * Aurora Intents (powered by NEAR Intents): USDC from another chain delivered to a Shield deposit address on Monad.
 * The pure parts live here so they are tested: which source assets to offer, the quote request, reading Aurora's
 * answers, and what each status means for the person waiting. Docs: https://docs.intents.aurora.dev/ (API
 * integration, Get swap status, UX recommendations, rate limits), read 13 Oct 2026.
 */

export const AURORA_API = "https://intents-api.aurora.dev/api";
export const AURORA_DOCS = "https://docs.intents.aurora.dev/";
export const AURORA_SUPPORT = "https://aurora.dev/intents-support";

/** Status checks every 6 s: Aurora's rate-limit guide asks for 5 to 10 s, and faster does not settle sooner. */
export const STATUS_POLL_MS = 6_000;
/** The deposit address stays open this long, so there is time to send from another wallet. */
export const QUOTE_DEADLINE_MINUTES = 60;
/** USDC or USDT into USDC: 0.5% is room for a stablecoin route without accepting a bad fill. */
export const QUOTE_SLIPPAGE_BPS = 50;

/**
 * EVM chains offered as a source, in display order, keyed by the `blockchain` code in Aurora's token list. EVM only,
 * so the connected wallet's address is a valid refund address on the source chain.
 */
export const SOURCE_CHAINS: readonly { code: string; name: string }[] = [
  { code: "base", name: "Base" },
  { code: "arb", name: "Arbitrum" },
  { code: "eth", name: "Ethereum" },
  { code: "op", name: "OP Mainnet" },
  { code: "pol", name: "Polygon" },
  { code: "avax", name: "Avalanche" },
  { code: "bsc", name: "BNB Chain" },
  { code: "gnosis", name: "Gnosis" },
  { code: "scroll", name: "Scroll" },
  { code: "xlayer", name: "X Layer" },
  { code: "bera", name: "Berachain" },
  { code: "plasma", name: "Plasma" },
];

/** Stablecoins offered as the source asset, USDC first. */
export const SOURCE_SYMBOLS = ["USDC", "USDT", "USDT0"] as const;

export interface AuroraToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  contractAddress?: string | null;
}

export interface SourceAsset {
  chain: string;
  chainName: string;
  symbol: string;
  assetId: string;
  decimals: number;
  contract: Address;
}

export type FundingKind = "premium" | "vault";

/** Aurora's list answer, as `{ tokens: [...] }` (current) or a bare array (older docs). Bad entries are dropped. */
export function parseTokens(json: unknown): AuroraToken[] {
  const list = Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray((json as { tokens?: unknown }).tokens) ? (json as { tokens: unknown[] }).tokens : [];
  return list.filter((t): t is AuroraToken => {
    const x = t as Partial<AuroraToken> | null;
    return Boolean(x) && typeof x!.assetId === "string" && typeof x!.blockchain === "string" && typeof x!.symbol === "string" && Number.isInteger(x!.decimals);
  });
}

/** Every stablecoin on an offered EVM chain, ordered by chain then symbol. */
export function sourceAssets(tokens: AuroraToken[]): SourceAsset[] {
  const out: SourceAsset[] = [];
  SOURCE_CHAINS.forEach((c) => {
    for (const symbol of SOURCE_SYMBOLS) {
      const t = tokens.find((x) => x.blockchain === c.code && x.symbol === symbol && x.contractAddress && isAddress(x.contractAddress, { strict: false }));
      if (t) out.push({ chain: c.code, chainName: c.name, symbol, assetId: t.assetId, decimals: t.decimals, contract: getAddress(t.contractAddress!.toLowerCase()) });
    }
  });
  return out;
}

/** The chains that have at least one offered asset, in display order. */
export function sourceChains(assets: SourceAsset[]): { code: string; name: string; assets: SourceAsset[] }[] {
  return SOURCE_CHAINS.map((c) => ({ ...c, assets: assets.filter((a) => a.chain === c.code) })).filter((c) => c.assets.length > 0);
}

/** USDC on Monad in Aurora's list: the token whose contract is the USDC Shield takes. */
export function monadUsdc(tokens: AuroraToken[], usdc: Address): AuroraToken | undefined {
  return tokens.find((t) => t.blockchain === "monad" && t.contractAddress?.toLowerCase() === usdc.toLowerCase());
}

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  deadline: string;
}

/**
 * The body of POST /quote/{appKey}: an exact amount of `origin` in, USDC on Monad out to `recipient` (the Shield
 * deposit address), refunds to `refundTo` on the source chain.
 */
export function buildQuoteRequest(input: {
  origin: Pick<SourceAsset, "assetId">;
  destinationAssetId: string;
  amountUnits: bigint;
  recipient: Address;
  refundTo: Address;
  nowMs: number;
  deadlineMinutes?: number;
  slippageBps?: number;
  dry?: boolean;
}): QuoteRequest {
  if (input.amountUnits <= 0n) throw new Error("amount must be positive");
  return {
    dry: input.dry ?? false,
    swapType: "EXACT_INPUT",
    slippageTolerance: input.slippageBps ?? QUOTE_SLIPPAGE_BPS,
    originAsset: input.origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: input.destinationAssetId,
    amount: input.amountUnits.toString(),
    recipient: getAddress(input.recipient),
    recipientType: "DESTINATION_CHAIN",
    refundTo: getAddress(input.refundTo),
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(input.nowMs + (input.deadlineMinutes ?? QUOTE_DEADLINE_MINUTES) * 60_000).toISOString(),
  };
}

/** One accepted quote, as kept in the browser while the transfer runs. */
export interface AuroraTransfer {
  v: 1;
  kind: FundingKind;
  depositAddress: string;
  depositMemo?: string;
  chain: string;
  chainName: string;
  symbol: string;
  decimals: number;
  /** Exact amount to send, in source-token units. */
  amountIn: string;
  /** Expected and least USDC on Monad, in 6-decimal units. */
  amountOut: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate?: number;
  /** The Shield deposit address on Monad. */
  recipient: string;
  refundTo: string;
  createdAt: number;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const units = (v: unknown): string | undefined => (typeof v === "string" && /^\d+$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : undefined);

/** Reads a quote answer into a transfer. Throws when Aurora did not return a deposit address or amounts. */
export function transferFromQuote(json: unknown, ctx: { kind: FundingKind; origin: SourceAsset; recipient: Address; refundTo: Address; nowMs: number }): AuroraTransfer {
  const q = (json as { quote?: Record<string, unknown> } | null)?.quote;
  const depositAddress = str(q?.depositAddress);
  const amountIn = units(q?.amountIn);
  const amountOut = units(q?.amountOut);
  if (!q || !depositAddress || !amountIn || !amountOut) throw new AuroraApiError(200, "Aurora's quote came back without a deposit address. Retry.");
  // Aurora echoes the request: a quote for any other recipient must never be shown.
  const echoed = str((json as { quoteRequest?: { recipient?: unknown } }).quoteRequest?.recipient);
  if (echoed && echoed.toLowerCase() !== ctx.recipient.toLowerCase()) throw new AuroraApiError(200, "Aurora's quote names a different recipient than your deposit address, so it was discarded. Retry.");
  return {
    v: 1,
    kind: ctx.kind,
    depositAddress,
    depositMemo: str(q.depositMemo),
    chain: ctx.origin.chain,
    chainName: ctx.origin.chainName,
    symbol: ctx.origin.symbol,
    decimals: ctx.origin.decimals,
    amountIn,
    amountOut,
    minAmountOut: units(q.minAmountOut) ?? amountOut,
    deadline: str(q.deadline),
    timeWhenInactive: str(q.timeWhenInactive),
    timeEstimate: typeof q.timeEstimate === "number" && Number.isFinite(q.timeEstimate) ? q.timeEstimate : undefined,
    recipient: getAddress(ctx.recipient),
    refundTo: getAddress(ctx.refundTo),
    createdAt: ctx.nowMs,
  };
}

/** Where a transfer is kept between visits: one per deposit kind and owner. */
export function transferKey(kind: FundingKind, owner: string): string {
  return `shield:aurora:${kind}:${owner.toLowerCase()}`;
}

/** A followed transfer is forgotten a day after its quote: by then it has long settled or been refunded. */
export const TRANSFER_KEEP_MS = 24 * 3600_000;

/** A stored transfer, if it is well formed, under a day old and still for this recipient; anything else is ignored. */
export function parseStoredTransfer(raw: string | null | undefined, recipient: string | undefined, nowMs: number): AuroraTransfer | undefined {
  if (!raw) return undefined;
  try {
    const t = JSON.parse(raw) as Partial<AuroraTransfer>;
    if (t.v !== 1 || !str(t.depositAddress) || !str(t.chain) || !units(t.amountIn) || !units(t.amountOut) || typeof t.decimals !== "number") return undefined;
    if (typeof t.createdAt !== "number" || nowMs - t.createdAt > TRANSFER_KEEP_MS) return undefined;
    if (typeof t.recipient !== "string" || (recipient !== undefined && t.recipient.toLowerCase() !== recipient.toLowerCase())) return undefined;
    return t as AuroraTransfer;
  } catch {
    return undefined;
  }
}

/** When Aurora stops accepting a deposit for this quote, in ms; undefined if it did not say. */
export function closesAt(t: Pick<AuroraTransfer, "deadline" | "timeWhenInactive">): number | undefined {
  const ms = Date.parse(t.timeWhenInactive ?? t.deadline ?? "");
  return Number.isFinite(ms) ? ms : undefined;
}

// ------------------------------------------------------------------------------------------------ status

export const STATUSES = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;
export type AuroraStatus = (typeof STATUSES)[number];

export interface ChainTx {
  hash: string;
  explorerUrl?: string;
}

export interface StatusReport {
  status: AuroraStatus | "UNKNOWN";
  /** Aurora's word for it, kept for an unknown status. */
  raw: string;
  originTxs: ChainTx[];
  destinationTxs: ChainTx[];
  amountOut?: string;
  depositedAmountFormatted?: string;
  refundedAmountFormatted?: string;
  refundReason?: string;
}

/** An explorer link from Aurora's answer is used as an href, so only an https URL is kept. */
const httpsUrl = (v: unknown): string | undefined => (typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v) ? v : undefined);

/** Hashes come as `{ hash, explorerUrl }` from the status call and as plain strings from the history call. */
function txList(v: unknown): ChainTx[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x): ChainTx | undefined => (typeof x === "string" ? { hash: x } : x && typeof x === "object" && typeof (x as ChainTx).hash === "string" ? { hash: (x as ChainTx).hash, explorerUrl: httpsUrl((x as ChainTx).explorerUrl) } : undefined))
    .filter((x): x is ChainTx => Boolean(x));
}

/** Reads GET /status/{appKey}?depositAddress=... */
export function parseStatus(json: unknown): StatusReport {
  const j = (json ?? {}) as { status?: unknown; swapDetails?: Record<string, unknown> };
  const raw = typeof j.status === "string" ? j.status : "";
  const d = j.swapDetails ?? {};
  return {
    status: (STATUSES as readonly string[]).includes(raw) ? (raw as AuroraStatus) : "UNKNOWN",
    raw,
    originTxs: txList(d.originChainTxHashes),
    destinationTxs: txList(d.destinationChainTxHashes),
    amountOut: units(d.amountOut),
    depositedAmountFormatted: str(d.depositedAmountFormatted),
    refundedAmountFormatted: str(d.refundedAmountFormatted),
    refundReason: str(d.refundReason),
  };
}

export const isTerminal = (s: StatusReport["status"] | undefined) => s === "SUCCESS" || s === "REFUNDED" || s === "FAILED";

/** The steps of the status strip; the last one names where the USDC ends up. */
export function transferSteps(kind: FundingKind, chainName: string): string[] {
  return [`Waiting for your deposit on ${chainName}`, "Deposit seen", "Sending to Monad", "Delivered on Monad", kind === "premium" ? "In your premium" : "In the vault"];
}

export interface StageView {
  /** Index of the current step in `transferSteps`; steps before it are done. 5 means every step is done. */
  step: number;
  /** "action": nothing moves until a sweep runs (the keeper's or this page's button). */
  tone: "progress" | "action" | "done" | "caution" | "danger";
  title: string;
  body: string;
  /** No more status checks are needed. */
  final: boolean;
}

/**
 * What the person waiting should read, from Aurora's status and what sits at the deposit address on Monad. Delivery
 * lands at the deposit address; it becomes premium (or vault assets) when it is swept, by the keeper or by the button.
 */
export function transferStage(input: {
  transfer: Pick<AuroraTransfer, "kind" | "chainName" | "symbol" | "decimals" | "amountIn" | "amountOut" | "refundTo">;
  report?: StatusReport;
  /** The quote's deposit window has closed. */
  expired: boolean;
  /** USDC (6-decimal units) waiting at the Shield deposit address on Monad now. */
  waitingUnits: bigint;
  closeText?: string;
}): StageView {
  const { transfer: t, report, expired, waitingUnits } = input;
  const send = `${formatExact(BigInt(t.amountIn), t.decimals)} ${t.symbol}`;
  // A word joiner after the ellipsis keeps the short address on one line.
  const refund = `${t.refundTo.slice(0, 6)}…\u2060${t.refundTo.slice(-4)}`;
  const delivered = formatDown(BigInt(report?.amountOut ?? t.amountOut), 6);
  const where = t.kind === "premium" ? "your prepaid premium" : "the vault, for the treasury";
  switch (report?.status) {
    case undefined:
      return { step: 0, tone: "progress", title: "Checking with Aurora", body: "Asking Aurora for this transfer's status.", final: false };
    case "PENDING_DEPOSIT":
      return expired
        ? {
            step: 0,
            tone: "caution",
            title: "This deposit address has closed",
            body: `Aurora saw no deposit before it closed. Do not send to it now: a late deposit is refunded to ${refund} on ${t.chainName}, not delivered. Get a new deposit address.`,
            final: true,
          }
        : {
            step: 0,
            tone: "progress",
            title: `Waiting for ${send} on ${t.chainName}`,
            body: `Send it to the deposit address above${input.closeText ? ` before ${input.closeText}` : ""}. This page follows it from here.`,
            final: false,
          };
    case "KNOWN_DEPOSIT_TX":
      return { step: 1, tone: "progress", title: `Deposit seen on ${t.chainName}`, body: "Aurora sees your transfer and is waiting for it to confirm.", final: false };
    case "INCOMPLETE_DEPOSIT":
      return {
        step: 1,
        tone: "caution",
        title: "The deposit is below the quoted amount",
        body: `Aurora received ${report.depositedAmountFormatted ? `${report.depositedAmountFormatted} ${t.symbol}` : "less than quoted"}, short of ${send}. Send the difference to the same address${input.closeText ? ` before ${input.closeText}` : ""}, or Aurora refunds what arrived to ${refund} on ${t.chainName}.`,
        final: false,
      };
    case "PROCESSING":
      return { step: 2, tone: "progress", title: "Sending to Monad", body: "The deposit has arrived. Aurora is swapping it and delivering USDC to your deposit address on Monad.", final: false };
    case "SUCCESS":
      return waitingUnits > 0n
        ? {
            step: 4,
            tone: "action",
            title: `Delivered ${delivered} USDC on Monad`,
            body: `It is at your deposit address. Move it into ${where} now, or Shield's keeper moves it on its own.`,
            final: true,
          }
        : { step: 5, tone: "done", title: `${delivered} USDC is in ${where}`, body: "Aurora delivered it to your deposit address on Monad and it has been moved in.", final: true };
    case "REFUNDED":
      return {
        step: 2,
        tone: "caution",
        title: `Refunded on ${t.chainName}`,
        body: `Aurora returned ${report.refundedAmountFormatted ? `${report.refundedAmountFormatted} ${t.symbol}` : "the deposit"} to ${refund} on ${t.chainName}${report.refundReason ? ` (${report.refundReason.replace(/[.\s]+$/, "")})` : ""}. Nothing reached Monad. Get a new deposit address to try again.`,
        final: true,
      };
    case "FAILED":
      return {
        step: 2,
        tone: "danger",
        title: "The transfer failed at Aurora",
        body: `Nothing reached Monad. If your deposit left your wallet, Aurora refunds it to ${refund} on ${t.chainName}. If it does not arrive, report it to Aurora support with the deposit address and your transaction hash.`,
        final: true,
      };
    default:
      return { step: 1, tone: "progress", title: `Aurora reports ${report?.raw || "an unknown status"}`, body: "This page keeps checking.", final: false };
  }
}

// ------------------------------------------------------------------------------------------------ API errors

export class AuroraApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Seconds to wait before the next request, from Retry-After on a 429. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "AuroraApiError";
  }
}

/** One sentence for an Aurora API failure, naming what to do. */
export function auroraErrorMessage(status: number, body: unknown, retryAfter?: number): string {
  const message = str((body as { message?: unknown } | null)?.message)?.replace(/[.\s]+$/, "");
  if (status === 404) return "Aurora did not recognise this site's app key, so it cannot quote. Sending USDC on Monad to the deposit address still works.";
  if (status === 429) return `Aurora is limiting requests from this site. Retry in ${Math.max(1, Math.ceil(retryAfter ?? 10))} seconds.`;
  if (status === 400) return message ? `Aurora could not quote this: ${message}.` : "Aurora could not quote this amount. Change it and retry.";
  if (status >= 500) return "Aurora could not answer right now. Retry in a moment.";
  return message ? `Aurora answered: ${message}.` : `Aurora answered with an error (${status}). Retry.`;
}

/** Calls Aurora's API and returns the JSON, or throws an AuroraApiError with a sentence to show. */
export async function auroraFetch(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetcher(`${AURORA_API}${path}`, { ...init, headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  } catch {
    throw new AuroraApiError(0, "Aurora's API did not answer. Check your connection and retry.");
  }
  let body: unknown = undefined;
  try {
    body = await res.json();
  } catch {
    // An empty or non-JSON body: the status code says enough.
  }
  if (!res.ok) {
    const retry = Number(res.headers.get("Retry-After"));
    const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : undefined;
    throw new AuroraApiError(res.status, auroraErrorMessage(res.status, body, retryAfter), retryAfter);
  }
  return body;
}

export const tokensPath = (appKey: string) => `/tokens/${encodeURIComponent(appKey)}`;
export const quotePath = (appKey: string) => `/quote/${encodeURIComponent(appKey)}`;
export const statusPath = (appKey: string, depositAddress: string, memo?: string) =>
  `/status/${encodeURIComponent(appKey)}?depositAddress=${encodeURIComponent(depositAddress)}${memo ? `&depositMemo=${encodeURIComponent(memo)}` : ""}`;

// ------------------------------------------------------------------------------------------------ amounts

/** An amount to two decimals, rounded down, so "at least" is never overstated ("24.867537" is "24.86"). */
export function formatDown(value: bigint, decimals: number, places = 2): string {
  const step = 10n ** BigInt(Math.max(decimals - places, 0));
  return formatExact((value / step) * step, decimals);
}

/**
 * An exact token amount for "send exactly": never rounded, thousands grouped, at least two decimals ("25.00",
 * "1,234.567891"), trailing zeros beyond two dropped.
 */
export function formatExact(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const [whole = "0", frac = ""] = formatUnits(neg ? -value : value, decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${neg ? "-" : ""}${grouped}.${f}`;
}
