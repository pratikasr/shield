import type { Metadata } from "next";
import { VaultView } from "@/components/vault/vault-view";

export const metadata: Metadata = {
  title: "Vault",
  description: "Shield's vault: the protocol's own pot that pays for every rescue and earns from them.",
};

export default function VaultPage() {
  return <VaultView />;
}
