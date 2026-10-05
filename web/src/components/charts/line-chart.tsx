"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * A hand-built SVG line chart (no chart library, so nothing heavy ships): one series, horizontal reference lines,
 * point markers, dashed segments where data is missing, and a crosshair that follows the pointer or the arrow keys.
 * Two charts with the same `xDomain`, `marginLeft` and `activeX` line up and move their crosshairs together.
 *
 * Accessibility: the chart is one focusable image whose label summarises it. Arrow keys, Home and End move the
 * crosshair point by point; the caller shows the value in a readout outside the chart and offers a table.
 */

export type ChartTone = "brand" | "safe" | "caution" | "danger" | "muted";

export interface ChartPoint {
  x: number;
  y: number;
  /** No data between the previous point and this one: the segment is drawn dashed and faint. */
  gapBefore?: boolean;
}

export interface ChartRefLine {
  y: number;
  tone: ChartTone;
  dashed?: boolean;
}

export interface ChartMarker {
  x: number;
  y: number;
  tone: ChartTone;
}

const TONE: Record<ChartTone, string> = {
  brand: "var(--brand)",
  safe: "var(--safe)",
  caution: "var(--caution)",
  danger: "var(--danger)",
  muted: "var(--muted-foreground)",
};

export interface LineChartProps {
  points: ChartPoint[];
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  formatXTick: (x: number) => string;
  formatYTick: (y: number) => string;
  refLines?: ChartRefLine[];
  markers?: ChartMarker[];
  /** A 10% wash under the line (cumulative series). */
  area?: boolean;
  /** Plot height in pixels; the x-axis band is added below it. */
  height: number;
  /** Space for the y labels; give two aligned charts the same value. */
  marginLeft: number;
  /** Summary read by screen readers. */
  label: string;
  /** Hint for keyboard users, read after the label. */
  keyHint?: string;
  /** The x the crosshair snaps to (shared between charts), and its setter. */
  activeX?: number;
  onActiveX?: (x: number | undefined) => void;
  /** Draw a dot on the last point: it is a live reading. */
  liveLast?: boolean;
  tone?: ChartTone;
  className?: string;
  /** Hide the x-axis labels (the upper of two stacked charts). */
  hideXAxis?: boolean;
}

const MARGIN = { top: 10, right: 10, bottom: 24 };

/** Index of the point whose x is nearest `x`; points are sorted by x. */
export function nearestIndex(points: ChartPoint[], x: number): number {
  if (!points.length) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.x <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[hi]!.x - x) < Math.abs(points[lo]!.x - x) ? hi : lo;
}

export function LineChart({
  points,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  formatXTick,
  formatYTick,
  refLines = [],
  markers = [],
  area,
  height,
  marginLeft,
  label,
  keyHint = "Use the left and right arrow keys to read each point.",
  activeX,
  onActiveX,
  liveLast,
  tone = "brand",
  className,
  hideXAxis,
}: LineChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const clipId = useId();
  const hintId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(Math.round(el.getBoundingClientRect().width), 120));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bottom = hideXAxis ? 6 : MARGIN.bottom;
  const plotW = Math.max(width - marginLeft - MARGIN.right, 10);
  const plotH = height;
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const sx = (x: number) => marginLeft + (x1 > x0 ? ((x - x0) / (x1 - x0)) * plotW : plotW / 2);
  const sy = (y: number) => MARGIN.top + (y1 > y0 ? (1 - (y - y0) / (y1 - y0)) * plotH : plotH / 2);

  const paths = useMemo(() => {
    let solid = "";
    let dashed = "";
    let areaPath = "";
    points.forEach((p, i) => {
      const X = sx(p.x).toFixed(1);
      const Y = sy(p.y).toFixed(1);
      if (i === 0) {
        solid = `M${X},${Y}`;
        areaPath = `M${X},${sy(y0).toFixed(1)}L${X},${Y}`;
        return;
      }
      const prev = points[i - 1]!;
      if (p.gapBefore) {
        dashed += `M${sx(prev.x).toFixed(1)},${sy(prev.y).toFixed(1)}L${X},${Y}`;
        solid += `M${X},${Y}`;
      } else solid += `L${X},${Y}`;
      areaPath += `L${X},${Y}`;
    });
    if (points.length) areaPath += `L${sx(points.at(-1)!.x).toFixed(1)},${sy(y0).toFixed(1)}Z`;
    return { solid, dashed, area: areaPath };
    // sx and sy are pure functions of these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, x0, x1, y0, y1, plotW, plotH, marginLeft]);

  const active = activeX !== undefined ? nearestIndex(points, activeX) : -1;
  const activePoint = active >= 0 ? points[active] : undefined;

  const pick = (clientX: number) => {
    const el = wrap.current;
    if (!el || !points.length || !onActiveX) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const x = x0 + ((px - marginLeft) / plotW) * (x1 - x0);
    onActiveX(points[nearestIndex(points, x)]!.x);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length || !onActiveX) return;
    const i = active >= 0 ? active : points.length - 1;
    let next: number | undefined;
    if (e.key === "ArrowLeft") next = active < 0 ? points.length - 1 : Math.max(i - 1, 0);
    else if (e.key === "ArrowRight") next = active < 0 ? points.length - 1 : Math.min(i + 1, points.length - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = points.length - 1;
    else if (e.key === "Escape") {
      onActiveX(undefined);
      return;
    } else return;
    e.preventDefault();
    onActiveX(points[next]!.x);
  };

  // X labels that would touch the previous one are dropped; the first and last hug the plot's edges.
  const shownXTicks = useMemo(() => {
    const out: { x: number; px: number; text: string; anchor: "start" | "middle" | "end" }[] = [];
    let lastRight = -Infinity;
    for (const t of xTicks) {
      const px = sx(t);
      if (px < marginLeft - 0.5 || px > marginLeft + plotW + 0.5) continue;
      const text = formatXTick(t);
      const w = text.length * 6.2;
      const anchor = px - w / 2 < marginLeft ? "start" : px + w / 2 > marginLeft + plotW ? "end" : "middle";
      const left = anchor === "start" ? px : anchor === "end" ? px - w : px - w / 2;
      if (left < lastRight + 10) continue;
      lastRight = left + w;
      out.push({ x: t, px, text, anchor });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xTicks, x0, x1, plotW, marginLeft, formatXTick]);

  const svgH = MARGIN.top + plotH + bottom;
  const color = TONE[tone];

  return (
    <div
      ref={wrap}
      role="img"
      aria-label={label}
      aria-describedby={onActiveX ? hintId : undefined}
      tabIndex={onActiveX ? 0 : undefined}
      onKeyDown={onKeyDown}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => pick(e.clientX)}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => pick(e.clientX)}
      onPointerLeave={(e: PointerEvent<HTMLDivElement>) => {
        // A finger lifting keeps its reading; a mouse leaving clears it.
        if (e.pointerType === "mouse") onActiveX?.(undefined);
      }}
      onBlur={() => onActiveX?.(undefined)}
      className={cn("relative w-full touch-pan-y select-none rounded-md", className)}
      style={{ height: svgH }}
    >
      {onActiveX && (
        <span id={hintId} className="sr-only">
          {keyHint}
        </span>
      )}
      <svg width={width} height={svgH} className="block overflow-visible" aria-hidden focusable="false">
        <defs>
          <clipPath id={clipId}>
            <rect x={marginLeft} y={MARGIN.top - 6} width={plotW} height={plotH + 12} />
          </clipPath>
        </defs>

        {/* Grid and y labels: solid hairlines one step off the surface. */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={marginLeft} x2={marginLeft + plotW} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={marginLeft - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[0.6875rem] num">
              {formatYTick(t)}
            </text>
          </g>
        ))}

        {!hideXAxis &&
          shownXTicks.map((t) => (
            <text key={t.x} x={t.px} y={MARGIN.top + plotH + 17} textAnchor={t.anchor} className="fill-muted-foreground text-[0.6875rem] num">
              {t.text}
            </text>
          ))}

        <g clipPath={`url(#${clipId})`}>
          {refLines.map((r) => (
            <line
              key={`${r.tone}-${r.y}`}
              x1={marginLeft}
              x2={marginLeft + plotW}
              y1={sy(r.y)}
              y2={sy(r.y)}
              stroke={TONE[r.tone]}
              strokeWidth={1.5}
              strokeDasharray={r.dashed ? "5 4" : undefined}
            />
          ))}

          {markers.map((m) => (
            <line key={`m-${m.x}`} x1={sx(m.x)} x2={sx(m.x)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke={TONE[m.tone]} strokeWidth={1} opacity={0.55} />
          ))}

          {area && points.length > 1 && <path d={paths.area} fill={color} opacity={0.1} />}
          {paths.dashed && <path d={paths.dashed} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="3 4" opacity={0.6} />}
          {points.length > 1 && <path d={paths.solid} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {points.length === 1 && <circle cx={sx(points[0]!.x)} cy={sy(points[0]!.y)} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />}

          {markers.map((m) => (
            <circle key={`c-${m.x}`} cx={sx(m.x)} cy={sy(m.y)} r={4.5} fill={TONE[m.tone]} stroke="var(--card)" strokeWidth={2} />
          ))}

          {liveLast && points.length > 1 && <circle cx={sx(points.at(-1)!.x)} cy={sy(points.at(-1)!.y)} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />}
        </g>

        {activePoint && (
          <g>
            <line x1={sx(activePoint.x)} x2={sx(activePoint.x)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="var(--foreground)" strokeWidth={1} opacity={0.35} />
            <circle cx={sx(activePoint.x)} cy={sy(activePoint.y)} r={5} fill={color} stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>
    </div>
  );
}

const NICE = [1, 2, 2.5, 5, 10];

/** Round tick values covering [lo, hi], about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 4): { ticks: number[]; step: number; domain: [number, number] } {
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.05 || 1;
    return niceTicks(lo - pad, hi + pad, count);
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE.find((n) => n * mag >= raw) ?? 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { ticks, step, domain: [start, end] };
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600, 43_200, 86_400, 172_800, 604_800];

/** Time ticks (unix seconds) on round local-clock boundaries, at most `max` of them, and how to label them. */
export function timeTicks(x0: number, x1: number, max: number): { ticks: number[]; step: number } {
  const span = Math.max(x1 - x0, 1);
  const step = TIME_STEPS.find((s) => span / s <= Math.max(max, 2)) ?? 604_800;
  // Align to the local clock: an hour tick reads 14:00, not 14:30 in a half-hour time zone.
  const shift = -new Date(x0 * 1000).getTimezoneOffset() * 60;
  const ticks: number[] = [];
  for (let t = Math.ceil((x0 + shift) / step) * step - shift; t <= x1; t += step) ticks.push(t);
  return { ticks, step };
}

export function formatTimeTick(t: number, step: number): string {
  const d = new Date(t * 1000);
  if (step >= 86_400) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return d.toLocaleTimeString("en-GB", step < 60 ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
}
