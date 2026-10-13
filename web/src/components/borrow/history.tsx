"use client";

import type { Address } from "viem";
import { HashLink } from "@/components/data/hash-link";
import { BORROWER_HISTORY, type ExitRow, type PositionRow, type RepriceRow } from "@/lib/envio";
import type { ChainExit } from "@/hooks/useChainExit";
import { useIndexerQuery } from "@/hooks/useIndexer";
import { formatHf, formatUsd, timeAgo, toNumber } from "@/lib/format";

export interface BorrowerHistory {
  Position: PositionRow[];
  Reprice: RepriceRow[];
  Exit: ExitRow[];
}

export function useBorrowerHistory(user?: Address) {
  return useIndexerQuery<BorrowerHistory>(["borrower-history", user], BORROWER_HISTORY, { borrower: user?.toLowerCase() }, Boolean(user));
}

/** The indexer's exits plus one read straight from the chain that the indexer may not have yet. */
export function exitRows(history?: BorrowerHistory, chainExit?: ChainExit | null): ExitRow[] {
  const indexed = history?.Exit ?? [];
  const pending: ExitRow[] =
    chainExit && !indexed.some((e) => e.txHash.toLowerCase() === chainExit.txHash.toLowerCase())
      ? [
          {
            borrower: "",
            collateral: chainExit.collateral,
            repaid: chainExit.repaid.toString(),
            seized: chainExit.seized.toString(),
            savedVsAave: chainExit.savedVsAave.toString(),
            healthFactorBefore: chainExit.healthFactorBefore.toString(),
            healthFactorAfter: chainExit.healthFactorAfter.toString(),
            flashLoanAmount: chainExit.flashLoanAmount.toString(),
            blockNumber: chainExit.blockNumber.toString(),
            timestamp: "",
            txHash: chainExit.txHash,
          },
        ]
      : [];
  return [...pending, ...indexed];
}

const th = "px-3 pb-2.5 font-medium first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";
const td = "px-3 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";

/** The saved figure's column header, the same words everywhere an exit is listed. */
export const SAVED_LABEL = "Saved against Aave's bonus on the same repayment";

export function ExitTable({ rows, borrowerColumn }: { rows: ExitRow[]; borrowerColumn?: boolean }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead>
          <tr className="border-b text-[0.75rem] text-muted-foreground">
            <th scope="col" className={th}>{borrowerColumn ? "Borrower" : "When"}</th>
            <th scope="col" className={`${th} text-right`}>Debt repaid</th>
            <th scope="col" className={`${th} max-w-[11rem] text-right whitespace-normal!`}>{SAVED_LABEL}</th>
            <th scope="col" className={`${th} text-right`}>Health factor</th>
            <th scope="col" className={th}>Transaction</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map((e) => (
            <tr key={e.txHash} className="border-b last:border-b-0">
              <td className={`${td} text-muted-foreground`}>
                {borrowerColumn ? (
                  <HashLink value={e.borrower} kind="address" />
                ) : e.timestamp ? (
                  timeAgo(Number(e.timestamp))
                ) : (
                  `Block ${Number(e.blockNumber).toLocaleString("en-US")}`
                )}
              </td>
              <td className={`${td} text-right`}>{formatUsd(toNumber(BigInt(e.repaid), 6))}</td>
              <td className={`${td} text-right font-semibold text-safe`}>{formatUsd(toNumber(BigInt(e.savedVsAave), 6))}</td>
              <td className={`${td} text-right`}>
                {formatHf(toNumber(BigInt(e.healthFactorBefore), 18))} to {formatHf(toNumber(BigInt(e.healthFactorAfter), 18))}
              </td>
              <td className={td}>
                <HashLink value={e.txHash} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
