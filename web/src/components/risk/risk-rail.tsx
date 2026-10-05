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
}

const LIQUIDATION = 1;

/** Where a reading sits on the rail, 0..1. The scale spans 0.95 to a ceiling that keeps every mark in view. */
function scaleFor(values: number[]) {
  const finite = values.filter((v) => Number.isFinite(v));
  const top = Math.max(1.3, ...finite.map((v) => v + 0.08));
  const ceiling = Math.min(Math.ceil(top * 20) / 20, 3);
  const floor = 0.95;
  return {
    floor,
    ceiling,
    at: (v: number) => (Math.min(Math.max(v, floor), ceiling) - floor) / (ceiling - floor),
  };
}

/**
 * Health-factor colour, the same bands Aave's own app uses (red below 1.1, amber below 3, teal from 3), so a
 * reading means the same thing here as on app.aave.com. Shield's users sit in the red band by design; the rail,
 * not the colour, shows where the trigger is.
 */
export function hfTone(hf: number): "safe" | "caution" | "danger" {
  if (!Number.isFinite(hf)) return "safe";
  const floored = Math.floor(hf * 100) / 100;
  if (floored < 1.1) return "danger";
  if (floored < 3) return "caution";
  return "safe";
}

/**
 * The health-factor rail: Aave's liquidation line at 1.00, the borrower's trigger above it, where an exit
 * restores HF to, and the live HF marker that moves with every block.
 */
export function RiskRail({ healthFactor, trigger, exitTarget, trail = [], armed = true, className, compact }: RiskRailProps) {
  const s = scaleFor([healthFactor, trigger ?? 1.04, exitTarget ?? 1.1]);
  const W = 1000;
  const H = compact ? 64 : 96;
  const trackY = compact ? 30 : 44;
  const x = (v: number) => s.at(v) * W;
  const tone = hfTone(healthFactor);
  const offScale = Number.isFinite(healthFactor) && healthFactor > s.ceiling;
  const ticks: number[] = [];
  for (let t = 1; t <= s.ceiling + 1e-9; t += s.ceiling - s.floor > 0.8 ? 0.25 : 0.1) ticks.push(Number(t.toFixed(2)));

  const label = [
    `Health factor ${Number.isFinite(healthFactor) ? healthFactor.toFixed(3) : "with no debt"}`,
    trigger !== undefined ? `trigger ${trigger.toFixed(2)}${armed ? "" : " (not armed)"}` : "no trigger set",
    `Aave liquidates at ${LIQUIDATION.toFixed(2)}`,
    exitTarget !== undefined ? `an exit restores ${exitTarget.toFixed(2)}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const align = (v: number) => {
    const p = s.at(v);
    return { left: `${p * 100}%`, transform: p < 0.12 ? "translateX(-4px)" : p > 0.88 ? "translateX(calc(-100% + 4px))" : "translateX(-50%)" };
  };

  return (
    <figure className={cn("w-full select-none", className)} aria-label={label} role="img">
      <div className="relative h-5" aria-hidden>
        {trigger !== undefined && (
          <span
            className={cn("absolute top-0 whitespace-nowrap text-2xs font-medium num", armed ? "text-caution" : "text-muted-foreground")}
            style={align(trigger)}
          >
            Trigger {trigger.toFixed(2)}
            {!armed && " (not armed)"}
          </span>
        )}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full overflow-visible" style={{ height: H / 2 }} aria-hidden>
          <rect x={0} y={trackY - 7} width={x(LIQUIDATION)} height={14} className="fill-danger-soft" />
          {trigger !== undefined && (
            <rect
              x={x(LIQUIDATION)}
              y={trackY - 7}
              width={Math.max(0, x(trigger) - x(LIQUIDATION))}
              height={14}
              className={armed ? "fill-caution-soft" : "fill-muted"}
            />
          )}
          <line x1={0} x2={W} y1={trackY} y2={trackY} className="stroke-border" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {ticks.map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={trackY + 9} y2={trackY + 14} className="stroke-muted-foreground/50" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={x(LIQUIDATION)} x2={x(LIQUIDATION)} y1={trackY - 16} y2={trackY + 16} className="stroke-danger" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {exitTarget !== undefined && (
            <line x1={x(exitTarget)} x2={x(exitTarget)} y1={trackY - 10} y2={trackY + 10} className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          )}
          {trigger !== undefined && (
            <line
              x1={x(trigger)}
              x2={x(trigger)}
              y1={trackY - 22}
              y2={trackY + 22}
              className={armed ? "stroke-caution" : "stroke-muted-foreground"}
              strokeWidth={2.5}
              strokeDasharray={armed ? undefined : "4 3"}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {trail
            .filter((v) => Number.isFinite(v))
            .map((v, i, arr) => (
              <circle key={i} cx={x(v)} cy={trackY} r={3} className="fill-foreground" style={{ opacity: 0.05 + (0.25 * (i + 1)) / arr.length }} />
            ))}
        </svg>
        <span
          className={cn(
            "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background transition-[left] duration-300 ease-linear",
            compact ? "size-3.5" : "size-4",
            tone === "safe" && "bg-safe",
            tone === "caution" && "bg-caution",
            tone === "danger" && "bg-danger",
          )}
          style={{ left: `${(Number.isFinite(healthFactor) ? s.at(healthFactor) : 1) * 100}%`, top: `${(trackY / H) * 100}%` }}
          aria-hidden
        />
      </div>
      <div className="relative h-5 text-2xs text-muted-foreground num" aria-hidden>
        <span className="absolute top-1 whitespace-nowrap text-danger" style={align(LIQUIDATION)}>
          Liquidation 1.00
        </span>
        {exitTarget !== undefined && !compact && (
          <span className="absolute top-1 hidden whitespace-nowrap sm:inline" style={align(exitTarget)}>
            Exit to {exitTarget.toFixed(2)}
          </span>
        )}
        {offScale && <span className="absolute right-0 top-1 whitespace-nowrap text-safe">HF {healthFactor.toFixed(2)}</span>}
      </div>
    </figure>
  );
}
