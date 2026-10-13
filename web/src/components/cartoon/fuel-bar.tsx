import { cx as cn } from "./cx";

/**
 * Prepaid balance as a ten-cell fuel gauge. `level` is 0 to 1. Low turns the cells yellow and can blink three times;
 * out greys them. The label is the accessible name and the line beside it ("Paid up for about 3 months").
 */
export function FuelBar({ level, tone = "ok", blink, label, className }: { level: number; tone?: "ok" | "low" | "out"; blink?: boolean; label: string; className?: string }) {
  const cells = tone === "out" ? 0 : Math.max(level > 0 ? 1 : 0, Math.min(10, Math.round(level * 10)));
  return (
    <div className={cn("c-fuel", className)}>
      <div className="c-fuel-bar" role="img" aria-label={label} data-tone={tone === "ok" ? undefined : tone} data-blink={blink || undefined}>
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} data-empty={i >= cells || undefined} />
        ))}
      </div>
      <b className="c-small" aria-hidden>
        {label}
      </b>
    </div>
  );
}
