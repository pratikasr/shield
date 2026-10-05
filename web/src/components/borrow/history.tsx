"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { HashLink } from "@/components/data/hash-link";
import { Skeleton } from "@/components/ui/skeleton";
import { BORROWER_HISTORY, envioQuery, type ExitRow, type PositionRow, type RepriceRow } from "@/lib/envio";
import { envioUrl } from "@/lib/env";
import type { ChainExit } from "@/hooks/useChainExit";
import { formatHf, formatUsd, timeAgo, toNumber } from "@/lib/format";

export interface BorrowerHistory {
  Position: PositionRow[];
  Reprice: RepriceRow[];
  Exit: ExitRow[];
}

export function useBorrowerHistory(user?: Address) {
  return useQuery({
    queryKey: ["borrower-history", user],
    queryFn: () => envioQuery<BorrowerHistory>(BORROWER_HISTORY, { borrower: user!.toLowerCase() }),
    enabled: Boolean(user && envioUrl),
    refetchInterval: 2_000,
  });
}

export function ExitHistory({
  history,
  isLoading,
  error,
  chainExit,
}: {
  history?: BorrowerHistory;
  isLoading: boolean;
  error: Error | null;
  /** An exit read from the chain that the indexer may not have yet. */
  chainExit?: ChainExit | null;
}) {
  const indexed = history?.Exit ?? [];
  const pending: ExitRow[] =
    chainExit && !indexed.some((e) => e.txHash.toLowerCase() === chainExit.txHash.toLowerCase())
      ? [
          {
            borrower: "",
            repaid: chainExit.repaid.toString(),
            seized: "0",
            savedVsAave: chainExit.savedVsAave.toString(),
            healthFactorBefore: chainExit.healthFactorBefore.toString(),
            healthFactorAfter: chainExit.healthFactorAfter.toString(),
            flashLoanAmount: "0",
            blockNumber: chainExit.blockNumber.toString(),
            timestamp: "",
            txHash: chainExit.txHash,
          },
        ]
      : [];
  const rows = [...pending, ...indexed];
  return (
    <section aria-labelledby="exits-heading" className="rounded-xl border bg-card">
      <h2 id="exits-heading" className="px-5 pt-5 text-base font-semibold sm:px-7">
        Exits
      </h2>
      {!envioUrl && rows.length === 0 ? (
        <p className="px-5 pb-5 pt-2 text-sm text-muted-foreground sm:px-7">
          History comes from the Envio indexer. Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to its GraphQL endpoint to show it.
        </p>
      ) : error && rows.length === 0 ? (
        <p className="px-5 pb-5 pt-2 text-sm text-danger sm:px-7" role="alert">
          {error.message}
        </p>
      ) : isLoading && rows.length === 0 ? (
        <div className="space-y-2 px-5 pb-5 pt-3 sm:px-7" aria-busy="true" aria-label="Loading exits">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 pb-5 pt-2 text-sm text-muted-foreground sm:px-7">
          No exits yet. If your health factor reaches the trigger, the exit and the penalty it avoided appear here.
        </p>
      ) : (
        <div className="overflow-x-auto px-2 pb-3 sm:px-4">
          <table className="mt-3 w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="text-[0.8125rem] text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-normal">When</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Debt repaid</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Penalty avoided</th>
                <th scope="col" className="px-3 py-2 text-right font-normal">Health factor</th>
                <th scope="col" className="px-3 py-2 font-normal">Transaction</th>
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((e) => (
                <tr key={e.txHash} className="border-t">
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {e.timestamp ? timeAgo(Number(e.timestamp)) : `Block ${Number(e.blockNumber).toLocaleString("en-US")}`}
                  </td>
                  <td className="px-3 py-2.5 text-right">{formatUsd(toNumber(BigInt(e.repaid), 6))}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-safe">{formatUsd(toNumber(BigInt(e.savedVsAave), 6))}</td>
                  <td className="px-3 py-2.5 text-right">
                    {formatHf(toNumber(BigInt(e.healthFactorBefore), 18))} to {formatHf(toNumber(BigInt(e.healthFactorAfter), 18))}
                  </td>
                  <td className="px-3 py-2.5">
                    <HashLink value={e.txHash} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function RepriceHistory({ history }: { history?: BorrowerHistory }) {
  if (!history?.Reprice.length) return null;
  return (
    <section aria-labelledby="reprices-heading" className="rounded-xl border bg-card">
      <h2 id="reprices-heading" className="px-5 pt-5 text-base font-semibold sm:px-7">
        Recent repricing
      </h2>
      <p className="px-5 pt-1 text-[0.8125rem] text-muted-foreground sm:px-7">Each row is one block&rsquo;s reprice transaction from the keeper.</p>
      <div className="overflow-x-auto px-2 pb-3 sm:px-4">
        <table className="mt-3 w-full min-w-[34rem] text-left text-sm">
          <thead>
            <tr className="text-[0.8125rem] text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-normal">Block</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Charged</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Next block rate</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">HF</th>
              <th scope="col" className="px-3 py-2 font-normal">Transaction</th>
            </tr>
          </thead>
          <tbody className="num">
            {history.Reprice.slice(0, 8).map((r) => (
              <tr key={r.txHash + r.blockNumber} className="border-t">
                <td className="px-3 py-2">{Number(r.blockNumber).toLocaleString("en-US")}</td>
                <td className="px-3 py-2 text-right">{formatUsd(toNumber(BigInt(r.charged), 18))}</td>
                <td className="px-3 py-2 text-right">{formatUsd(toNumber(BigInt(r.premiumPerBlock), 18))}</td>
                <td className="px-3 py-2 text-right">{formatHf(toNumber(BigInt(r.healthFactor), 18))}</td>
                <td className="px-3 py-2">
                  <HashLink value={r.txHash} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
