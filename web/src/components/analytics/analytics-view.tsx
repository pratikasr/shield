"use client";

import { RefreshCw } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExitTable } from "@/components/borrow/history";
import { StackedBarChart, type ChartBar, type ChartSeries } from "@/components/charts/bar-chart";
import { Info } from "@/components/data/info";
import { Panel, Stat } from "@/components/data/stat";
import { TokenIcon } from "@/components/data/token";
import { Skeleton } from "@/components/ui/skeleton";
import { useIndexerQuery } from "@/hooks/useIndexer";
import { useLiveBlock } from "@/hooks/useLiveBlock";
import {
  ANALYTICS_QUERY,
  INDEXER_META_QUERY,
  SERIES,
  axisUsd,
  barTotal,
  earningsSeries,
  hourFrom,
  latestTxHashes,
  periodInfo,
  periodTotals,
  totalsUsd,
  usdHeadline,
  type AnalyticsData,
  type AnalyticsExitRow,
  type AnalyticsPositionRow,
  type IndexerMeta,
  type Period,
  type TotalsUsd,
} from "@/lib/analytics";
import { historyError } from "@/lib/envio";
import { envioUrl, isDeployed, isFork, shield } from "@/lib/env";
import { formatBps, formatClock, formatUsd } from "@/lib/format";
import { COST_SAMPLE, KeeperCost } from "./keeper-cost";
import { LendersList } from "./lenders";
import { LiquidationExample } from "./liquidation-example";
import { LiveBlocks } from "./live-blocks";
import { PeriodSelect } from "./period-select";
import { PositionsTable } from "./positions-table";
import { useChainTime, useLiveCovers, useProtocolShare } from "./use-live-protocol";

/** The chart's series, in stack order from the baseline. Neutral tones by lightness; colour is kept for meaning. */
const CHART_SERIES: ChartSeries[] = [
  { key: SERIES[0].key, label: SERIES[0].label, fill: "fill-foreground", swatch: "bg-foreground" },
  { key: SERIES[1].key, label: SERIES[1].label, fill: "fill-muted-foreground/60", swatch: "bg-muted-foreground/60" },
  { key: SERIES[2].key, label: SERIES[2].label, fill: "fill-muted-foreground", swatch: "bg-muted-foreground" },
];

/** The indexer is called behind when it trails the chain by more than this many blocks (about 30 seconds). */
const BEHIND_BLOCKS = 100;
const DEFAULT_MAX_SHARE_BPS = 2000;

const utcDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const utcDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const hh = (sec: number) => `${String(new Date(sec * 1000).getUTCHours()).padStart(2, "0")}:00`;

type HistoryState = { text: string; tone?: "caution" } | null;

function chartBars(period: Period, data: AnalyticsData, now: number): ChartBar[] {
  const { unit, bars } = earningsSeries(data, period, now);
  return bars.map((b) => {
    const d = new Date(b.start * 1000);
    const hour = d.getUTCHours();
    let axisLabel: string | undefined;
    if (unit === "day") axisLabel = utcDay.format(d);
    else if (period === "24h") axisLabel = hour === 0 ? utcDay.format(d) : hour % 6 === 0 ? hh(b.start) : undefined;
    else axisLabel = hour === 0 ? utcDay.format(d) : undefined;
    return {
      key: String(b.start),
      title: unit === "hour" ? `${utcDay.format(d)}, ${hh(b.start)} to ${hh(b.start + 3600)}` : utcDate.format(d),
      axisLabel,
      values: b.values,
    };
  });
}

function sumOf(b: ChartBar) {
  return barTotal({ start: 0, values: b.values as [number, number, number] });
}

function chartSummary(period: Period, bars: ChartBar[]): string {
  const info = periodInfo(period);
  const totals = SERIES.map((_, i) => bars.reduce((s, b) => s + (b.values[i] ?? 0), 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const withValue = bars.filter((b) => sumOf(b) > 0);
  const best = withValue.reduce<ChartBar | undefined>((m, b) => (!m || sumOf(b) > sumOf(m) ? b : m), undefined);
  const unit = info.unit === "hour" ? "hour" : "day";
  if (!total) return `Stacked bar chart of Shield's earnings by ${unit}, ${info.phrase}: nothing earned yet.`;
  return (
    `Stacked bar chart of Shield's earnings by ${unit}, ${info.phrase}, times in UTC. Total ${formatUsd(total)}: ` +
    SERIES.map((s, i) => `${s.label.toLowerCase()} ${formatUsd(totals[i]!)}`).join(", ") +
    `. ${withValue.length} of ${bars.length} ${unit}s had earnings` +
    (best ? `; the most was ${best.title}, ${formatUsd(sumOf(best))}.` : ".")
  );
}

// ------------------------------------------------------------------------------------------------ key figures

/**
 * The classes that make a Stat one key-figure cell: a three-row subgrid (label, value, hint) of the row it sits in, so
 * values line up across a row however many lines a label wraps to, and a hint row that always holds two lines, so
 * nothing below moves when the figures arrive.
 */
const KPI = "row-span-3 grid min-w-0 grid-rows-subgrid gap-y-0 bg-card px-4 py-5 sm:px-6 [&>dt]:self-start [&>dd+dd]:min-h-[2.6rem]";
/** A skeleton the height of a large reading (28 px type at line height 1.25). */
const ValueSkeleton = ({ w = "w-24" }: { w?: string }) => <Skeleton className={`h-[2.1875rem] ${w}`} />;
const HintSkeleton = () => (
  <span className="block" aria-hidden>
    <Skeleton className="h-3.5 w-28" />
    <Skeleton className="mt-1.5 h-3.5 w-20" />
  </span>
);

/** A dollar headline: "<$0.01" below a cent, with the exact figure leading the hint instead. */
function money(value: number | undefined, rest: string, historyState: HistoryState): { value: ReactNode; hint: ReactNode } {
  if (historyState) return { value: "n/a", hint: "Indexer unavailable" };
  if (value === undefined) return { value: <ValueSkeleton />, hint: <HintSkeleton /> };
  const h = usdHeadline(value);
  return {
    value: h.text,
    hint: h.exact ? (
      <>
        <span className="num">{h.exact}</span>; {rest.charAt(0).toLowerCase() + rest.slice(1)}
      </>
    ) : (
      rest
    ),
  };
}

/** Debt protected now and active covers: read every block, so they live in their own component. */
function LiveKpis({ optInsText }: { optInsText?: string }) {
  const live = useLiveCovers();
  return (
    <>
      <Stat
        className={KPI}
        size="lg"
        label={
          <span>
            Debt protected now{" "}
            <Info>
              The USDC debt on Aave of every paid-up cover, read live: the registry&rsquo;s active borrowers, then each one&rsquo;s USDC variable debt. Lapsed covers are
              left out.
            </Info>
          </span>
        }
        value={!isDeployed ? "n/a" : live.protectedDebt !== undefined ? formatUsd(live.protectedDebt) : <ValueSkeleton />}
        hint={live.activeCount === 0 ? "No active covers" : "Live from Aave"}
      />
      <Stat
        className={KPI}
        size="lg"
        label="Active covers"
        value={!isDeployed ? "n/a" : live.activeCount !== undefined ? live.activeCount.toLocaleString("en-US") : <ValueSkeleton w="w-10" />}
        hint={live.lapsedCount ? `${live.lapsedCount} lapsed, out of prepaid premium` : (optInsText ?? <HintSkeleton />)}
      />
    </>
  );
}

const KeyFigures = memo(function KeyFigures({
  totals,
  period,
  shareBps,
  maxShareBps,
  historyState,
}: {
  totals?: TotalsUsd;
  period: Period;
  shareBps?: number;
  maxShareBps: number;
  historyState: HistoryState;
}) {
  const info = periodInfo(period);
  const share = shareBps !== undefined ? `${formatBps(shareBps)} of premiums` : "A share of premiums";
  const protocol = money(totals?.premiumToProtocol, share, historyState);
  const lp = money(totals?.lpEarnings, "Premiums and exit discounts", historyState);
  const saved = money(totals?.savedVsAave, "For borrowers, against Aave's bonus", historyState);
  const exitsHint = historyState ? "Indexer unavailable" : !totals ? <HintSkeleton /> : totals.exits > 0 ? `${formatUsd(totals.debtRepaid)} of debt repaid` : `None ${info.phrase}`;
  const optIns = totals ? `${totals.optIns.toLocaleString("en-US")} opt-in${totals.optIns === 1 ? "" : "s"} ${info.phrase}` : undefined;
  return (
    <section aria-label={`Key figures, ${info.phrase}`} className="panel overflow-hidden">
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:grid-cols-6">
        <Stat
          className={KPI}
          size="lg"
          label={
            <span>
              Protocol earnings{" "}
              <Info>
                The protocol&rsquo;s share of every premium, split when the premium is charged and paid to the treasury at each sweep. The registry caps the share at{" "}
                {formatBps(maxShareBps)}; the exit discount is never shared.
              </Info>
            </span>
          }
          value={protocol.value}
          hint={protocol.hint}
        />
        <Stat
          className={KPI}
          size="lg"
          label={
            <span>
              Liquidity providers&rsquo; earnings{" "}
              <Info>
                Premiums to the vault plus exit discounts, gross. Each exit gives the vault collateral worth more than the debt it repaid; that discount is valued at
                Aave&rsquo;s oracle when the exit ran.
              </Info>
            </span>
          }
          value={lp.value}
          hint={lp.hint}
        />
        <Stat className={KPI} size="lg" label="Penalty avoided" tone={totals && totals.savedVsAave > 0 ? "safe" : undefined} value={saved.value} hint={saved.hint} />
        <Stat
          className={KPI}
          size="lg"
          label="Exits"
          value={historyState ? "n/a" : totals ? totals.exits.toLocaleString("en-US") : <ValueSkeleton w="w-10" />}
          hint={exitsHint}
        />
        <LiveKpis optInsText={historyState ? "Live from the registry" : optIns} />
      </dl>
    </section>
  );
});

// ------------------------------------------------------------------------------------------------ earnings

/** The protocol share waiting for the next sweep: read every block, so it is its own component. */
function PendingProtocol() {
  const { pendingProtocol } = useLiveCovers();
  return pendingProtocol !== undefined ? (
    <>
      {formatUsd(pendingProtocol)} <span className="text-muted-foreground">now</span>
    </>
  ) : (
    <Skeleton className="ml-auto h-4 w-16" />
  );
}

const Breakdown = memo(function Breakdown({ period, current, all }: { period: Period; current?: TotalsUsd; all?: TotalsUsd }) {
  const info = periodInfo(period);
  const rows: { label: ReactNode; get: (t: TotalsUsd) => number; indent?: boolean; strong?: boolean }[] = [
    { label: "Premiums charged", get: (t) => t.premiumCharged, strong: true },
    { label: "to liquidity providers", get: (t) => t.premiumToVault, indent: true },
    { label: "to the protocol", get: (t) => t.premiumToProtocol, indent: true },
    { label: "Protocol share paid to the treasury", get: (t) => t.protocolPaid },
    {
      label: (
        <span className="inline-flex items-center gap-1">
          Exit discounts, gross
          <Info>
            The collateral the vault took above the debt it repaid, at Aave&rsquo;s oracle when each exit ran. A flash-assisted exit pays its flash premium and swap cost
            out of this discount.
          </Info>
        </span>
      ),
      get: (t) => t.exitDiscount,
    },
    { label: "Total to liquidity providers", get: (t) => t.lpEarnings, strong: true },
  ];
  const cell = (t: TotalsUsd | undefined, get: (t: TotalsUsd) => number) => (t ? formatUsd(get(t)) : <Skeleton className="ml-auto h-4 w-16" />);
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Earnings breakdown, {info.phrase} and since launch</caption>
        <thead>
          <tr className="border-b text-[0.75rem] text-muted-foreground">
            <th scope="col" className="pb-2.5 pr-3 font-medium">
              <span className="sr-only">Line</span>
            </th>
            <th scope="col" className="px-3 pb-2.5 text-right font-medium whitespace-nowrap">
              {period === "all" ? "All time" : info.label}
            </th>
            {period !== "all" && (
              <th scope="col" className="pb-2.5 pl-3 text-right font-medium whitespace-nowrap">
                All time
              </th>
            )}
          </tr>
        </thead>
        <tbody className="num" aria-busy={!current || undefined}>
          {rows.map((r, i) => (
            <tr key={i} className={r.strong ? "border-b" : "border-b border-dashed last:border-b-0"}>
              <th scope="row" className={`py-2.5 pr-3 text-left ${r.strong ? "font-medium" : "font-normal"} ${r.indent ? "pl-4 text-muted-foreground" : ""}`}>
                {r.label}
              </th>
              <td className={`px-3 py-2.5 text-right whitespace-nowrap ${r.strong ? "font-medium" : ""}`}>{cell(current, r.get)}</td>
              {period !== "all" && <td className={`py-2.5 pl-3 text-right whitespace-nowrap ${r.strong ? "font-medium" : ""}`}>{cell(all, r.get)}</td>}
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-2.5 pr-3 text-left font-normal">
              <span className="inline-flex items-center gap-1">
                Protocol share waiting for the next sweep
                <Info>Read live from the Repricer on the proposed block. The next sweep pays it to the treasury in whole micro-USDC; anyone can call the sweep.</Info>
              </span>
            </th>
            <td colSpan={period === "all" ? 1 : 2} className="py-2.5 pl-3 text-right whitespace-nowrap">
              <PendingProtocol />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
});

const EarningsChart = memo(function EarningsChart({ period, bars, stale, historyState }: { period: Period; bars?: ChartBar[]; stale: boolean; historyState: HistoryState }) {
  const info = periodInfo(period);
  const summary = useMemo(() => (bars ? chartSummary(period, bars) : ""), [period, bars]);
  return (
    <Panel
      title="Earnings over time"
      description={`${info.unit === "hour" ? "Hourly" : "Daily"}, ${info.phrase}. Times in UTC.`}
      labelledBy="chart-heading"
      className="flex flex-col"
      bodyClassName="flex flex-1 flex-col"
    >
      {historyState ? (
        <p className={historyState.tone ? "py-10 text-center text-sm text-caution" : "py-10 text-center text-sm text-muted-foreground"} role={historyState.tone ? "status" : undefined}>
          {historyState.text}
        </p>
      ) : !bars ? (
        <div aria-busy="true" aria-label="Loading earnings">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-3 h-4 w-full max-w-lg" />
          <Skeleton className="mt-4 h-[224px] w-full" />
        </div>
      ) : (
        <StackedBarChart
          series={CHART_SERIES}
          bars={bars}
          format={formatUsd}
          axisFormat={axisUsd}
          summary={summary}
          totalLabel={period === "all" ? "Total since launch" : `Total, last ${info.label}`}
          emptyMessage={
            <>
              Nothing earned {info.phrase} yet. Premiums appear here {info.unit} by {info.unit} while covers are repriced, and exit discounts when an exit runs.
            </>
          }
          tableFirstColumn={info.unit === "hour" ? "Hour, UTC" : "Day, UTC"}
          tableNote={`${info.unit === "hour" ? "Hours" : "Days"} with no earnings are left out.`}
          navHint={`each ${info.unit}`}
          stale={stale}
        />
      )}
    </Panel>
  );
});

// ------------------------------------------------------------------------------------------------ tables

function Empty({ children, tone }: { children: ReactNode; tone?: "caution" }) {
  return (
    <p className={tone ? "px-5 py-6 text-center text-sm text-caution sm:px-6" : "px-5 py-8 text-center text-sm text-muted-foreground sm:px-6"} role={tone ? "status" : undefined}>
      {children}
    </p>
  );
}

function RowsSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <div className="space-y-2 px-5 pb-5 sm:px-6" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** The positions table with live health factors and rates: re-rendered every block, so it reads the chain itself. */
function LivePositions({ rows }: { rows: AnalyticsPositionRow[] }) {
  const { covers } = useLiveCovers();
  return <PositionsTable rows={rows} live={covers} />;
}

const PositionsPanel = memo(function PositionsPanel({ rows, historyState }: { rows?: AnalyticsPositionRow[]; historyState: HistoryState }) {
  return (
    <Panel title="Covered positions" description="Every cover the indexer has seen, active first." bodyClassName="p-0 sm:p-0" className="overflow-hidden" labelledBy="positions-heading">
      <div className="mt-4">
        {historyState ? (
          <Empty tone={historyState.tone}>{historyState.text}</Empty>
        ) : !rows ? (
          <RowsSkeleton rows={2} label="Loading positions" />
        ) : rows.length ? (
          <LivePositions rows={rows} />
        ) : (
          <Empty>No covered positions yet. Borrowers appear here when they opt in, with their trigger and what their cover costs.</Empty>
        )}
      </div>
    </Panel>
  );
});

const ExitsPanel = memo(function ExitsPanel({ rows, historyState }: { rows?: AnalyticsExitRow[]; historyState: HistoryState }) {
  return (
    <Panel title="Exits" description="Each exit, what it repaid, and what it saved the borrower." bodyClassName="p-0 sm:p-0" className="overflow-hidden" labelledBy="exits-heading">
      <div className="mt-4">
        {historyState ? (
          <Empty tone={historyState.tone}>{historyState.text}</Empty>
        ) : !rows ? (
          <RowsSkeleton rows={1} label="Loading exits" />
        ) : rows.length ? (
          <ExitTable rows={rows} borrowerColumn />
        ) : (
          <Empty>No exits yet. When a covered health factor reaches its trigger, the exit and what it saved against Aave&rsquo;s bonus appear here.</Empty>
        )}
      </div>
    </Panel>
  );
});

const References = memo(function References() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="The one liquidation on Aave Monad so far" description="What it cost the borrower, against a Shield exit on the same repayment." labelledBy="example-heading">
        <LiquidationExample />
      </Panel>
      <Panel title="Lenders on Monad" description="Shield covers Aave V3 today. Each other lender needs its own exit path and fork tests first." labelledBy="lenders-heading">
        <LendersList />
      </Panel>
    </div>
  );
});

// ------------------------------------------------------------------------------------------------ status lines

/** "Indexed to block N" under the period selector. */
function IndexedTo({ progress }: { progress?: number }) {
  return (
    <p className="text-[0.75rem] text-muted-foreground num" aria-live="off">
      {progress !== undefined ? `Indexed to block ${progress.toLocaleString("en-US")}` : envioUrl ? " " : "Indexer not configured"}
    </p>
  );
}

/** Says when the indexer trails the chain. Watches every block, so it is its own component. */
function IndexerLag({ progress }: { progress?: number }) {
  const { data: head } = useLiveBlock();
  const behind = progress !== undefined && head !== undefined ? Number(head) - progress : undefined;
  if (behind === undefined || behind <= BEHIND_BLOCKS) return null;
  return (
    <p className="rounded-[14px] border border-caution/40 bg-caution-soft px-4 py-3 text-sm" role="status">
      The indexer is <span className="num">{behind.toLocaleString("en-US")}</span> blocks behind the chain, so the newest activity may not be counted yet.
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ page

/** Panels whose props change rarely skip the page's re-render when the indexer answers. */
const LiveBlocksPanel = memo(LiveBlocks);
const KeeperPanel = memo(KeeperCost);

export function AnalyticsView() {
  const [period, setPeriod] = useState<Period>("all");
  const info = periodInfo(period);
  const now = useChainTime();
  const shareRead = useProtocolShare();
  const variables = useMemo(() => ({ hourFrom: hourFrom(now) }), [now]);
  const history = useIndexerQuery<AnalyticsData>(["analytics", variables.hourFrom], ANALYTICS_QUERY, variables);
  const meta = useIndexerQuery<IndexerMeta>(["indexer-meta"], INDEXER_META_QUERY);

  // When the last good answer arrived, for the "figures from HH:MM" line while the indexer is failing.
  const lastGood = useRef<{ data?: AnalyticsData; at: number }>({ at: 0 });
  if (history.data && history.data !== lastGood.current.data) lastGood.current = { data: history.data, at: Date.now() };
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const h = history.data;
  const failing = Boolean(envioUrl && history.error);
  const indexerError = history.error;
  const historyState = useMemo<HistoryState>(
    () =>
      !envioUrl
        ? { text: "Earnings and history come from the Envio indexer. Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to its GraphQL endpoint to show them." }
        : failing && !h
          ? { text: historyError(indexerError), tone: "caution" }
          : null,
    [failing, h, indexerError],
  );

  const totals = useMemo(() => (h ? totalsUsd(periodTotals(h, period, now)) : undefined), [h, period, now]);
  const allTotals = useMemo(() => (h ? totalsUsd(periodTotals(h, "all", now)) : undefined), [h, now]);
  const bars = useMemo(() => (h ? chartBars(period, h, now) : undefined), [h, period, now]);
  const share = shareRead.shareBps ?? h?.ProtocolConfig[0]?.protocolShareBps;
  const maxShare = shareRead.maxShareBps ?? DEFAULT_MAX_SHARE_BPS;
  const progress = meta.data?._meta[0]?.progressBlock;
  // More candidates than the sample: reprices inside an exit or an opt-out are dropped once their receipts are read.
  const repriceTxs = useMemo(() => latestTxHashes(h?.recentReprices ?? [], COST_SAMPLE * 3), [h]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
            <TokenIcon symbol="MON" size={18} />
            {isFork ? "Local fork of Monad mainnet" : "Monad mainnet"}, public data
          </p>
          <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.02em]">Analytics</h1>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            What Shield earns, who earns it, and the keeper&rsquo;s work block by block. Earnings come from the Envio indexer; live figures come from Monad. No wallet
            needed.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <PeriodSelect value={period} onChange={setPeriod} />
          <IndexedTo progress={progress} />
        </div>
      </div>

      {!isDeployed && (
        <p className="panel px-5 py-4 text-sm text-muted-foreground" role="status">
          This build has no Shield contract addresses, so live figures are off. Set the NEXT_PUBLIC_SHIELD_* variables or run scripts/web-env.sh.
        </p>
      )}
      {failing && h && hydrated && (
        <p className="flex items-start gap-2 rounded-[14px] border border-caution/40 bg-caution-soft px-4 py-3 text-sm" role="status">
          <RefreshCw className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
          <span>
            {historyError(history.error)} The earnings below are from its last answer, at {formatClock(lastGood.current.at / 1000)}, and update when it answers again.
          </span>
        </p>
      )}
      {!failing && <IndexerLag progress={progress} />}

      <KeyFigures totals={totals} period={period} shareBps={share} maxShareBps={maxShare} historyState={historyState} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <EarningsChart period={period} bars={bars} stale={failing} historyState={historyState} />
        <Panel title="Earnings breakdown" description="Who earned what, for the period and since launch." labelledBy="breakdown-heading">
          {historyState ? (
            <p className={historyState.tone ? "text-sm text-caution" : "text-sm text-muted-foreground"}>{historyState.text}</p>
          ) : (
            <Breakdown period={period} current={totals} all={allTotals} />
          )}
          <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
            Liquidity providers earn {share !== undefined ? formatBps(10_000 - share) : "the rest"} of every premium and the whole exit discount;{" "}
            {share !== undefined ? formatBps(share) : "a share"} of premiums goes to the protocol treasury, capped at {formatBps(maxShare)} in the contract.
          </p>
        </Panel>
      </div>

      <LiveBlocksPanel repricer={shield.repricer} shareBps={share} />

      <KeeperPanel reprices={totals?.reprices} phrase={info.phrase} txHashes={repriceTxs} exits={h?.Exit} historyState={historyState} />

      <PositionsPanel rows={h?.Position} historyState={historyState} />
      <ExitsPanel rows={h?.Exit} historyState={historyState} />
      <References />
    </div>
  );
}
