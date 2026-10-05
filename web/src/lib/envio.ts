import { envioUrl } from "./env";
import { toNumber } from "./format";

/** Why history is missing, as the end of the sentence "History unavailable: ...". Never a raw "Failed to fetch". */
export class IndexerError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "IndexerError";
  }
}

/** History from the Envio indexer's GraphQL endpoint (ADR-004, ADR-005). */
export async function envioQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!envioUrl) throw new IndexerError("the indexer endpoint is not configured (NEXT_PUBLIC_ENVIO_GRAPHQL_URL)");
  let res: Response;
  try {
    res = await fetch(envioUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new IndexerError("the indexer did not answer");
  }
  if (!res.ok) throw new IndexerError(`the indexer answered with HTTP ${res.status}`);
  let body: { data?: T; errors?: { message: string }[] };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new IndexerError("the indexer sent an answer the app could not read");
  }
  if (body.errors?.length || !body.data) throw new IndexerError("the indexer rejected the query");
  return body.data;
}

/** "History unavailable: the indexer did not answer." for any history error. */
export function historyError(error: unknown): string {
  const reason = error instanceof IndexerError ? error.message : "the indexer did not answer";
  return `History unavailable: ${reason}.`;
}

export interface PositionRow {
  borrower: string;
  premiumPerBlock?: string;
  status: "Protected" | "Unprotected" | "OptedOut" | "Exited";
  trigger: number;
  repriceCount: number;
  premiumPaid: string;
  optedInTx: string;
  optedInAt: string;
}

export interface RepriceRow {
  blockNumber: string;
  timestamp: string;
  charged: string;
  premiumPerBlock: string;
  healthFactor: string;
  sigma: string;
  txHash: string;
}

export interface ExitRow {
  borrower: string;
  collateral?: string;
  repaid: string;
  seized: string;
  savedVsAave: string;
  healthFactorBefore: string;
  healthFactorAfter: string;
  flashLoanAmount: string;
  blockNumber: string;
  timestamp: string;
  txHash: string;
}

export interface VaultFlowRow {
  kind: "Deposit" | "Withdraw" | "Premium" | "ExitFunded" | "CollateralReceived" | "Unwound";
  account: string | null;
  assets: string;
  collateral: string | null;
  collateralAmount: string;
  blockNumber: string;
  timestamp: string;
  txHash: string;
}

const EXIT_FIELDS = "borrower collateral repaid seized savedVsAave healthFactorBefore healthFactorAfter flashLoanAmount blockNumber timestamp txHash";

export const BORROWER_HISTORY = `
  query Borrower($borrower: String!) {
    Position(where: { borrower: { _eq: $borrower } }) {
      borrower status trigger repriceCount premiumPaid optedInTx optedInAt
    }
    Reprice(where: { borrower: { _eq: $borrower } }, order_by: { blockNumber: desc }, limit: 60) {
      blockNumber timestamp charged premiumPerBlock healthFactor sigma txHash
    }
    Exit(where: { borrower: { _eq: $borrower } }, order_by: { blockNumber: desc }) {
      ${EXIT_FIELDS}
    }
  }`;

/** Reprices a borrower's health-factor chart loads, newest first: about 2.5 minutes of every-block repricing. */
export const CHART_REPRICE_LIMIT = 500;

export interface ChartRepriceRow {
  blockNumber: string;
  logIndex: number;
  timestamp: string;
  healthFactor: string;
  charged: string;
}

export interface ChartExitRow {
  blockNumber: string;
  timestamp: string;
  healthFactorBefore: string;
  healthFactorAfter: string;
  /** HF x 1e4 when the exit ran. */
  trigger: number;
  savedVsAave: string;
  txHash: string;
}

export interface BorrowerChart {
  Reprice: ChartRepriceRow[];
  Exit: ChartExitRow[];
  /** premiumPaid is the borrower's total over every cover, 18-decimal USDC units; optedInAt is the latest opt-in. */
  Position: { premiumPaid: string; repriceCount: number; optedInAt: string }[];
}

/** A borrower's latest reprices (health factor and premium charged), every exit, and the premium paid in total. */
export const BORROWER_CHART = `
  query BorrowerChart($borrower: String!) {
    Reprice(where: { borrower: { _eq: $borrower } }, order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: ${CHART_REPRICE_LIMIT}) {
      blockNumber logIndex timestamp healthFactor charged
    }
    Exit(where: { borrower: { _eq: $borrower } }, order_by: { blockNumber: desc }) {
      blockNumber timestamp healthFactorBefore healthFactorAfter trigger savedVsAave txHash
    }
    Position(where: { borrower: { _eq: $borrower } }) { premiumPaid repriceCount optedInAt }
  }`;

/** More than this between two readings and the chart's line is dashed: no reprice was recorded in between. */
export const GAP_SECONDS = 300;

/** One reading on a borrower's health-factor chart. */
export interface HfPoint {
  /** Unix seconds. */
  t: number;
  block: number;
  hf: number;
  /** Premium paid across every cover once this reprice was charged, in USD; undefined for exits and the live reading. */
  cum?: number;
  /** What this reprice charged, in USD. */
  charged?: number;
  kind: "reprice" | "exitBefore" | "exit" | "live";
  exit?: ChartExitRow;
  gapBefore?: boolean;
}

/** Aave reports type(uint256).max with no debt: no health factor to plot. */
const plottable = (hf: number) => Number.isFinite(hf) && hf < 1e9;

/**
 * A borrower's chart series, oldest first: each reprice's health factor and the premium paid once it was charged
 * (counted back from the indexer's total), each exit as the reading before it and the one after, and, while a cover is
 * active, the live reading `live`. When the reprice list was cut at the limit, exits older than the first loaded
 * reprice are left out, so a dashed gap never claims "no reprice" over reprices that were only not loaded.
 */
export function buildHfSeries(data: BorrowerChart | undefined, live?: { hf: number; t: number }): { points: HfPoint[]; truncated: boolean; droppedExits: number } {
  if (!data) return { points: [], truncated: false, droppedExits: 0 };
  const desc = data.Reprice;
  const repriceCount = data.Position[0]?.repriceCount ?? desc.length;
  const truncated = desc.length >= CHART_REPRICE_LIMIT && repriceCount > desc.length;
  const total = data.Position[0] ? toNumber(BigInt(data.Position[0].premiumPaid), 18) : desc.reduce((s, r) => s + toNumber(BigInt(r.charged), 18), 0);

  let cum = total;
  const reprices: HfPoint[] = desc
    .map((r) => {
      const charged = toNumber(BigInt(r.charged), 18);
      const p: HfPoint = { t: Number(r.timestamp), block: Number(r.blockNumber), hf: toNumber(BigInt(r.healthFactor), 18), cum: Math.max(cum, 0), charged, kind: "reprice" };
      cum -= charged;
      return p;
    })
    .reverse();
  const firstBlock = reprices[0]?.block ?? Number.POSITIVE_INFINITY;
  const kept = data.Exit.filter((e) => !truncated || Number(e.blockNumber) >= firstBlock);
  const exits: HfPoint[] = kept.flatMap((e) => {
    const block = Number(e.blockNumber);
    const t = Number(e.timestamp);
    // The exit transaction's own reprice already carries the reading before it.
    const before: HfPoint[] = reprices.some((r) => r.block === block) ? [] : [{ t, block, hf: toNumber(BigInt(e.healthFactorBefore), 18), kind: "exitBefore", exit: e }];
    return [...before, { t, block, hf: toNumber(BigInt(e.healthFactorAfter), 18), kind: "exit" as const, exit: e }];
  });
  const order = { reprice: 0, exitBefore: 1, exit: 2, live: 3 } as const;
  const points = [...reprices, ...exits].filter((p) => plottable(p.hf)).sort((a, b) => a.block - b.block || order[a.kind] - order[b.kind]);
  points.forEach((p, i) => {
    if (i > 0 && p.kind !== "exit") p.gapBefore = p.t - points[i - 1]!.t > GAP_SECONDS;
  });
  return { points: withLive(points, live), truncated, droppedExits: data.Exit.length - kept.length };
}

/**
 * The recorded readings plus the live one at the end, when it is plottable. The live reading is "now", so a clock that
 * lags the last recording puts it at that recording's time rather than before it. Kept apart from buildHfSeries so
 * the indexed rows are parsed once per query result, not once per block.
 */
export function withLive(points: HfPoint[], live?: { hf: number; t: number }): HfPoint[] {
  const last = points.at(-1);
  if (!live || !plottable(live.hf)) return points;
  const t = last ? Math.max(live.t, last.t) : live.t;
  return [...points, { t, block: Number.NaN, hf: live.hf, kind: "live", gapBefore: last !== undefined && t - last.t > GAP_SECONDS }];
}

/**
 * Platform earnings since deployment (ADR-038). Premium fields are 18-decimal USDC units as charged; exitDiscount,
 * debtRepaid, savedVsAave and protocolPaid are USDC units (6 decimals).
 */
export interface EarningsAll {
  premiumCharged: string;
  premiumToVault: string;
  premiumToProtocol: string;
  protocolPaid: string;
  exitDiscount: string;
  exits: number;
  debtRepaid: string;
  savedVsAave: string;
  reprices: number;
}

export const EARNINGS_ALL = `
  query EarningsAll {
    EarningsBucket(where: { id: { _eq: "all" } }) {
      premiumCharged premiumToVault premiumToProtocol protocolPaid exitDiscount exits debtRepaid savedVsAave reprices
    }
  }`;

/** Enough Protected rows to sum the vault's premium rate; the UI says "at least" if the cap is reached. */
export const PROTECTED_RATE_LIMIT = 1000;

export const VAULT_HISTORY = `
  query Vault {
    VaultStats(where: { id: { _eq: "vault" } }) {
      deposited withdrawn premiumEarned exitsExecuted exitFunding collateralValueReceived depositors
    }
    Exit(order_by: { blockNumber: desc }, limit: 20) {
      ${EXIT_FIELDS}
    }
    flashExits: Exit(where: { flashLoanAmount: { _gt: "0" } }, limit: 1) { txHash }
    Position(where: { status: { _in: ["Protected", "Unprotected"] } }, order_by: { optedInAt: desc }, limit: 50) {
      borrower status trigger repriceCount premiumPaid premiumPerBlock optedInTx optedInAt
    }
    protectedRates: Position(where: { status: { _eq: "Protected" } }, limit: ${PROTECTED_RATE_LIMIT}) { premiumPerBlock }
    everCovered: Position(limit: 1) { borrower }
    VaultFlow(order_by: { blockNumber: desc }, limit: 30) {
      kind account assets collateral collateralAmount blockNumber timestamp txHash
    }
  }`;
