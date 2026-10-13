"use client";

import { memo, useMemo, useRef } from "react";
import { BlockTicker } from "@/components/cartoon/block-ticker";
import { ComicStrip } from "@/components/cartoon/comic-strip";
import { Disclosure } from "@/components/cartoon/disclosure";
import { Pill } from "@/components/cartoon/sticker";
import { useIndexerQuery } from "@/hooks/useIndexer";
import { useLiveBlock } from "@/hooks/useLiveBlock";
import { useVault } from "@/hooks/useVault";
import {
  AAVE_MONAD_LIQUIDATION,
  ANALYTICS_QUERY,
  INDEXER_META_QUERY,
  agoInWords,
  averageBlockMs,
  hourFrom,
  incomeProgression,
  median,
  rescueItems,
  statsScoreboard,
  usdHeadline,
  type AnalyticsData,
  type HistoryStatus,
  type IndexerMeta,
  historyStatus,
} from "@/lib/analytics";
import { envioUrl, explorerUrl, isDeployed, isFork, shield } from "@/lib/env";
import { formatUsd } from "@/lib/format";
import { NextLevels } from "./next-levels";
import { RescueList, historyNote } from "./rescue-list";
import { ScoreCard } from "./score-card";
import { useBlockStream } from "./use-block-stream";
import { useChainTime, useLiveCovers } from "./use-live-protocol";

/** The indexer is "catching up" when it trails the chain by more than this many blocks (about 30 seconds). */
const BEHIND_BLOCKS = 100;

/** The four big numbers. Loans protected now and the rescue count are read live from Monad every block. */
function Scoreboard({ data, status, now }: { data?: AnalyticsData; status: HistoryStatus; now: number }) {
  const live = useLiveCovers();
  const { vault } = useVault();
  const protectedNow = live.covers ? live.covers.filter((c) => !c.lapsed).length : undefined;
  const s = statsScoreboard({ history: status, data, exitsOnChain: vault?.exitsExecuted, protectedNow, outOfFuel: live.lapsedCount, now });
  return (
    <dl className="m-0 grid grid-cols-2 gap-4 max-sm:gap-3 lg:grid-cols-4" aria-label="Scoreboard">
      <ScoreCard dense label="Rescues" figure={s.rescues} />
      <ScoreCard dense label="Saved for borrowers" figure={s.saved} />
      <ScoreCard dense label="Loans protected now" figure={s.protectedNow} />
      <ScoreCard dense label="Protocol income" figure={s.income} />
    </dl>
  );
}

const STATUS_TEXT: Record<string, string> = {
  connecting: "Connecting to Monad",
  reconnecting: "Reconnecting to Monad",
  paused: "Paused while this tab is hidden",
  unavailable: "This browser can't open a live connection",
  unsupported: "This connection doesn't stream Monad's blocks",
};

/**
 * Monad's blocks dropping in, newest first. A block gets Shield's stamp only when it carries a real Shield transaction
 * (a reprice or a rescue), linked to it. Shield's per-block checks are reads that leave nothing on chain, so they are
 * said in words with a calm heartbeat, not stamped.
 */
const Ticker = memo(function Ticker() {
  const s = useBlockStream(shield.repricer, shield.executor);
  const blockMs = averageBlockMs(s.proposals);
  const toFinal = median(s.finalizeMs);
  const txs = s.repricesSeen + s.exitsSeen;
  const blocks = useMemo(() => s.blocks.map((b) => ({ number: b.number })), [s.blocks]);
  // A stamped block slides out of view in about three seconds; the latest one stays named here.
  const lastMarked = Object.keys(s.marks).reduce((m, k) => Math.max(m, Number(k)), 0);
  const last = lastMarked ? s.marks[lastMarked] : undefined;
  return (
    <div>
      <BlockTicker blocks={blocks} marks={s.marks} label="Latest Monad blocks, newest first" />
      <div className="c-ticker-meta">
        <span className="c-pill" data-wrap="true">
          <span className="c-dot animate-pulse [animation-duration:2.4s]" data-tone="on" aria-hidden />
          Shield reads every protected loan in every block
        </span>
        {STATUS_TEXT[s.status] && (
          <span className="c-pill" role="status">
            <span className="c-dot" data-tone="warn" aria-hidden />
            {STATUS_TEXT[s.status]}
          </span>
        )}
        <span>
          <b>Shield transactions since you opened this page:</b> <span className="tnum">{s.logsAvailable ? txs.toLocaleString("en-US") : "not available here"}</span>
        </span>
        {last?.txHash && (
          <span>
            <b>Latest:</b>{" "}
            <a className="c-link tnum" href={`${explorerUrl}/tx/${last.txHash}`} target="_blank" rel="noreferrer">
              {last.kind === "exited" ? "a rescue" : "a fee update"} in block {lastMarked.toLocaleString("en-US")}
            </a>
          </span>
        )}
        {blockMs !== undefined && (
          <span className="tnum">
            <b>A block every</b> {(blockMs / 1000).toFixed(2)} s
          </span>
        )}
        {toFinal !== undefined && (
          <span className="tnum">
            <b>Final after</b> {Math.round(toFinal)} ms
          </span>
        )}
      </div>
      <p className="m-0 mt-2 text-[14.5px] text-ink-soft">
        Each tile is a block. A purple stamp marks a block with a real Shield transaction, a fee update or a rescue; tap it to see it on MonadVision.
        {isFork ? " This build reads a local copy of Monad, which has no commit stages, so blocks are polled." : ""}
      </p>
    </div>
  );
});

/** The deeper numbers, in a drawer: income adding up over time, the latest rescues and how far the indexer has read. */
function MoreNumbers({ data, status, now, progress }: { data?: AnalyticsData; status: HistoryStatus; now: number; progress?: number }) {
  const steps = useMemo(() => (data ? incomeProgression(data, now) : undefined), [data, now]);
  const rescues = useMemo(() => (data ? rescueItems(data.Exit, now) : undefined), [data, now]);
  const missing = historyNote(status, "these numbers");
  return (
    <Disclosure summary="More numbers" note={envioUrl ? "From the Envio indexer, which reads Shield's contracts on Monad." : undefined}>
      <h3 className="mt-2 mb-3 text-[22px]">Protocol income, adding up</h3>
      {missing ? (
        <p className="m-0 text-ink-soft">{missing}</p>
      ) : !steps ? (
        <div className="h-16 animate-pulse rounded-xl bg-sky-2" aria-busy="true" aria-label="Loading" />
      ) : (
        <ol className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-4" aria-label="Protocol income over four windows">
          {steps.map((p, i) => {
            const h = usdHeadline(p.value);
            return (
              <li key={p.period} className="relative rounded-2xl border-2 border-ink bg-sky-2 px-3.5 py-3">
                <span className="block text-[14.5px] font-semibold text-ink-soft">{p.label}</span>
                <span className="mt-1 block text-[26px] leading-tight font-extrabold tnum" title={h.exact}>
                  {h.text}
                </span>
                {i < steps.length - 1 && (
                  <span className="absolute top-1/2 -right-3 z-10 hidden -translate-y-1/2 text-[20px] font-extrabold md:block" aria-hidden>
                    &rsaquo;
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <h3 className="mt-6 mb-3 text-[22px]">Latest rescues</h3>
      <RescueList items={rescues} status={status} empty="No rescues yet. When Shield steps in for someone, it shows up here with the transaction." />
      {progress !== undefined && (
        <p className="m-0 mt-5 text-[14.5px] text-ink-soft tnum">History counted up to block {progress.toLocaleString("en-US")}.</p>
      )}
    </Disclosure>
  );
}

/** Says when the indexer trails the chain. Watches every block, so it is its own component. */
function CatchingUp({ progress, failingSince }: { progress?: number; failingSince?: number }) {
  const { data: head } = useLiveBlock();
  const behind = progress !== undefined && head !== undefined ? Number(head) - progress : undefined;
  let text: string | undefined;
  if (failingSince !== undefined) text = `History is catching up. These numbers are from ${agoInWords(failingSince, Date.now() / 1000) ?? "a moment ago"}.`;
  else if (behind !== undefined && behind > BEHIND_BLOCKS) text = `History is catching up: it is ${behind.toLocaleString("en-US")} blocks behind Monad, so the newest activity may not be counted yet.`;
  if (!text) return null;
  return (
    <p className="c-pill mb-4 max-w-full" data-wrap="true" role="status">
      <span className="c-dot" data-tone="warn" aria-hidden />
      {text}
    </p>
  );
}

/**
 * Stats: a scoreboard of rescues, money saved for borrowers, loans protected now and protocol income; Monad's blocks
 * with Shield's transactions stamped in; the one liquidation on Aave Monad as a comic; and the levels not built yet.
 */
export function StatsView() {
  const now = useChainTime();
  const variables = useMemo(() => ({ hourFrom: hourFrom(now) }), [now]);
  const history = useIndexerQuery<AnalyticsData>(["analytics", variables.hourFrom], ANALYTICS_QUERY, variables, true, 4_000);
  const meta = useIndexerQuery<IndexerMeta>(["indexer-meta"], INDEXER_META_QUERY, {}, true, 10_000);
  const status = historyStatus(Boolean(envioUrl), Boolean(history.data), Boolean(history.error));
  // When the last good answer arrived, for "these numbers are from ..." while the indexer is failing.
  const lastGood = useRef<{ data?: AnalyticsData; at: number }>({ at: 0 });
  if (history.data && history.data !== lastGood.current.data) lastGood.current = { data: history.data, at: Date.now() / 1000 };
  const failingSince = status === "ok" && history.error ? lastGood.current.at : undefined;
  const progress = meta.data?._meta[0]?.progressBlock;

  return (
    <div>
      <div className="mb-[22px] flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <h1 className="c-h1-app">Stats.</h1>
        <div className="flex flex-wrap gap-2.5">
          <Pill dot={isDeployed ? "on" : "off"}>{isFork ? "Live from a local copy of Monad" : "Live from Monad"}</Pill>
          {status === "ok" ? (
            <Pill dot="on">History by Envio</Pill>
          ) : status === "down" || status === "off" ? (
            <Pill dot="warn">History offline</Pill>
          ) : null}
        </div>
      </div>
      {status === "ok" && <CatchingUp progress={progress} failingSince={failingSince} />}

      <Scoreboard data={history.data} status={status} now={now} />

      <section className="c-section pb-0!" aria-labelledby="blocks-heading">
        <div className="c-section-head">
          <h2 id="blocks-heading" className="c-h2">
            Monad, block by block.
          </h2>
          <p>A new block every 0.3 seconds. Shield reads every protected loan in each one, and steps in when one reaches its line.</p>
        </div>
        <Ticker />
      </section>

      <section className="c-section pb-0!" aria-labelledby="comic-heading">
        <div className="c-section-head">
          <h2 id="comic-heading" className="c-h2">
            The one liquidation on Aave Monad so far.
          </h2>
          <p>It cost the borrower {formatUsd(AAVE_MONAD_LIQUIDATION.paidAboveDebtUsd)} on top of what was repaid.</p>
        </div>
        <ComicStrip />
      </section>

      <section className="c-section" aria-labelledby="levels-heading">
        <div className="c-section-head">
          <h2 id="levels-heading" className="c-h2">
            Next levels.
          </h2>
          <p>Shield works with Aave V3 on Monad today. Everything else here is not built yet.</p>
        </div>
        <NextLevels />
      </section>

      <MoreNumbers data={history.data} status={status} now={now} progress={progress} />
    </div>
  );
}
