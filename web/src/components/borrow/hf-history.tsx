"use client";

import { LineChartIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Address } from "viem";
import { LineChart, formatTimeTick, niceTicks, timeTicks, type ChartMarker, type ChartPoint } from "@/components/charts/line-chart";
import { HashLink } from "@/components/data/hash-link";
import { Info } from "@/components/data/info";
import { Panel } from "@/components/data/stat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIndexerQuery } from "@/hooks/useIndexer";
import { BORROWER_CHART, CHART_REPRICE_LIMIT, buildHfSeries, historyError, type BorrowerChart, type HfPoint } from "@/lib/envio";
import { envioUrl } from "@/lib/env";
import { formatHf, formatUsd, timeAgo, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HfHistorySkeleton } from "./history";

/** Rows the table alternative lists, newest first. */
const TABLE_ROWS = 100;
const HF_HEIGHT = 200;
const PREMIUM_HEIGHT = 72;

type Range = "cover" | "1h" | "24h" | "all";
const RANGES: { id: Range; label: string; seconds: number }[] = [
  { id: "cover", label: "This cover", seconds: Number.NaN },
  { id: "1h", label: "Last hour", seconds: 3600 },
  { id: "24h", label: "24 hours", seconds: 86_400 },
  { id: "all", label: "All", seconds: Number.POSITIVE_INFINITY },
];

function when(t: number): string {
  return new Date(t * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function hfTickText(step: number) {
  const d = step < 0.01 ? 3 : 2;
  return (y: number) => y.toFixed(d);
}

function Readout({ point, premium, scope }: { point?: HfPoint; premium?: number; scope: string }) {
  if (!point) return <span className="text-muted-foreground">Hover, tap or use the arrow keys on the chart to read a point.</span>;
  if (point.kind === "live")
    return (
      <>
        <span className="text-muted-foreground">Now, live from Aave:</span> health factor <strong className="font-semibold">{formatHf(point.hf)}</strong>
      </>
    );
  if (point.kind === "exit" && point.exit)
    return (
      <>
        <span className="text-muted-foreground">Exit, {when(point.t)}, block {point.block.toLocaleString("en-US")}:</span> health factor{" "}
        <strong className="font-semibold">{formatHf(toNumber(BigInt(point.exit.healthFactorBefore), 18))}</strong> to{" "}
        <strong className="font-semibold text-safe">{formatHf(point.hf)}</strong>, saved {formatUsd(toNumber(BigInt(point.exit.savedVsAave), 6))} against Aave&rsquo;s bonus
      </>
    );
  return (
    <>
      <span className="text-muted-foreground">
        {when(point.t)}, block {point.block.toLocaleString("en-US")}
        {point.kind === "exitBefore" ? ", at the exit" : ""}:
      </span>{" "}
      health factor <strong className="font-semibold">{formatHf(point.hf)}</strong>
      {premium !== undefined && (
        <>
          , premium paid {scope} <strong className="font-semibold">{formatUsd(premium)}</strong>
        </>
      )}
    </>
  );
}

/**
 * The borrower's health factor over time, from the Repriced events the indexer recorded, with the trigger, Aave's 1.00
 * line and each exit; below it, the premium paid. Lazy-loaded: it sits below the fold and is not needed for the
 * first paint.
 */
export default function HfHistoryPanel({
  borrower,
  liveHf,
  trigger,
  active,
  nowSec,
}: {
  borrower: Address;
  liveHf: number;
  /** The active cover's trigger. */
  trigger?: number;
  /** A cover is active: the keeper keeps repricing, so the line runs on to the live reading. */
  active: boolean;
  /** Chain time now, unix seconds. */
  nowSec?: number;
}) {
  const q = useIndexerQuery<BorrowerChart>(["borrower-chart", borrower], BORROWER_CHART, { borrower: borrower.toLowerCase() }, true, 6_000);
  const now = nowSec ?? Date.now() / 1000;
  const [chosen, setChosen] = useState<Range>();
  const [activeX, setActiveX] = useState<number>();
  const onActiveX = useCallback((x: number | undefined) => setActiveX(x), []);

  const liveT = active ? Math.floor(now) : undefined;
  const series = useMemo(
    () => buildHfSeries(q.data, liveT !== undefined ? { hf: liveHf, t: liveT } : undefined),
    // The live reading moves every block; the indexed part only when the query returns.
    [q.data, liveHf, liveT],
  );
  const recorded = series.points.filter((p) => p.kind !== "live");
  const latest = recorded.at(-1);

  // "This cover" runs from the active cover's opt-in, so an earlier cover and the gap since it do not squeeze it.
  const coverStart = active ? Number(q.data?.Position[0]?.optedInAt ?? 0) : 0;
  const ranges = RANGES.filter((r) => r.id !== "cover" || coverStart > 0);
  const since = (t: number) => recorded.filter((p) => p.t >= t).length;
  // The first range that holds at least two readings, until the reader picks one.
  const auto: Range = !latest
    ? "all"
    : coverStart > 0 && since(coverStart) >= 2
      ? "cover"
      : since(now - 3600) >= 2
        ? "1h"
        : since(now - 86_400) >= 2
          ? "24h"
          : "all";
  const range = chosen && ranges.some((r) => r.id === chosen) ? chosen : auto;
  const cutoff = range === "cover" ? coverStart : now - (RANGES.find((r) => r.id === range)?.seconds ?? Number.POSITIVE_INFINITY);
  const inRange = series.points.filter((p) => p.t >= cutoff);
  const inRangeRecorded = inRange.filter((p) => p.kind !== "live");

  const lastExit = series.points.filter((p) => p.kind === "exit").at(-1)?.exit;
  const triggerLine = trigger ?? (lastExit ? lastExit.trigger / 1e4 : undefined);
  const triggerText = trigger !== undefined ? "Trigger" : "Trigger at the last exit";

  // A segmented control in the Activity tabs' style: four ranges fit one row at 375 px, where chips would wrap.
  const head = (
    <div className="inline-flex h-8 items-center rounded-lg bg-muted p-[3px]" role="group" aria-label="Time range">
      {ranges.map((r) => (
        <button
          key={r.id}
          type="button"
          aria-pressed={range === r.id}
          onClick={() => setChosen(r.id)}
          className={cn(
            "hit relative h-full whitespace-nowrap rounded-md px-2 text-[0.8125rem] font-medium transition-colors",
            range === r.id ? "bg-card text-foreground shadow-sm dark:bg-input/40" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  const empty = (text: React.ReactNode, tone?: "caution", action?: React.ReactNode) => (
    <div className="flex min-h-[19rem] flex-col items-center justify-center gap-3 px-2 text-center" role={tone ? "status" : undefined}>
      <span className="flex size-10 items-center justify-center rounded-full bg-raised text-muted-foreground">
        <LineChartIcon className="size-5" aria-hidden />
      </span>
      <p className={tone ? "max-w-md text-sm text-caution" : "max-w-md text-sm text-muted-foreground"}>{text}</p>
      {action}
    </div>
  );

  let body: React.ReactNode;
  if (!envioUrl) body = empty("History comes from the Envio indexer. Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to its GraphQL endpoint to show it.");
  else if (q.error && !q.data) body = empty(historyError(q.error), "caution");
  else if (q.isLoading || !q.data) body = <HfHistorySkeleton bare />;
  else if (!latest)
    body = empty(
      "No history yet. Each time the keeper reprices a cover, the indexer records the health factor it saw; the chart starts after the first reprices, with any exit marked.",
    );
  else if (inRangeRecorded.length === 0)
    body = empty(
      range === "cover" ? (
        "No reprices recorded for this cover yet. The keeper's first reprice appears here."
      ) : (
        <>
          No reprices in {range === "1h" ? "the last hour" : "the last 24 hours"}. The latest was {timeAgo(latest.t, now)}.
        </>
      ),
      undefined,
      <Button variant="outline" size="sm" onClick={() => setChosen("all")}>
        Show all
      </Button>,
    );
  else {
    // The axis fits the readings in range: sparse history fills the width instead of sitting in a sliver of an hour.
    const visible = inRange;
    const xStart = inRange[0]!.t;
    const xEnd = inRange.at(-1)!.t;
    const xDomain: [number, number] = xEnd > xStart ? [xStart, xEnd] : [xStart - 30, xEnd + 30];

    const hfs = inRange.map((p) => p.hf);
    const lo = Math.min(...hfs, 1);
    const hi = Math.max(...hfs, triggerLine ?? 0);
    const pad = Math.max((hi - lo) * 0.12, 0.01);
    const hfTicks = niceTicks(lo - pad, hi + pad, 4);
    const hfText = hfTickText(hfTicks.step);

    // The premium line counts from the first reprice shown, so it rises across the range. Its name says from when:
    // every cover when the whole history is loaded, this cover when its first reprice is loaded, else the first time.
    const reprPts = visible.filter((p) => p.kind === "reprice" && p.cum !== undefined);
    const firstLoaded = recorded[0];
    const scope: "all" | "cover" | "since" =
      range === "all" && !series.truncated ? "all" : range === "cover" && (!series.truncated || (firstLoaded !== undefined && firstLoaded.t < coverStart)) ? "cover" : "since";
    const base = scope !== "all" && reprPts[0] ? Math.max(reprPts[0].cum! - (reprPts[0].charged ?? 0), 0) : 0;
    const premiumPts = reprPts.map((p) => ({ ...p, cum: Math.max(p.cum! - base, 0) }));
    const sinceText = reprPts[0] ? formatTimeTick(reprPts[0].t, 1) : "";
    const premiumWord = scope === "all" ? "Premium paid, all covers" : scope === "cover" ? "Premium paid on this cover" : `Premium paid since ${sinceText}`;
    const premiumReadout = scope === "all" ? "so far" : scope === "cover" ? "on this cover" : `since ${sinceText}`;
    const premiumMax = Math.max(...premiumPts.map((p) => p.cum), 0);
    const premiumTicks = niceTicks(0, premiumMax > 0 ? premiumMax : 1e-6, 2);
    const premiumText = (y: number) => (y === 0 ? "$0" : formatUsd(y));

    const labelWidth = Math.max(...hfTicks.ticks.map((t) => hfText(t).length), ...premiumTicks.ticks.map((t) => premiumText(t).length)) * 6.4 + 12;
    const time = timeTicks(xDomain[0], xDomain[1], 5);
    const xText = (t: number) => formatTimeTick(t, time.step);

    const hfPoints: ChartPoint[] = visible.map((p) => ({ x: p.t, y: p.hf, gapBefore: p.gapBefore }));
    const premiumPoints: ChartPoint[] = premiumPts.map((p) => ({ x: p.t, y: p.cum, gapBefore: p.gapBefore }));
    const exitMarkers: ChartMarker[] = inRange.filter((p) => p.kind === "exit").map((p) => ({ x: p.t, y: p.hf, tone: "safe" }));
    const hasGap = visible.some((p) => p.gapBefore);

    const idx = activeX !== undefined ? visible.reduce((best, p, i) => (Math.abs(p.t - activeX) < Math.abs(visible[best]!.t - activeX) ? i : best), 0) : -1;
    const activePoint = idx >= 0 ? visible[idx] : undefined;
    const premiumAt = (t: number) => premiumPts.filter((p) => p.t <= t).at(-1)?.cum;

    const lowest = inRange.reduce((m, p) => (p.hf < m.hf ? p : m), inRange[0]!);
    const exitsShown = exitMarkers.length;
    const summary = [
      `Health factor from ${when(xDomain[0])} to ${when(xDomain[1])}`,
      `${inRangeRecorded.length} readings, lowest ${formatHf(lowest.hf)}, latest ${formatHf(inRange.at(-1)!.hf)}${inRange.at(-1)!.kind === "live" ? " live" : ""}`,
      exitsShown ? `${exitsShown} exit${exitsShown === 1 ? "" : "s"} marked` : "no exits in this range",
      triggerLine !== undefined ? `${triggerText.toLowerCase()} ${triggerLine.toFixed(2)}` : "no trigger",
      "Aave liquidates below 1.00",
    ].join("; ");
    const premiumFirst = premiumPts[0]?.cum ?? 0;
    const premiumLast = premiumPts.at(-1)?.cum ?? 0;
    const premiumSummary = `${premiumWord}, from ${formatUsd(premiumFirst)} to ${formatUsd(premiumLast)} over this range`;
    const premiumOf = (p: HfPoint) => (p.cum !== undefined ? Math.max(p.cum - base, 0) : undefined);

    const tableRows = [...inRange].reverse().slice(0, TABLE_ROWS);

    body = (
      <>
        {/* Announced only while the reader moves the crosshair; the live reading changes every block. */}
        <p className="min-h-[2.75rem] text-[0.8125rem] num sm:min-h-[1.5rem]" aria-live={activePoint ? "polite" : "off"}>
          <Readout point={activePoint ?? inRange.at(-1)} premium={activePoint ? premiumAt(activePoint.t) : premiumLast} scope={premiumReadout} />
        </p>

        <div className="mt-3">
          <LineChart
            points={hfPoints}
            xDomain={xDomain}
            yDomain={hfTicks.domain}
            xTicks={time.ticks}
            yTicks={hfTicks.ticks}
            formatXTick={xText}
            formatYTick={hfText}
            refLines={[{ y: 1, tone: "danger" }, ...(triggerLine !== undefined ? [{ y: triggerLine, tone: "caution" as const, dashed: true }] : [])]}
            markers={exitMarkers}
            height={HF_HEIGHT}
            marginLeft={labelWidth}
            label={summary}
            activeX={activePoint?.t}
            onActiveX={onActiveX}
            liveLast={inRange.at(-1)?.kind === "live"}
            hideXAxis={premiumPoints.length > 0}
          />
        </div>

        {premiumPoints.length > 0 && (
          <div className="mt-2">
            <p className="text-[0.75rem] text-muted-foreground" style={{ paddingLeft: labelWidth }}>
              {premiumWord}
            </p>
            <LineChart
              points={premiumPoints}
              xDomain={xDomain}
              yDomain={premiumTicks.domain}
              xTicks={time.ticks}
              yTicks={premiumTicks.ticks}
              formatXTick={xText}
              formatYTick={premiumText}
              area
              height={PREMIUM_HEIGHT}
              marginLeft={labelWidth}
              label={premiumSummary}
              activeX={activePoint?.t}
              onActiveX={onActiveX}
            />
          </div>
        )}

        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.8125rem] text-muted-foreground">
          <li className="inline-flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full bg-brand" aria-hidden />
            Health factor{inRange.at(-1)?.kind === "live" ? ", live at the end" : ""}
          </li>
          {triggerLine !== undefined && (
            <li className="inline-flex items-center gap-2">
              <span className="w-4 border-t-2 border-dashed border-caution" aria-hidden />
              {triggerText} <span className="font-medium text-foreground num">{triggerLine.toFixed(2)}</span>
            </li>
          )}
          <li className="inline-flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full bg-danger" aria-hidden />
            Aave liquidates below <span className="font-medium text-foreground num">1.00</span>
          </li>
          {exitsShown > 0 && (
            <li className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-safe ring-2 ring-card" aria-hidden />
              Exit
            </li>
          )}
          {hasGap && (
            <li className="inline-flex items-center gap-2">
              <span className="w-4 border-t-2 border-dotted border-brand opacity-70" aria-hidden />
              No reprice recorded in between
            </li>
          )}
        </ul>

        {series.truncated && (
          <p className="mt-3 text-[0.8125rem] text-muted-foreground">
            Showing the latest {CHART_REPRICE_LIMIT} reprices, back to {when(recorded[0]!.t)}.{series.droppedExits ? " Earlier exits are listed under Activity." : ""}
          </p>
        )}

        <details className="group mt-4 border-t pt-3">
          <summary className="hit relative w-fit cursor-pointer rounded-sm text-[0.8125rem] font-medium text-foreground">Show the data as a table</summary>
          <div className="relative mt-3 max-h-80 overflow-auto rounded-md border">
            <table className="w-full min-w-[30rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <caption className="sr-only">Health factor readings in this range, newest first</caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-[0.75rem] text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">When</th>
                  <th scope="col" className="px-3 py-2 font-medium">Reading</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Health factor</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{`Premium paid ${premiumReadout}`}</th>
                  <th scope="col" className="px-3 py-2 font-medium">Transaction</th>
                </tr>
              </thead>
              <tbody className="num">
                {tableRows.map((p, i) => (
                  <tr key={`${p.kind}-${p.block}-${i}`} className="border-b last:border-b-0">
                    <td className="px-3 py-2 text-muted-foreground">{p.kind === "live" ? "Now" : when(p.t)}</td>
                    <td className="px-3 py-2">
                      {p.kind === "live" ? "Live" : p.kind === "exit" ? "After the exit" : p.kind === "exitBefore" ? "Before the exit" : `Reprice, block ${p.block.toLocaleString("en-US")}`}
                    </td>
                    <td className="px-3 py-2 text-right">{formatHf(p.hf)}</td>
                    <td className="px-3 py-2 text-right">{premiumOf(p) !== undefined ? formatUsd(premiumOf(p)!) : <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2">{p.exit ? <HashLink value={p.exit.txHash} /> : <span className="text-muted-foreground">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {inRange.length > TABLE_ROWS && (
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">
              The newest {TABLE_ROWS} of {inRange.length} readings in this range. Every reprice is listed with its transaction under Activity.
            </p>
          )}
        </details>
      </>
    );
  }

  return (
    <Panel
      title="Health factor history"
      labelledBy="hf-history-heading"
      description={
        <>
          From each reprice the Envio indexer recorded
          <Info label="Where this history comes from">
            The keeper reprices a cover by calling the Repricer, which emits the health factor Aave reported in that block. The indexer stores those events;
            exits add the health factor before and after. Between reprices the health factor still moves with prices, so a dashed stretch means nothing was
            recorded there, not that nothing changed.
          </Info>
        </>
      }
      action={latest ? head : envioUrl && !q.error && !q.data ? <Skeleton className="h-8 w-[17rem] rounded-lg" /> : undefined}
    >
      {body}
    </Panel>
  );
}
