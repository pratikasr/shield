"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { niceTicks } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export interface ChartSeries {
  key: string;
  label: string;
  /** Tailwind fill class for the bars, from the colour tokens. */
  fill: string;
  /** Tailwind background class for the legend swatch, the same colour. */
  swatch: string;
}

export interface ChartBar {
  key: string;
  /** What the readout and the table call this bar ("5 Oct, 11:00 to 12:00 UTC"). */
  title: string;
  /** A candidate x-axis label; the chart drops candidates that would collide. */
  axisLabel?: string;
  /** One value per series, in the order of `series`. */
  values: number[];
}

/** The plot's least height; it grows to fill a taller container (a panel stretched to its row). */
const MIN_HEIGHT = 224;
const PAD_TOP = 10;
const PAD_BOTTOM = 26;
const BAR_MAX = 24;
const RADIUS = 4;
const SEGMENT_GAP = 2;
/** Nothing earned below this, in the chart's unit, is treated as zero. */
const EPS = 1e-15;

function useSize<T extends HTMLElement>(remount: unknown) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: MIN_HEIGHT });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (w: number, h: number) => setSize({ width: Math.floor(w), height: Math.max(MIN_HEIGHT, Math.floor(h)) });
    read(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => read(entries[0]!.contentRect.width, entries[0]!.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [remount]);
  return { ref, ...size };
}

/** A rectangle with its top corners rounded (the data end) and a square base. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function sum(values: number[]) {
  return values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
}

/**
 * A stacked bar chart drawn as SVG. Bars grow from one baseline with a 2 px surface gap between segments and a rounded
 * data end. A readout above the plot carries the legend and the values: the period's totals by default, one bar's
 * values on hover, tap or arrow keys. "Show as table" gives the same numbers as a table. The SVG itself is an image
 * with a summary label.
 */
export function StackedBarChart({
  series,
  bars,
  format,
  axisFormat,
  summary,
  totalLabel,
  emptyMessage,
  tableFirstColumn,
  tableNote,
  navHint,
  stale,
}: {
  series: ChartSeries[];
  bars: ChartBar[];
  /** Formats a value for the readout and the table. */
  format: (value: number) => string;
  /** Formats a y-axis tick, given the tick step. */
  axisFormat: (value: number, step: number) => string;
  /** The image's accessible summary. */
  summary: string;
  /** The readout's heading when no bar is selected ("Total, last 24 hours"). */
  totalLabel: string;
  emptyMessage: ReactNode;
  tableFirstColumn: string;
  /** A line under the table, such as which rows were left out. */
  tableNote?: ReactNode;
  /** How to move between bars by keyboard, for the screen-reader label ("each hour"). */
  navHint: string;
  /** Keeps the frame but dims it while the data is old. */
  stale?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  // The plot element comes back when the table is closed, so it is measured again then.
  const { ref, width, height: HEIGHT } = useSize<HTMLDivElement>(asTable);
  const readoutId = useId();
  const totals = useMemo(() => bars.map((b) => sum(b.values)), [bars]);
  const maxTotal = Math.max(0, ...totals);
  const empty = !(maxTotal > EPS);
  const { ticks, top, step } = useMemo(() => niceTicks(maxTotal), [maxTotal]);

  // A selection can outlive a period change; it is dropped when the bars change length.
  useEffect(() => setActive(null), [bars.length]);

  const seriesTotals = useMemo(() => series.map((_, i) => sum(bars.map((b) => b.values[i] ?? 0))), [series, bars]);
  const shown = active !== null && bars[active] ? bars[active]!.values : seriesTotals;
  const heading = active !== null && bars[active] ? bars[active]!.title : totalLabel;
  const shownTotal = sum(shown);

  // Layout, in CSS pixels.
  const tickLabels = ticks.map((t) => axisFormat(t, step));
  const padLeft = empty ? 8 : Math.ceil(Math.max(...tickLabels.map((l) => l.length)) * 6.6) + 12;
  const plotW = Math.max(0, width - padLeft - 4);
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slot = bars.length ? plotW / bars.length : 0;
  const barW = slot >= 8 ? Math.min(BAR_MAX, Math.max(2, slot * 0.62)) : Math.max(1, slot - 1);
  const y = (v: number) => PAD_TOP + plotH - (v / top) * plotH;
  const baseline = PAD_TOP + plotH;

  // X labels: candidates kept only when there is room since the last one kept.
  const xLabels = useMemo(() => {
    const out: { i: number; text: string }[] = [];
    let lastX = -Infinity;
    bars.forEach((b, i) => {
      if (!b.axisLabel) return;
      const cx = padLeft + slot * (i + 0.5);
      const w = b.axisLabel.length * 6.4;
      if (cx - lastX < w + 14) return;
      out.push({ i, text: b.axisLabel });
      lastX = cx;
    });
    return out;
  }, [bars, padLeft, slot]);

  const firstWithValue = () => {
    for (let i = bars.length - 1; i >= 0; i--) if (totals[i]! > EPS) return i;
    return bars.length - 1;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!bars.length) return;
    let next: number | null;
    // The first arrow press lands on the latest bar with earnings; later presses step one bar.
    if (e.key === "ArrowLeft") next = active === null ? firstWithValue() : Math.max(0, active - 1);
    else if (e.key === "ArrowRight") next = active === null ? firstWithValue() : Math.min(bars.length - 1, active + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = bars.length - 1;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setActive(next);
  };

  const legend = (
    <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-[0.8125rem] sm:flex sm:flex-wrap">
      {series.map((s, i) => (
        <li key={s.key} className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2.5 shrink-0 rounded-[3px]", s.swatch)} aria-hidden />
          <span className="min-w-0 flex-1 text-muted-foreground sm:flex-none">{s.label}</span>
          <span className="font-medium num">{format(shown[i] ?? 0)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col transition-opacity", stale && "opacity-60")}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="hit absolute right-0 top-0 rounded-md border bg-card px-2.5 py-1 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {asTable ? "Show as chart" : "Show as table"}
        </button>
        {/* The readout spans the full width; only its first line leaves room for the button. */}
        <div id={readoutId} className="min-w-0" aria-live="polite" aria-atomic="true">
          <p className="min-h-7 pr-32 text-[0.8125rem] text-muted-foreground">
            {heading}
            <span className="ml-2 font-semibold text-foreground num">{format(shownTotal)}</span>
          </p>
          {legend}
        </div>
      </div>

      {asTable ? (
        <ChartTable series={series} bars={bars} totals={totals} format={format} firstColumn={tableFirstColumn} note={tableNote} caption={summary} />
      ) : (
        <div
          ref={ref}
          className="relative mt-4 min-h-56 flex-1 rounded-md outline-offset-4"
          tabIndex={empty ? undefined : 0}
          role={empty ? undefined : "group"}
          aria-label={empty ? undefined : `Earnings chart. Use the left and right arrow keys to read ${navHint}; Escape returns to the totals.`}
          aria-describedby={empty ? undefined : readoutId}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {width > 0 && (
            // Out of flow, so the drawing never sets the box's height: the box takes its height from the panel.
            <svg width={width} height={HEIGHT} role="img" aria-label={summary} className="absolute inset-0 block overflow-visible" onPointerLeave={() => setActive(null)}>
              {/* Grid and y-axis: hairlines one step off the surface. */}
              {!empty &&
                ticks.map((t, i) => (
                  <g key={t}>
                    {i > 0 && <line x1={padLeft} x2={padLeft + plotW} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} shapeRendering="crispEdges" />}
                    <text x={padLeft - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] num">
                      {tickLabels[i]}
                    </text>
                  </g>
                ))}
              <line x1={padLeft} x2={padLeft + plotW} y1={baseline} y2={baseline} className="stroke-muted-foreground/40" strokeWidth={1} shapeRendering="crispEdges" />

              {/* Bars. */}
              {!empty &&
                bars.map((b, i) => {
                  const x = padLeft + slot * i + (slot - barW) / 2;
                  const total = totals[i]!;
                  if (!(total > EPS)) return null;
                  const dim = active !== null && active !== i;
                  const fullH = (total / top) * plotH;
                  if (fullH < 2) {
                    // Something was earned but too little to draw to scale: a 2 px mark in the largest series' colour.
                    const biggest = b.values.indexOf(Math.max(...b.values));
                    return <rect key={b.key} x={x} y={baseline - 2} width={barW} height={2} className={cn(series[biggest]?.fill, dim && "opacity-40")} />;
                  }
                  // A segment under half a pixel is not drawn: its value stays in the readout and the table.
                  const drawn = series.map((s, si) => ({ s, h: ((b.values[si] ?? 0) / top) * plotH })).filter((d) => d.h >= 0.5);
                  let cursor = baseline;
                  return (
                    <g key={b.key} className={cn("transition-opacity", dim && "opacity-40")}>
                      {drawn.map((d, di) => {
                        const gap = di > 0 && d.h > SEGMENT_GAP + 1 ? SEGMENT_GAP : 0;
                        const h = Math.max(d.h - gap, 0.5);
                        const top0 = cursor - gap - h;
                        cursor = top0;
                        const isTop = di === drawn.length - 1;
                        return isTop ? (
                          <path key={d.s.key} d={topRounded(x, top0, barW, h, RADIUS)} className={d.s.fill} />
                        ) : (
                          <rect key={d.s.key} x={x} y={top0} width={barW} height={h} className={d.s.fill} />
                        );
                      })}
                    </g>
                  );
                })}

              {/* X labels. */}
              {xLabels.map(({ i, text }) => {
                const cx = padLeft + slot * (i + 0.5);
                const w = text.length * 6.4;
                const anchor = cx - w / 2 < 0 ? "start" : cx + w / 2 > width ? "end" : "middle";
                return (
                  <text key={i} x={anchor === "start" ? 0 : anchor === "end" ? width : cx} y={baseline + 17} textAnchor={anchor} className="fill-muted-foreground text-[11px] num">
                    {text}
                  </text>
                );
              })}

              {/* Hit areas: the whole column, taller and wider than the bar. */}
              {!empty &&
                bars.map((b, i) => (
                  <rect
                    key={`hit-${b.key}`}
                    x={padLeft + slot * i}
                    y={PAD_TOP}
                    width={Math.max(slot, 1)}
                    height={plotH}
                    fill="transparent"
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={() => setActive(i)}
                  />
                ))}
              {active !== null && !empty && (
                <line
                  x1={padLeft + slot * (active + 0.5)}
                  x2={padLeft + slot * (active + 0.5)}
                  y1={PAD_TOP}
                  y2={baseline}
                  className="pointer-events-none stroke-muted-foreground/30"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              )}
            </svg>
          )}
          {empty && (
            <div className="absolute inset-x-0 top-0 flex items-center justify-center px-4 text-center" style={{ height: HEIGHT - PAD_BOTTOM }}>
              <p className="max-w-md text-sm text-muted-foreground">{emptyMessage}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChartTable({
  series,
  bars,
  totals,
  format,
  firstColumn,
  note,
  caption,
}: {
  series: ChartSeries[];
  bars: ChartBar[];
  totals: number[];
  format: (value: number) => string;
  firstColumn: string;
  note?: ReactNode;
  caption: string;
}) {
  const rows = bars.map((b, i) => ({ b, total: totals[i]! })).filter((r) => r.total > EPS).reverse();
  const th = "px-3 pb-2.5 font-medium first:pl-0 last:pr-0";
  const td = "px-3 py-2.5 first:pl-0 last:pr-0";
  return (
    <div className="mt-4">
      <div className="relative max-h-[22rem] overflow-auto">
        <table className="w-full min-w-[30rem] text-left text-sm [&_tbody_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-card">
            <tr className="border-b text-[0.75rem] text-muted-foreground">
              <th scope="col" className={th}>
                {firstColumn}
              </th>
              {series.map((s) => (
                <th key={s.key} scope="col" className={`${th} max-w-[9rem] text-right align-bottom`}>
                  {s.label}
                </th>
              ))}
              <th scope="col" className={`${th} text-right`}>
                Total
              </th>
            </tr>
          </thead>
          <tbody className="num">
            {rows.length ? (
              rows.map(({ b, total }) => (
                <tr key={b.key} className="border-b last:border-b-0">
                  <th scope="row" className={`${td} font-normal`}>
                    {b.title}
                  </th>
                  {series.map((s, i) => (
                    <td key={s.key} className={`${td} text-right`}>
                      {format(b.values[i] ?? 0)}
                    </td>
                  ))}
                  <td className={`${td} text-right font-medium`}>{format(total)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={series.length + 2} className="py-6 text-center text-muted-foreground">
                  Nothing earned in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {note && rows.length > 0 && <p className="mt-3 text-[0.8125rem] text-muted-foreground">{note}</p>}
    </div>
  );
}
