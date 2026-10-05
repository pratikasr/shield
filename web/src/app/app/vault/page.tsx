import type { Metadata } from "next";
import { VaultView } from "@/components/vault/vault-view";

export const metadata: Metadata = { title: "Provide liquidity" };

export default function VaultPage() {
  return <VaultView />;
}
