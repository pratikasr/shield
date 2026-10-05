import { cn } from "@/lib/utils";

/** Token logos served from /public/tokens (the SVGs Aave's own app uses). */
const ICONS: Record<string, string> = {
  USDC: "/tokens/usdc.svg",
  WETH: "/tokens/eth.svg",
  ETH: "/tokens/eth.svg",
  cbBTC: "/tokens/cbbtc.svg",
  CBBTC: "/tokens/cbbtc.svg",
  MON: "/tokens/mon.svg",
  WMON: "/tokens/mon.svg",
  AAVE: "/tokens/aave.svg",
  PYTH: "/tokens/pyth.png",
};

export function TokenIcon({ symbol, size = 24, className, ring }: { symbol: string; size?: number; className?: string; ring?: boolean }) {
  const src = ICONS[symbol] ?? ICONS[symbol.toUpperCase()];
  if (!src) {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-[0.625rem] font-semibold text-muted-foreground", className)}
        style={{ width: size, height: size }}
        aria-hidden
      >
        {symbol.slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs; next/image adds nothing here
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={cn("shrink-0 rounded-full", ring && "ring-2 ring-card", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Two overlapping icons, e.g. collateral over debt, or Aave over Monad. */
export function TokenPair({ a, b, size = 22, className }: { a: string; b: string; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)} aria-hidden>
      <TokenIcon symbol={a} size={size} ring />
      <TokenIcon symbol={b} size={size} ring className="-ml-1.5" />
    </span>
  );
}

/** Icon, amount and symbol on one line, the way every lending app lists a balance. */
export function TokenAmount({ symbol, amount, sub, size = 28 }: { symbol: string; amount: React.ReactNode; sub?: React.ReactNode; size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <TokenIcon symbol={symbol} size={size} />
      <span className="min-w-0">
        <span className="block truncate font-medium num">{amount}</span>
        {sub && <span className="block truncate text-[0.8125rem] text-muted-foreground num">{sub}</span>}
      </span>
    </span>
  );
}
