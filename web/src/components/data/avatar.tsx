import { cn } from "@/lib/utils";

/** A deterministic two-colour avatar for an address, so a wallet is recognisable at a glance. */
export function AddressAvatar({ address, size = 20, className }: { address: string; size?: number; className?: string }) {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(12, "0");
  const h1 = parseInt(hex.slice(0, 4), 16) % 360;
  const h2 = (h1 + 40 + (parseInt(hex.slice(4, 6), 16) % 80)) % 360;
  const angle = parseInt(hex.slice(6, 8), 16) % 360;
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(${angle}deg, hsl(${h1} 70% 55%), hsl(${h2} 75% 45%))`,
      }}
    />
  );
}
