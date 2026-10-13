import type { Metadata } from "next";
import { cookies } from "next/headers";
import { BorrowView } from "@/components/borrow/borrow-view";
import { TestLoanCard } from "@/components/borrow/test-loan";
import { WALLET_COOKIE } from "@/lib/wallet-cookie";

export const metadata: Metadata = { title: "Protect a position" };

/**
 * Rendered per request so the first paint is already the right state: a `?address=` link opens read only, a first
 * visit sees the connect prompt without waiting for scripts, and a returning wallet sees a skeleton while it reconnects.
 */
export default async function BorrowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, jar] = await Promise.all([searchParams, cookies()]);
  const address = typeof params.address === "string" ? params.address : "";
  return (
    <>
      <BorrowView key={address} initialWatch={address} walletHint={jar.has(WALLET_COOKIE)} />
      {/* Testnet staging builds only (ADR-040): open and move a test loan; hidden while viewing another wallet. */}
      <TestLoanCard hidden={Boolean(address)} />
    </>
  );
}
