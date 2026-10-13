"use client";

import { CartoonIcon } from "@/components/cartoon/icons";
import { HashLink } from "@/components/data/hash-link";
import type { HistoryStatus, RescueItem } from "@/lib/analytics";
import { collateralName, explorerUrl } from "@/lib/env";
import { formatUsd, truncateHex } from "@/lib/format";

function Badge() {
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-ink bg-chill-tint" aria-hidden>
      <CartoonIcon name="shield" size={20} />
    </span>
  );
}

/** Says why there is no list, in the page's voice; null when the list can show. */
export function historyNote(status: HistoryStatus, what: string): string | null {
  if (status === "off") return `This build has no history service, so ${what} can't load.`;
  if (status === "down") return `The history service isn't answering, so ${what} can't load right now. It fills in when it's back.`;
  return null;
}

/** Rescues as short sentences, newest first, each with its transaction. */
export function RescueList({ items, status, empty, note }: { items?: RescueItem[]; status: HistoryStatus; empty: string; note?: string }) {
  const missing = historyNote(status, "the list of rescues");
  if (missing)
    return (
      <p className="m-0 text-ink-soft" role="status">
        {missing}
        {note ? ` ${note}` : ""}
      </p>
    );
  if (!items)
    return (
      <div className="grid gap-3" aria-busy="true" aria-label="Loading rescues">
        {[0, 1].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-sky-2" />
        ))}
      </div>
    );
  if (!items.length) return <p className="m-0 text-ink-soft">{empty}</p>;
  return (
    <ul className="m-0 grid list-none gap-0 p-0">
      {items.map((r) => {
        const what = collateralName(r.collateral).priceName;
        return (
          <li key={r.txHash} className="flex gap-3.5 border-b-[1.5px] border-dashed border-ink/20 py-3.5 first:pt-0 last:border-b-0 last:pb-0">
            <Badge />
            <div className="min-w-0 flex-1">
              <p className="m-0 leading-snug">
                <b className="tnum">Paid back {formatUsd(r.repaidUsd)}</b> of{" "}
                <a className="c-link hit relative font-normal whitespace-nowrap tnum" href={`${explorerUrl}/address/${r.borrower}`} target="_blank" rel="noreferrer" title={r.borrower}>
                  {truncateHex(r.borrower)}
                </a>
                &rsquo;s loan and took {what} worth <span className="tnum">{formatUsd(r.tookUsd)}</span>.{" "}
                {r.savedUsd > 0 && (
                  <>
                    That&rsquo;s <b className="tnum">{formatUsd(r.savedUsd)}</b> less than an Aave liquidation would have taken.
                  </>
                )}
              </p>
              <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px] text-ink-soft">
                <span className="tnum">{r.when ? `${r.when[0]!.toUpperCase()}${r.when.slice(1)}` : `Block ${r.block.toLocaleString("en-US")}`}</span>
                <HashLink value={r.txHash} />
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
