/**
 * The testnet staging build (ADR-040) runs on an Aave V3 market that Aave's own app does not list, so loans there are
 * opened and moved with the Test loan card on the Protect page (components/borrow/test-loan.tsx). On by
 * NEXT_PUBLIC_CHAIN_ID=10143, or NEXT_PUBLIC_TEST_LOAN=1 on a local fork for tests; never on a mainnet build.
 */
export const testLoanEnabled = process.env.NEXT_PUBLIC_CHAIN_ID === "10143" || process.env.NEXT_PUBLIC_TEST_LOAN === "1";

/** The card's anchor. */
export const TEST_LOAN_ID = "test-loan";

/** Where an "Open Aave" button goes: Aave's app, or on testnet the Test loan card further down the page. */
export function aaveLink(appUrl: string): { href: string; target?: string; rel?: string } {
  return testLoanEnabled ? { href: `#${TEST_LOAN_ID}` } : { href: appUrl, target: "_blank", rel: "noreferrer" };
}

/** The button's words: unchanged on mainnet, "Go to the test loan" on testnet. */
export function aaveButtonText(text: string): string {
  return testLoanEnabled ? "Go to the test loan" : text;
}

/**
 * USDC (6 decimals) to borrow so Aave's health factor lands on `targetBps`, from getUserAccountData (collateral and
 * debt in Aave's 8-decimal base currency, the liquidation threshold in bps) and the oracle's USDC price (8 decimals).
 * The same sum as contracts/testnet/TestnetDemo.s.sol. 0 when the loan is already at or below the target.
 */
export function borrowForTarget(collateralBase: bigint, debtBase: bigint, ltBps: bigint, usdcPrice: bigint, targetBps: bigint): bigint {
  if (targetBps <= 0n || usdcPrice <= 0n) return 0n;
  const targetDebt = (collateralBase * ltBps) / targetBps;
  return targetDebt > debtBase ? ((targetDebt - debtBase) * 1_000_000n) / usdcPrice : 0n;
}
