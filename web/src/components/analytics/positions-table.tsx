"use client";

import { HashLink } from "@/components/data/hash-link";
import { formatHf, formatUsd, toNumber } from "@/lib/format";
import { ratePerYear, type AnalyticsPositionRow } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { LiveCover } from "./use-live-protocol";

const th = "px-3 pb-2.5 font-medium first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";
const td = "px-3 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";

const STATUS: Record<AnalyticsPositionRow["status"], { text: string; dot: string; tone: string }> = {
  Protected: { text: "Protected", dot: "bg-safe", tone: "text-safe" },
  Unprotected: { text: "Lapsed", dot: "bg-caution", tone: "text-caution" },
  Exited: { text: "Exited", dot: "bg-muted-foreground", tone: "text-foreground" },
  OptedOut: { text: "Opted out", dot: "bg-border", tone: "text-muted-foreground" },
};

/**
 * Every cover the indexer knows, active first. Health factor and rate come live from the chain for active covers; for
 * closed ones the table shows the last reading the indexer kept, in muted type.
 */
export function PositionsTable({ rows, live }: { rows: AnalyticsPositionRow[]; live?: LiveCover[] }) {
  const byBorrower = new Map((live ?? []).map((c) => [c.borrower.toLowerCase(), c]));
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead>
          <tr className="border-b text-[0.75rem] text-muted-foreground">
            <th scope="col" className={th}>Borrower</th>
            <th scope="col" className={th}>Status</th>
            <th scope="col" className={`${th} text-right`}>Trigger</th>
            <th scope="col" className={`${th} text-right`}>Health factor</th>
            <th scope="col" className={`${th} text-right`}>Rate, a year</th>
            <th scope="col" className={`${th} text-right`}>Premium paid</th>
            <th scope="col" className={`${th} text-right`}>Reprices</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map((p) => {
            const s = STATUS[p.status];
            const active = p.status === "Protected" || p.status === "Unprotected";
            const c = active ? byBorrower.get(p.borrower.toLowerCase()) : undefined;
            const hf = c ? c.healthFactor : toNumber(BigInt(p.healthFactor || "0"), 18);
            const rate = active ? ratePerYear(c ? c.premiumPerBlock : p.premiumPerBlock) : undefined;
            return (
              <tr key={p.borrower} className="border-b last:border-b-0">
                <td className={td}>
                  <HashLink value={p.borrower} kind="address" />
                </td>
                <td className={td}>
                  <span className={cn("inline-flex items-center gap-1.5", s.tone)}>
                    <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
                    {s.text}
                  </span>
                </td>
                <td className={`${td} text-right`}>{(p.trigger / 1e4).toFixed(2)}</td>
                <td className={cn(td, "text-right", !c && "text-muted-foreground")} title={c ? "Live from Aave" : "Last reading the indexer kept"}>
                  {hf > 0 ? formatHf(hf) : "n/a"}
                </td>
                <td className={`${td} text-right`}>{rate !== undefined ? formatUsd(rate) : <span className="text-muted-foreground">None</span>}</td>
                <td className={`${td} text-right`}>{formatUsd(toNumber(BigInt(p.premiumPaid || "0"), 18))}</td>
                <td className={`${td} text-right`}>{p.repriceCount.toLocaleString("en-US")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
