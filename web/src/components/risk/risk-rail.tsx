"use client";

import { cn } from "@/lib/utils";

export interface RiskRailProps {
  /** Aave health factor now; Infinity when there is no debt. */
  healthFactor: number;
  /** Exit trigger (HF), or undefined when no cover is set. */
  trigger?: number;
  /** HF an exit restores the position to (trigger + 0.06). */
  exitTarget?: number;
  /** Recent HF readings, oldest first, drawn as a faint trail. */
  trail?: number[];
  /** Whether the trigger is armed (cover active and paid for). */
  armed?: boolean;
  className?: string;
  compact?: boolean;
  /** Hide the legend under the gauge (when the surrounding panel already explains the marks). */
  hideLegend?: boolean;
}

const LIQUIDATION = 1;

/** Where a reading sits on the gauge, 0..1. The scale starts just under 1.00 and ends where every mark fits. */
function scaleFor(values: number[]) {
  const finite = values.filter((v) => Number.isFinite(v));
  const top = Math.max(1.25, ...finite.map((v) => v + 0.06));
  const ceiling = Math.min(Math.ceil(top * 20) / 20, 3);
  const floor = 0.95;
  const span = ceiling - floor;
  const step = span <= 0.45 ? 0.05 : span <= 1 ? 0.1 : 0.25;
  const ticks: number[] = [];
  for (let t = 1; t <= ceiling + 1e-9; t += step) ticks.push(Number(t.toFixed(2)));
  return { floor, ceiling, ticks, at: (v: number) => (Math.min(Math.max(v, floor), ceiling) - floor) / span };
}

/**
 * Health-factor colour, the same bands Aave's own app uses (red below 1.1, amber below 3, green from 3), so a
 * reading means the same thing here as on app.aave.com.
 */
export function hfTone(hf: number): "safe" | "caution" | "danger" {
  if (!Number.isFinite(hf)) return "safe";
  const floored = Math.floor(hf * 100) / 100;
  if (floored < 1.1) return "danger";
  if (floored < 3) return "caution";
  return "safe";
}

const pct = (p: number) => `${(p * 100).toFixed(3)}%`;

/**
 * The health-factor gauge: Aave's liquidation line at 1.00, the borrower's trigger above it, where an exit
 * restores HF to, and the live reading that moves with every block.
 */
export function RiskRail({ healthFactor, trigger, exitTarget, trail = [], armed = true, className, compact, hideLegend }: RiskRailProps) {
  const s = scaleFor([healthFactor, trigger ?? 1.04, exitTarget ?? 1.1]);
  const finite = Number.isFinite(healthFactor);
  const at = finite ? s.at(healthFactor) : 1;
  const offScale = finite && healthFactor > s.ceiling;
  const tone = hfTone(healthFactor);
  const toneBg = tone === "danger" ? "bg-danger" : tone === "caution" ? "bg-caution" : "bg-safe";

  const label = [
    `Health factor ${finite ? healthFactor.toFixed(3) : "with no debt"}`,
    trigger !== undefined ? `trigger ${trigger.toFixed(2)}${armed ? "" : " (not armed)"}` : "no trigger set",
    `Aave liquidates at ${LIQUIDATION.toFixed(2)}`,
    exitTarget !== undefined ? `an exit restores ${exitTarget.toFixed(2)}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const bubbleAlign = at < 0.08 ? "translate-x-[-12%]" : at > 0.92 ? "translate-x-[-88%]" : "-translate-x-1/2";

  return (
    <figure className={cn("w-full select-none", className)} aria-label={label} role="img">
      <div className={cn("relative", compact ? "pt-8" : "pt-10")} aria-hidden>
        {/* Live reading */}
        <div
          className={cn("absolute top-0 whitespace-nowrap transition-[left] duration-300 ease-linear", bubbleAlign)}
          style={{ left: pct(at) }}
        >
          <span className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2 py-1 text-[0.75rem] font-semibold text-background shadow-sm num">
            <span className={cn("size-1.5 rounded-full", toneBg)} />
            HF {finite ? (offScale ? `${healthFactor.toFixed(2)}` : healthFactor.toFixed(3)) : "no debt"}
          </span>
        </div>

        {/* Track */}
        <div className={cn("relative overflow-hidden rounded-full bg-muted", compact ? "h-2.5" : "h-3")}>
          <div className="absolute inset-y-0 left-0 bg-danger/80" style={{ width: pct(s.at(LIQUIDATION)) }} />
          {trigger !== undefined && (
            <div
              className={cn("absolute inset-y-0", armed ? "bg-caution/45" : "bg-[repeating-linear-gradient(135deg,var(--input)_0_4px,transparent_4px_8px)]")}
              style={{ left: pct(s.at(LIQUIDATION)), width: pct(Math.max(0, s.at(trigger) - s.at(LIQUIDATION))) }}
            />
          )}
          {exitTarget !== undefined && (
            <div className="absolute inset-y-0 bg-safe/25" style={{ left: pct(s.at(trigger ?? LIQUIDATION)), width: pct(Math.max(0, s.at(exitTarget) - s.at(trigger ?? LIQUIDATION))) }} />
          )}
        </div>

        {/* Marks */}
        <div className="pointer-events-none absolute inset-x-0" style={{ top: compact ? "1.75rem" : "2.25rem", height: compact ? "1.5rem" : "1.75rem" }}>
          <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-danger" style={{ left: pct(s.at(LIQUIDATION)) }} />
          {trigger !== undefined && (
            <span
              className={cn("absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full", armed ? "bg-caution" : "bg-muted-foreground")}
              style={{ left: pct(s.at(trigger)) }}
            />
          )}
          {exitTarget !== undefined && (
            <span className="absolute inset-y-1 w-0 -translate-x-1/2 border-l-2 border-dashed border-safe" style={{ left: pct(s.at(exitTarget)) }} />
          )}
          {trail
            .filter((v) => Number.isFinite(v))
            .map((v, i, arr) => (
              <span
                key={i}
                className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
                style={{ left: pct(s.at(v)), opacity: 0.06 + (0.24 * (i + 1)) / arr.length }}
              />
            ))}
        </div>

        {/* Knob */}
        <span
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card shadow-[0_0_0_1px_var(--border)] transition-[left] duration-300 ease-linear",
            compact ? "size-4" : "size-5",
            toneBg,
          )}
          style={{ left: pct(at), top: compact ? "calc(2rem + 0.3125rem)" : "calc(2.5rem + 0.375rem)" }}
        />

        {/* Axis */}
        <div className="relative mt-3 h-4 text-[0.6875rem] text-muted-foreground num">
          {s.ticks.map((t, i) => (
            <span
              key={t}
              className={cn("absolute -translate-x-1/2", i > 0 && s.ticks.length > 9 && i % 2 === 1 && "hidden sm:inline")}
              style={{ left: pct(s.at(t)) }}
            >
              {t.toFixed(2)}
            </span>
          ))}
        </div>
      </div>

      {!hideLegend && (
        <figcaption className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.8125rem] text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-0.5 rounded-full bg-danger" aria-hidden />
            Liquidation <span className="font-medium text-foreground num">1.00</span>
          </span>
          {trigger !== undefined && (
            <span className="inline-flex items-center gap-2">
              <span className={cn("h-3 w-[3px] rounded-full", armed ? "bg-caution" : "bg-muted-foreground")} aria-hidden />
              {armed ? "Trigger" : "Trigger, not armed"} <span className="font-medium text-foreground num">{trigger.toFixed(2)}</span>
            </span>
          )}
          {exitTarget !== undefined && (
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-0 border-l-2 border-dashed border-safe" aria-hidden />
              Exit restores <span className="font-medium text-foreground num">{exitTarget.toFixed(2)}</span>
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
