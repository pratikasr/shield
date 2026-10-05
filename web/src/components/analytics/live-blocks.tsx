"use client";

import type { Address } from "viem";
import { Info } from "@/components/data/info";
import { Panel, Stat } from "@/components/data/stat";
import { TokenIcon } from "@/components/data/token";
import { ShieldMark } from "@/components/shell/wordmark";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/useLiveBlock";
import { COMMIT_STATES, STREAM_KEEP, averageBlockMs, median, protocolCut, type StreamBlock } from "@/lib/analytics";
import { formatUsd, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MONAD_WS_URL, useBlockStream, type StreamState } from "./use-block-stream";

const host = (() => {
  try {
    return new URL(MONAD_WS_URL).host;
  } catch {
    return MONAD_WS_URL;
  }
})();

function StatusChip({ s }: { s: StreamState }) {
  const now = useNow(500);
  const live = s.status === "live";
  const caution = s.mode === "poll" || s.status === "reconnecting" || s.status === "unavailable" || s.status === "unsupported";
  const text =
    s.mode === "poll"
      ? "Polling the local fork"
      : s.status === "live"
        ? `Streaming from ${host}`
        : s.status === "connecting"
          ? `Connecting to ${host}`
          : s.status === "reconnecting"
            ? `Reconnecting${s.retryAt ? ` in ${Math.max(1, Math.ceil((s.retryAt - now) / 1000))} s` : ""}`
            : s.status === "paused"
              ? "Paused while this tab is hidden"
              : s.status === "unsupported"
                ? `${host} does not offer monadNewHeads`
                : "This browser cannot open a WebSocket";
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[0.8125rem] font-medium",
        caution ? "border-caution/40 bg-caution-soft text-caution" : "bg-card text-muted-foreground",
      )}
    >
      <span className="relative flex size-1.5" aria-hidden>
        {live && s.mode === "socket" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-safe opacity-50" />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", live && s.mode === "socket" ? "bg-safe" : caution ? "bg-caution" : "bg-muted-foreground")} />
      </span>
      {text}
    </span>
  );
}

/** Four steps, Proposed to Verified, filled up to the furthest state the block reached. */
function StateTrack({ block }: { block: StreamBlock }) {
  const reached = block.state ? COMMIT_STATES.indexOf(block.state) : -1;
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {COMMIT_STATES.map((st, i) => (
        <span key={st} className={cn("h-1.5 w-3.5 rounded-full sm:w-5", i <= reached ? "bg-foreground" : "bg-border")} />
      ))}
    </span>
  );
}

const ROW = "grid h-11 grid-cols-[6.25rem_minmax(0,1fr)_2rem] items-center gap-x-3 border-b px-5 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)_6.5rem] sm:px-6";

function BlockRow({ block, reprices }: { block: StreamBlock; reprices: number }) {
  const sinceProposed = block.state && block.state !== "Proposed" && block.at.Proposed !== undefined ? block.at[block.state]! - block.at.Proposed : undefined;
  return (
    <li className={ROW}>
      <span className="font-medium num">{block.number.toLocaleString("en-US")}</span>
      <span className="flex min-w-0 items-center gap-2.5">
        {block.state ? (
          <>
            <StateTrack block={block} />
            <span className="truncate">{block.state}</span>
            {sinceProposed !== undefined && <span className="hidden text-[0.8125rem] text-muted-foreground num md:inline">{Math.round(sinceProposed)} ms after it was proposed</span>}
          </>
        ) : (
          <span className="truncate text-muted-foreground">Mined</span>
        )}
      </span>
      <span className="flex justify-end">
        {reprices > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-raised p-1 text-[0.75rem] font-medium sm:px-2 sm:py-0.5">
            <ShieldMark size={13} />
            <span className="sr-only sm:not-sr-only">{reprices > 1 ? `${reprices} reprices` : "Reprice"}</span>
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * The Monad block stream: the last ten blocks as they move from Proposed to Verified, the time between them, and the
 * blocks that carry a Shield reprice, with the protocol share those reprices earned while the page is open.
 */
export function LiveBlocks({ repricer, shareBps }: { repricer?: Address; shareBps?: number }) {
  const s = useBlockStream(repricer);
  const blockTime = averageBlockMs(s.proposals);
  const toFinal = median(s.finalizeMs);
  const share = shareBps !== undefined ? toNumber(protocolCut(s.chargedSeen, shareBps), 18) : undefined;
  const poll = s.mode === "poll";

  return (
    <Panel
      labelledBy="live-heading"
      bodyClassName="p-0 sm:p-0"
      title={
        <span className="inline-flex items-center gap-2">
          <TokenIcon symbol="MON" size={18} />
          Live on Monad
        </span>
      }
      description={
        poll
          ? "Blocks from the local fork, polled every 300 ms."
          : "Monad proposes a block about every 300 ms; each then moves through Voted, Finalized and Verified."
      }
      action={<StatusChip s={s} />}
    >
      <div className="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-t lg:border-r">
          <div className={cn(ROW, "h-9 text-[0.75rem] text-muted-foreground")} aria-hidden>
            <span>Block</span>
            <span>{poll ? "State" : "Commit state"}</span>
            <span className="text-right">Shield</span>
          </div>
          <ol aria-label="Latest blocks, newest first" aria-live="off">
            {s.blocks.length
              ? s.blocks.map((b) => <BlockRow key={b.number} block={b} reprices={s.repricesByBlock[b.number] ?? 0} />)
              : Array.from({ length: STREAM_KEEP }, (_, i) => (
                  <li key={i} className={ROW} aria-hidden>
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-32" />
                    <span />
                  </li>
                ))}
            {s.blocks.length > 0 &&
              s.blocks.length < STREAM_KEEP &&
              Array.from({ length: STREAM_KEEP - s.blocks.length }, (_, i) => <li key={`pad-${i}`} className={ROW} aria-hidden />)}
          </ol>
        </div>
        <div className="border-t p-5 sm:p-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            <Stat
              label="Block time"
              value={blockTime !== undefined ? `${Math.round(blockTime)} ms` : <Skeleton className="h-7 w-16" />}
              hint={poll ? "Average, as polled from the fork" : `Average over the last ${s.proposals.length} blocks`}
            />
            <Stat
              label={poll ? "Commit states" : "Proposed to Finalized"}
              value={poll ? "Monad only" : toFinal !== undefined ? `${Math.round(toFinal)} ms` : <Skeleton className="h-7 w-16" />}
              hint={poll ? "Not on a local fork" : `Median over the last ${s.finalizeMs.length} blocks`}
            />
            <Stat
              label="Shield reprices seen"
              value={s.logsAvailable ? s.repricesSeen.toLocaleString("en-US") : "n/a"}
              hint={s.logsAvailable ? "Since you opened this page" : "This RPC refused the log subscription"}
            />
            <Stat
              label={
                <>
                  Protocol share earned
                  <Info>
                    The protocol&rsquo;s part of every premium the reprices above charged, at the share in the registry now. It counts only while this page is open.
                  </Info>
                </>
              }
              value={share !== undefined && s.logsAvailable ? formatUsd(share) : "n/a"}
              hint="While you watch"
            />
          </dl>
          <p className="mt-6 border-t pt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
            {poll ? (
              <>
                A local fork has no <code className="text-foreground">monadNewHeads</code>, so this view polls for blocks. Proposed, Voted, Finalized and Verified are
                Monad&rsquo;s commit states and appear only on Monad.
              </>
            ) : (
              <>Shield&rsquo;s keeper acts on Proposed blocks, before they finalise: it reads health factors on the block being proposed and sends its reprices and exits into the next one.</>
            )}
          </p>
        </div>
      </div>
    </Panel>
  );
}
