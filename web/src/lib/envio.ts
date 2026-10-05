import { envioUrl } from "./env";

/** History from the Envio indexer's GraphQL endpoint (ADR-004, ADR-005). */
export async function envioQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!envioUrl) throw new Error("Indexer endpoint not configured: set NEXT_PUBLIC_ENVIO_GRAPHQL_URL.");
  const res = await fetch(envioUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Indexer returned HTTP ${res.status}. Check NEXT_PUBLIC_ENVIO_GRAPHQL_URL.`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`Indexer query failed: ${body.errors[0]!.message}`);
  return body.data as T;
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
  collateralAmount: string;
  blockNumber: string;
  timestamp: string;
  txHash: string;
}

export const BORROWER_HISTORY = `
  query Borrower($borrower: String!) {
    Position(where: { borrower: { _eq: $borrower } }) {
      borrower status trigger repriceCount premiumPaid optedInTx optedInAt
    }
    Reprice(where: { borrower: { _eq: $borrower } }, order_by: { blockNumber: desc }, limit: 60) {
      blockNumber timestamp charged premiumPerBlock healthFactor sigma txHash
    }
    Exit(where: { borrower: { _eq: $borrower } }, order_by: { blockNumber: desc }) {
      borrower repaid seized savedVsAave healthFactorBefore healthFactorAfter flashLoanAmount blockNumber timestamp txHash
    }
  }`;

export const VAULT_HISTORY = `
  query Vault {
    VaultStats(where: { id: { _eq: "vault" } }) {
      deposited withdrawn premiumEarned exitsExecuted exitFunding collateralValueReceived depositors
    }
    Exit(order_by: { blockNumber: desc }, limit: 20) {
      borrower repaid seized savedVsAave healthFactorBefore healthFactorAfter flashLoanAmount blockNumber timestamp txHash
    }
    Position(where: { status: { _in: ["Protected", "Unprotected"] } }, order_by: { optedInAt: desc }, limit: 50) {
      borrower status trigger repriceCount premiumPaid premiumPerBlock optedInTx optedInAt
    }
    VaultFlow(order_by: { blockNumber: desc }, limit: 30) {
      kind account assets collateralAmount blockNumber timestamp txHash
    }
  }`;
