"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { HashLink } from "@/components/data/hash-link";
import { Panel } from "@/components/data/stat";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BORROWER_HISTORY, envioQuery, type ExitRow, type PositionRow, type RepriceRow } from "@/lib/envio";
import { envioUrl } from "@/lib/env";
import type { ChainExit } from "@/hooks/useChainExit";
import { BLOCKS_PER_DAY } from "@/lib/economics";
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

/** The indexer's exits plus one read straight from the chain that the indexer may not have yet. */
export function exitRows(history?: BorrowerHistory, chainExit?: ChainExit | null): ExitRow[] {
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
  return [...pending, ...indexed];
}

const th = "px-3 pb-2.5 font-medium first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";
const td = "px-3 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-muted-foreground sm:px-6">{children}</p>;
}

function ExitTable({ rows }: { rows: ExitRow[] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[38rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead>
          <tr className="border-b text-[0.75rem] text-muted-foreground">
            <th scope="col" className={th}>When</th>
            <th scope="col" className={`${th} text-right`}>Debt repaid</th>
            <th scope="col" className={`${th} text-right`}>Penalty avoided</th>
            <th scope="col" className={`${th} text-right`}>Health factor</th>
            <th scope="col" className={th}>Transaction</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map((e) => (
            <tr key={e.txHash} className="border-b last:border-b-0">
              <td className={`${td} text-muted-foreground`}>
                {e.timestamp ? timeAgo(Number(e.timestamp)) : `Block ${Number(e.blockNumber).toLocaleString("en-US")}`}
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

function RepriceTable({ rows }: { rows: RepriceRow[] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[38rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead>
          <tr className="border-b text-[0.75rem] text-muted-foreground">
            <th scope="col" className={th}>Block</th>
            <th scope="col" className={`${th} text-right`}>Rate, a year</th>
            <th scope="col" className={`${th} text-right`}>Charged</th>
            <th scope="col" className={`${th} text-right`}>Health factor</th>
            <th scope="col" className={th}>Transaction</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.slice(0, 10).map((r) => (
            <tr key={r.txHash + r.blockNumber} className="border-b last:border-b-0">
              <td className={td}>{Number(r.blockNumber).toLocaleString("en-US")}</td>
              <td className={`${td} text-right`}>{formatUsd(toNumber(BigInt(r.premiumPerBlock), 18) * BLOCKS_PER_DAY * 365)}</td>
              <td className={`${td} text-right text-muted-foreground`}>{formatUsd(toNumber(BigInt(r.charged), 18))}</td>
              <td className={`${td} text-right`}>{formatHf(toNumber(BigInt(r.healthFactor), 18))}</td>
              <td className={td}>
                <HashLink value={r.txHash} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Exits and the per-block repricing log, one panel with two tabs. */
export function ActivityPanel({
  history,
  isLoading,
  error,
  chainExit,
}: {
  history?: BorrowerHistory;
  isLoading: boolean;
  error: Error | null;
  chainExit?: ChainExit | null;
}) {
  const exits = exitRows(history, chainExit);
  const reprices = history?.Reprice ?? [];
  const body = (content: React.ReactNode, empty: string) =>
    !envioUrl && exits.length === 0 ? (
      <Empty>History comes from the Envio indexer. Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to its GraphQL endpoint to show it.</Empty>
    ) : error && exits.length === 0 ? (
      <p className="px-5 py-6 text-sm text-danger sm:px-6" role="alert">
        Could not read history from the indexer: {error.message}
      </p>
    ) : isLoading && exits.length === 0 ? (
      <div className="space-y-2 px-5 py-4 sm:px-6" aria-busy="true" aria-label="Loading activity">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    ) : (
      content ?? <Empty>{empty}</Empty>
    );

  return (
    <Panel bodyClassName="p-0 sm:p-0" className="overflow-hidden">
      <Tabs defaultValue="exits">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
          <h2 className="text-base font-semibold">Activity</h2>
          <TabsList>
            <TabsTrigger value="exits">Exits{exits.length ? ` (${exits.length})` : ""}</TabsTrigger>
            <TabsTrigger value="reprices">Repricing</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="exits" className="mt-4">
          {body(exits.length ? <ExitTable rows={exits} /> : null, "No exits yet. If your health factor reaches the trigger, the exit and the penalty it avoided appear here.")}
        </TabsContent>
        <TabsContent value="reprices" className="mt-4">
          {body(
            reprices.length ? <RepriceTable rows={reprices} /> : null,
            "No repricing yet. Once you opt in, the keeper reprices your cover every block and each transaction appears here.",
          )}
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
