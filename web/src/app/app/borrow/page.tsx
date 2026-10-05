import type { Metadata } from "next";
import { cookies } from "next/headers";
import { BorrowView } from "@/components/borrow/borrow-view";
import { WALLET_COOKIE } from "@/lib/wallet-cookie";

export const metadata: Metadata = { title: "Protect a position" };

/**
 * Rendered per request so the first paint is already the right state: a `?address=` link opens read only, a first
 * visit sees the connect prompt without waiting for scripts, and a returning wallet sees a skeleton while it reconnects.
 */
export default async function BorrowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, jar] = await Promise.all([searchParams, cookies()]);
  const address = typeof params.address === "string" ? params.address : "";
  return <BorrowView initialWatch={address} walletHint={jar.has(WALLET_COOKIE)} />;
}
