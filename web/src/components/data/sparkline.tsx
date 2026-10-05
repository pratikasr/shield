import { cn } from "@/lib/utils";

/** A small area line of recent values, oldest first, in the current text colour. Decorative; the number beside it carries the meaning. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) return <svg className={cn("h-6 w-24", className)} aria-hidden />;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || Math.abs(max) || 1;
  const pts = v.map((n, i) => `${((i / (v.length - 1)) * 100).toFixed(2)},${(22 - ((n - min) / span) * 19).toFixed(2)}`);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={cn("h-6 w-24 overflow-visible text-brand", className)} aria-hidden>
      <polygon points={`0,24 ${pts.join(" ")} 100,24`} fill="currentColor" opacity={0.1} />
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
