import { cn } from "@/lib/utils";

/** A small line of recent values, oldest first. Decorative; the number beside it carries the meaning. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length < 2) return <svg className={cn("h-6 w-24", className)} aria-hidden />;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || Math.abs(max) || 1;
  const pts = v.map((n, i) => `${(i / (v.length - 1)) * 100},${22 - ((n - min) / span) * 20}`).join(" ");
  const last = pts.split(" ").at(-1)!.split(",");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={cn("h-6 w-24 overflow-visible", className)} aria-hidden>
      <polyline points={pts} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={2.5} className="fill-foreground" />
    </svg>
  );
}
