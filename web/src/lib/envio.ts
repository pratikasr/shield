import { envioUrl } from "./env";

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
