"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  emptyTotals,
  hourFrom,
  latestTxHashes,
  periodInfo,
  periodTotals,
  totalsUsd,
  usdHeadline,
  type AnalyticsData,
  type IndexerMeta,
  type Period,
  type TotalsUsd,
} from "@/lib/analytics";
import { historyError } from "@/lib/envio";
import { envioUrl, isDeployed, isFork, shield } from "@/lib/env";
import { formatBps, formatClock, formatUsd } from "@/lib/format";
import { KeeperCost, COST_SAMPLE } from "./keeper-cost";
import { LendersList } from "./lenders";
import { LiquidationExample } from "./liquidation-example";
import { LiveBlocks } from "./live-blocks";
import { PeriodSelect } from "./period-select";
import { PositionsTable } from "./positions-table";
import { useChainTime, useLiveProtocol } from "./use-live-protocol";

/** The chart's series, in stack order from the baseline. Neutral tones by lightness; colour is kept for meaning. */
const CHART_SERIES: ChartSeries[] = [
  { key: SERIES[0].key, label: SERIES[0].label, fill: "fill-foreground", swatch: "bg-foreground" },
  { key: SERIES[1].key, label: SERIES[1].label, fill: "fill-muted-foreground/60", swatch: "bg-muted-foreground/60" },
  { key: SERIES[2].key, label: SERIES[2].label, fill: "fill-muted-foreground", swatch: "bg-muted-foreground" },
];

/** The indexer is called behind when it trails the chain by more than this many blocks (about 30 seconds). */
const BEHIND_BLOCKS = 100;

const utcDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const utcDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const hh = (sec: number) => `${String(new Date(sec * 1000).getUTCHours()).padStart(2, "0")}:00`;

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

function chartSummary(period: Period, bars: ChartBar[]): string {
  const info = periodInfo(period);
  const totals = SERIES.map((_, i) => bars.reduce((s, b) => s + (b.values[i] ?? 0), 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const withValue = bars.filter((b) => barTotal({ start: 0, values: b.values as [number, number, number] }) > 0);
  const best = withValue.reduce<ChartBar | undefined>((m, b) => (!m || barTotal({ start: 0, values: b.values as [number, number, number] }) > barTotal({ start: 0, values: m.values as [number, number, number] }) ? b : m), undefined);
  const unit = info.unit === "hour" ? "hour" : "day";
  if (!total) return `Stacked bar chart of Shield's earnings by ${unit}, ${info.phrase}: nothing earned yet.`;
  return (
    `Stacked bar chart of Shield's earnings by ${unit}, ${info.phrase}, times in UTC. Total ${formatUsd(total)}: ` +
    SERIES.map((s, i) => `${s.label.toLowerCase()} ${formatUsd(totals[i]!)}`).join(", ") +
    `. ${withValue.length} of ${bars.length} ${unit}s had earnings` +
    (best ? `; the most was ${best.title}, ${formatUsd(barTotal({ start: 0, values: best.values as [number, number, number] }))}.` : ".")
  );
}

function Headline({ value }: { value: number | undefined }) {
  if (value === undefined) return <Skeleton className="h-8 w-24" />;
  return <>{usdHeadline(value).text}</>;
}

/** A hint line that carries the exact figure when the headline had to say "<$0.01". */
function exactHint(value: number | undefined, phrase: string, rest: ReactNode): ReactNode {
  const exact = value !== undefined ? usdHeadline(value).exact : undefined;
  return exact ? (
    <>
      <span className="num">{exact}</span> {phrase}. {rest}
    </>
  ) : (
    rest
  );
}

/**
 * One key figure. Each cell is a three-row subgrid (label, value, hint) of the row it sits in, so values line up
 * across a row however many lines a label wraps to.
 */
function KpiCell({ children }: { children: ReactNode }) {
  return <div className="row-span-3 grid min-w-0 grid-rows-subgrid gap-y-0 bg-card px-4 py-5 sm:px-6 [&_dt]:self-start">{children}</div>;
}

function Breakdown({ period, current, all, pendingProtocol, loading }: { period: Period; current?: TotalsUsd; all?: TotalsUsd; pendingProtocol?: number; loading: boolean }) {
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
        <tbody className="num" aria-busy={loading || undefined}>
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
                <Info>
                  Read live from the Repricer on the proposed block. The next sweep pays it to the treasury in whole micro-USDC; anyone can call the sweep.
                </Info>
              </span>
            </th>
            <td colSpan={period === "all" ? 1 : 2} className="py-2.5 pl-3 text-right whitespace-nowrap">
              {pendingProtocol !== undefined ? (
                <>
                  {formatUsd(pendingProtocol)} <span className="text-muted-foreground">now</span>
                </>
              ) : (
                <Skeleton className="ml-auto h-4 w-16" />
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Empty({ children, tone }: { children: ReactNode; tone?: "caution" }) {
  return (
    <p className={tone ? "px-5 py-6 text-center text-sm text-caution sm:px-6" : "px-5 py-8 text-center text-sm text-muted-foreground sm:px-6"} role={tone ? "status" : undefined}>
      {children}
    </p>
  );
}

export function AnalyticsView() {
  const [period, setPeriod] = useState<Period>("all");
  const info = periodInfo(period);
  const now = useChainTime();
  const live = useLiveProtocol();
  const { data: head } = useLiveBlock();
  const history = useIndexerQuery<AnalyticsData>(["analytics", hourFrom(now)], ANALYTICS_QUERY, { hourFrom: hourFrom(now) });
  const meta = useIndexerQuery<IndexerMeta>(["indexer-meta"], INDEXER_META_QUERY);

  // When the last good answer arrived, for the "figures from HH:MM" line while the indexer is failing.
  const lastGood = useRef<{ data?: AnalyticsData; at: number }>({ at: 0 });
  if (history.data && history.data !== lastGood.current.data) lastGood.current = { data: history.data, at: Date.now() };
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const h = history.data;
  const failing = Boolean(envioUrl && history.error);
  const historyState: { text: string; tone?: "caution" } | null = !envioUrl
    ? { text: "Earnings and history come from the Envio indexer. Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to its GraphQL endpoint to show them." }
    : failing && !h
      ? { text: historyError(history.error), tone: "caution" }
      : null;

  const totals = useMemo(() => (h ? totalsUsd(periodTotals(h, period, now)) : undefined), [h, period, now]);
  const allTotals = useMemo(() => (h ? totalsUsd(h.all[0] ? periodTotals(h, "all", now) : emptyTotals()) : undefined), [h, now]);
  const bars = useMemo(() => (h ? chartBars(period, h, now) : undefined), [h, period, now]);
  const share = live.shareBps ?? h?.ProtocolConfig[0]?.protocolShareBps;
  const shareText = share !== undefined ? `${formatBps(share)} of premiums` : "A share of premiums";
  const progress = meta.data?._meta[0]?.progressBlock;
  const behind = progress !== undefined && head !== undefined ? Number(head) - progress : undefined;
  // More candidates than the sample: reprices inside an exit or an opt-out are dropped once their receipts are read.
  const repriceTxs = useMemo(() => latestTxHashes(h?.recentReprices ?? [], COST_SAMPLE * 3), [h]);

  const v = (x: number | undefined) => (historyState ? "n/a" : <Headline value={x} />);
  const hintOr = (node: ReactNode) => (historyState ? "Indexer unavailable" : totals ? node : <Skeleton className="h-4 w-28" />);

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
          <p className="text-[0.75rem] text-muted-foreground num" aria-live="off">
            {progress !== undefined ? `Indexed to block ${progress.toLocaleString("en-US")}` : envioUrl ? " " : "Indexer not configured"}
          </p>
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
      {!failing && behind !== undefined && behind > BEHIND_BLOCKS && (
        <p className="rounded-[14px] border border-caution/40 bg-caution-soft px-4 py-3 text-sm" role="status">
          The indexer is <span className="num">{behind.toLocaleString("en-US")}</span> blocks behind the chain, so the newest activity may not be counted yet.
        </p>
      )}

      <section aria-label={`Key figures, ${info.phrase}`} className="panel overflow-hidden">
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:grid-cols-6">
          <KpiCell>
            <Stat
              className="contents"
              size="lg"
              label={
                <span>
                  Protocol earnings{" "}
                  <Info>
                    The protocol&rsquo;s share of every premium, split when the premium is charged and paid to the treasury at each sweep. The registry caps the share at{" "}
                    {formatBps(live.maxShareBps ?? 2000)}; the exit discount is never shared.
                  </Info>
                </span>
              }
              value={v(totals?.premiumToProtocol)}
              hint={hintOr(exactHint(totals?.premiumToProtocol, info.phrase, `${shareText} now`))}
            />
          </KpiCell>
          <KpiCell>
            <Stat
              className="contents"
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
              value={v(totals?.lpEarnings)}
              hint={hintOr(exactHint(totals?.lpEarnings, info.phrase, "Premiums and exit discounts"))}
            />
          </KpiCell>
          <KpiCell>
            <Stat
              className="contents"
              size="lg"
              label="Penalty avoided"
              tone={totals && totals.savedVsAave > 0 ? "safe" : undefined}
              value={v(totals?.savedVsAave)}
              hint={hintOr(exactHint(totals?.savedVsAave, info.phrase, "For borrowers, against Aave's bonus on the same repayments"))}
            />
          </KpiCell>
          <KpiCell>
            <Stat
              className="contents"
              size="lg"
              label="Exits"
              value={historyState ? "n/a" : totals ? totals.exits.toLocaleString("en-US") : <Skeleton className="h-8 w-12" />}
              hint={hintOr(totals && totals.exits > 0 ? `${formatUsd(totals.debtRepaid)} of debt repaid` : `None ${info.phrase}`)}
            />
          </KpiCell>
          <KpiCell>
            <Stat
              className="contents"
              size="lg"
              label={
                <span>
                  Debt protected now{" "}
                  <Info>
                    The USDC debt on Aave of every paid-up cover, read live: the registry&rsquo;s active borrowers, then each one&rsquo;s USDC variable debt. Lapsed covers
                    are left out.
                  </Info>
                </span>
              }
              value={!isDeployed ? "n/a" : live.protectedDebt !== undefined ? formatUsd(live.protectedDebt) : <Skeleton className="h-8 w-24" />}
              hint={live.activeCount === undefined ? "Live from Aave" : live.activeCount === 0 ? "No active covers" : "Live from Aave"}
            />
          </KpiCell>
          <KpiCell>
            <Stat
              className="contents"
              size="lg"
              label="Active covers"
              value={!isDeployed ? "n/a" : live.activeCount !== undefined ? live.activeCount.toLocaleString("en-US") : <Skeleton className="h-8 w-10" />}
              hint={
                live.lapsedCount
                  ? `${live.lapsedCount} lapsed, out of prepaid premium`
                  : totals
                    ? `${totals.optIns.toLocaleString("en-US")} opt-in${totals.optIns === 1 ? "" : "s"} ${info.phrase}`
                    : "Live from the registry"
              }
            />
          </KpiCell>
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
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
              summary={chartSummary(period, bars)}
              totalLabel={period === "all" ? "Total since launch" : `Total, last ${info.label}`}
              emptyMessage={
                <>
                  Nothing earned {info.phrase} yet. Premiums appear here {info.unit === "hour" ? "hour" : "day"} by {info.unit === "hour" ? "hour" : "day"} while covers
                  are repriced, and exit discounts when an exit runs.
                </>
              }
              tableFirstColumn={info.unit === "hour" ? "Hour, UTC" : "Day, UTC"}
              tableNote={`${info.unit === "hour" ? "Hours" : "Days"} with no earnings are left out.`}
              navHint={info.unit === "hour" ? "each hour" : "each day"}
              stale={failing}
            />
          )}
        </Panel>

        <Panel title="Earnings breakdown" description="Who earned what, for the period and since launch." labelledBy="breakdown-heading">
          {historyState ? (
            <p className={historyState.tone ? "text-sm text-caution" : "text-sm text-muted-foreground"}>{historyState.text}</p>
          ) : (
            <Breakdown period={period} current={totals} all={allTotals} pendingProtocol={live.pendingProtocol} loading={!h} />
          )}
          <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
            Liquidity providers earn {share !== undefined ? formatBps(10_000 - share) : "the rest"} of every premium and the whole exit discount;{" "}
            {share !== undefined ? formatBps(share) : "a share"} of premiums goes to the protocol treasury, capped at {formatBps(live.maxShareBps ?? 2000)} in the
            contract.
          </p>
        </Panel>
      </div>

      <LiveBlocks repricer={shield.repricer} shareBps={share} />

      <KeeperCost reprices={totals?.reprices} phrase={info.phrase} txHashes={repriceTxs} exits={h?.Exit} historyState={historyState} />

      <Panel title="Covered positions" description="Every cover the indexer has seen, active first." bodyClassName="p-0 sm:p-0" className="overflow-hidden" labelledBy="positions-heading">
        <div className="mt-4">
          {historyState ? (
            <Empty tone={historyState.tone}>{historyState.text}</Empty>
          ) : !h ? (
            <div className="space-y-2 px-5 pb-5 sm:px-6" aria-busy="true" aria-label="Loading positions">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : h.Position.length ? (
            <PositionsTable rows={h.Position} live={live.covers} />
          ) : (
            <Empty>No covered positions yet. Borrowers appear here when they opt in, with their trigger and what their cover costs.</Empty>
          )}
        </div>
      </Panel>

      <Panel title="Exits" description="Each exit, what it repaid, and what it saved the borrower." bodyClassName="p-0 sm:p-0" className="overflow-hidden" labelledBy="exits-heading">
        <div className="mt-4">
          {historyState ? (
            <Empty tone={historyState.tone}>{historyState.text}</Empty>
          ) : !h ? (
            <div className="space-y-2 px-5 pb-5 sm:px-6" aria-busy="true" aria-label="Loading exits">
              <Skeleton className="h-10 w-full" />
            </div>
          ) : h.Exit.length ? (
            <ExitTable rows={h.Exit} borrowerColumn />
          ) : (
            <Empty>No exits yet. When a covered health factor reaches its trigger, the exit and what it saved against Aave&rsquo;s bonus appear here.</Empty>
          )}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="The one liquidation on Aave Monad so far" description="What it cost the borrower, against a Shield exit on the same repayment." labelledBy="example-heading">
          <LiquidationExample />
        </Panel>
        <Panel title="Lenders on Monad" description="Shield covers Aave V3 today. Each other lender needs its own exit path and fork tests first." labelledBy="lenders-heading">
          <LendersList />
        </Panel>
      </div>
    </div>
  );
}
