"use client";

import { AddressAvatar } from "@/components/data/avatar";
import { HashLink } from "@/components/data/hash-link";
import { Info } from "@/components/data/info";
import { Panel, Stat } from "@/components/data/stat";
import { Skeleton } from "@/components/ui/skeleton";
import { exitLanding, median, type AnalyticsExitRow } from "@/lib/analytics";
import { isFork } from "@/lib/env";
import { formatHf, formatToken, formatUsd, truncateHex } from "@/lib/format";
import { useMonPrice, useRepriceCost } from "./use-live-protocol";

/** Reprice transactions averaged for the cost figures. */
export const COST_SAMPLE = 5;

const th = "px-3 pb-2.5 font-medium first:pl-0 last:pr-0";
const td = "px-3 py-2.5 first:pl-0 last:pr-0";

/**
 * What the keeper does and what it costs: reprices in the period, gas and MON per reprice from recent receipts, and for
 * each exit the health factor it ran at against the borrower's trigger.
 */
export function KeeperCost({
  reprices,
  phrase,
  txHashes,
  exits,
  historyState,
}: {
  /** Reprices in the selected period, from the indexer; undefined while loading. */
  reprices?: number;
  phrase: string;
  /** Latest reprice transaction hashes, newest first. */
  txHashes: string[];
  exits?: AnalyticsExitRow[];
  /** A sentence to show instead of indexer data (not configured, failing), or null. */
  historyState: { text: string; tone?: "caution" } | null;
}) {
  const { cost, isLoading } = useRepriceCost(txHashes, COST_SAMPLE);
  const mon = useMonPrice();
  const landings = (exits ?? []).slice(0, 5).map((e) => ({ e, ...exitLanding(e) }));
  const typicalGap = median(landings.map((l) => l.belowBy));
  const noReprices = !historyState && reprices !== undefined && txHashes.length === 0;
  const costValue = (v: () => string) => (historyState ? "n/a" : cost ? v() : isLoading || reprices === undefined ? <Skeleton className="h-7 w-24" /> : "None yet");

  return (
    <Panel title="Keeper and cost" description="The keeper reprices covers and runs exits; anyone can run an exit when its conditions hold." labelledBy="keeper-heading">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            <Stat
              label="Reprices"
              value={historyState ? "n/a" : reprices !== undefined ? reprices.toLocaleString("en-US") : <Skeleton className="h-7 w-16" />}
              hint={phrase.charAt(0).toUpperCase() + phrase.slice(1)}
            />
            <Stat
              label={
                <>
                  Gas per reprice
                  <Info>
                    Gas over the latest {COST_SAMPLE} reprice transactions the keeper sent to the Repricer, divided by the covers they repriced (one transaction can
                    reprice several). Reprices inside an exit or an opt-out are left out.
                  </Info>
                </>
              }
              value={costValue(() => Math.round(cost!.gasPerReprice).toLocaleString("en-US"))}
              hint={cost ? `Over ${cost.txs} transaction${cost.txs === 1 ? "" : "s"}` : noReprices ? "No reprices yet" : "From receipts"}
            />
            <Stat
              label="Cost per reprice"
              value={costValue(() => formatToken(cost!.monPerReprice, "MON"))}
              hint={cost && mon ? `About ${formatUsd(cost.monPerReprice * mon)} at Pyth's MON price` : cost ? `At ${cost.gasPriceGwei.toFixed(0)} gwei` : "Gas times its price"}
            />
            <Stat label="Gas price paid" value={costValue(() => `${cost!.gasPriceGwei.toFixed(0)} gwei`)} hint="Average, same transactions" />
          </dl>
          <p className="mt-5 text-[0.8125rem] leading-relaxed text-muted-foreground">
            {isFork
              ? "On this local fork a receipt reports the gas a transaction used. On Monad it reports the gas limit, because Monad bills the limit; the keeper sets each limit from a measurement, not a padded guess."
              : "Monad bills the gas limit, and a receipt's gas used equals the limit, so these figures are the limits the keeper set. Each one comes from a measurement, not a padded guess."}
          </p>
        </div>

        <div className="min-w-0">
          <h3 className="flex items-center gap-1 text-sm font-semibold">
            How close to the trigger exits ran
            <Info>
              An exit can run once the health factor is at or below the borrower&rsquo;s trigger. The keeper checks every proposed block, so the gap is how far the health
              factor fell between the last check above the trigger and the block the exit landed in. Aave liquidates at 1.00.
            </Info>
          </h3>
          {historyState ? (
            <p className={historyState.tone ? "mt-3 text-sm text-caution" : "mt-3 text-sm text-muted-foreground"} role={historyState.tone ? "status" : undefined}>
              {historyState.text}
            </p>
          ) : !exits ? (
            <div className="mt-3 space-y-2" aria-busy="true" aria-label="Loading exits">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : landings.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No exits yet. Each exit appears here with the health factor it ran at, next to the borrower&rsquo;s trigger.</p>
          ) : (
            <>
              {typicalGap !== undefined && (
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                  {landings.length === 1 ? "The exit" : `Median of the latest ${landings.length} exits:`} ran{" "}
                  <span className="font-medium text-foreground num">{Math.abs(typicalGap).toFixed(4)}</span> {typicalGap >= 0 ? "below" : "above"} the trigger.
                </p>
              )}
              {/* On phones the table scrolls edge to edge inside the panel. */}
              <div className="relative -mx-5 mt-3 overflow-x-auto px-5 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
                <table className="w-full min-w-[26rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                  <thead>
                    <tr className="border-b text-[0.75rem] text-muted-foreground">
                      <th scope="col" className={th}>Borrower</th>
                      <th scope="col" className={`${th} text-right`}>Trigger</th>
                      <th scope="col" className={`${th} text-right`}>At exit</th>
                      <th scope="col" className={`${th} text-right`}>Below trigger</th>
                      <th scope="col" className={th}>Transaction</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {landings.map(({ e, trigger, hf, belowBy }) => (
                      <tr key={e.txHash} className="border-b last:border-b-0">
                        <td className={td}>
                          <span className="inline-flex items-center gap-2">
                            <AddressAvatar address={e.borrower} size={18} />
                            {truncateHex(e.borrower, 6, 4)}
                          </span>
                        </td>
                        <td className={`${td} text-right text-caution`}>{trigger.toFixed(2)}</td>
                        <td className={`${td} text-right`}>{formatHf(hf)}</td>
                        <td className={`${td} text-right`}>{belowBy >= 0 ? belowBy.toFixed(4) : `${Math.abs(belowBy).toFixed(4)} above`}</td>
                        <td className={td}>
                          <HashLink value={e.txHash} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
