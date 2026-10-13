"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx as cn } from "./cx";
import { isLocalRpc, isStale, useChainBlocks, type BlockMark } from "./chain-blocks";
import { CartoonIcon } from "./icons";
import { prefersReducedMotion } from "./motion";

const EXPLORER = (
  process.env.NEXT_PUBLIC_EXPLORER_URL || (process.env.NEXT_PUBLIC_CHAIN_ID === "10143" ? "https://testnet.monadvision.com" : "https://monadvision.com")
).replace(/\/$/, "");
const IS_TESTNET = process.env.NEXT_PUBLIC_CHAIN_ID === "10143";

export interface TickerBlock {
  number: number;
  /** Transactions in the block, drawn as small squares when known. */
  txs?: number;
}

/** Numbers whose changed digits roll in (150 ms). */
export function RollingDigits({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("c-digits", className)} aria-hidden>
      {[...value].map((ch, i) => (
        <span key={`${i}:${ch}`} className="roll">
          {ch}
        </span>
      ))}
    </span>
  );
}

function Stamp({ mark }: { mark: BlockMark }) {
  const text = mark.kind === "exited" ? "Shield rescue" : mark.count > 1 ? `Shield ×${mark.count}` : "Shield tx";
  const body = (
    <>
      <CartoonIcon name="shield" size={13} />
      {text}
    </>
  );
  return mark.txHash ? (
    <a className="c-blk-check hit relative text-ink no-underline hover:bg-grape hover:text-white" href={`${EXPLORER}/tx/${mark.txHash}`} target="_blank" rel="noreferrer">
      {body}
      <span className="sr-only"> (opens the transaction on MonadVision)</span>
    </a>
  ) : (
    <span className="c-blk-check">{body}</span>
  );
}

/**
 * Monad's blocks as tiles sliding in from the left, newest first. A tile carries a Shield stamp only when `marks` says
 * the block holds a real Shield transaction, linked to it on MonadVision. Presentational: feed it any block list (the
 * live wrapper below, or use-block-stream on the Stats page).
 */
export function BlockTicker({
  blocks,
  marks = {},
  label = "Latest Monad blocks",
  className,
}: {
  blocks: readonly TickerBlock[];
  marks?: Record<number, BlockMark | undefined>;
  label?: string;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const prevTop = useRef<number | undefined>(undefined);
  const [fresh, setFresh] = useState<number | undefined>(undefined);
  const top = blocks[0]?.number;
  useLayoutEffect(() => {
    const el = track.current;
    const before = prevTop.current;
    prevTop.current = top;
    if (!el || top === undefined || before === undefined || top <= before || prefersReducedMotion()) return;
    const added = blocks.findIndex((b) => b.number <= before);
    const count = added < 0 ? blocks.length : added;
    const tile = el.firstElementChild as HTMLElement | null;
    if (!tile || count <= 0) return;
    const w = (tile.offsetWidth + 10) * count;
    el.style.transition = "none";
    el.style.transform = `translateX(-${w}px)`;
    void el.offsetWidth;
    el.style.transition = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";
    el.style.transform = "translateX(0)";
    setFresh(top);
  }, [top, blocks]);
  return (
    <div className={cn("c-ticker", className)} role="group" aria-label={label}>
      <div ref={track} className="c-ticker-track">
        {blocks.map((b) => {
          const mark = marks[b.number];
          return (
            <div key={b.number} className={cn("c-blk", fresh !== undefined && b.number === fresh && "in")}>
              <span className="c-blk-n">#{b.number.toLocaleString("en-US")}</span>
              <span className="c-blk-txs" aria-hidden>
                {b.txs !== undefined && Array.from({ length: Math.min(b.txs, 24) }, (_, i) => <i key={i} />)}
              </span>
              {mark ? <Stamp mark={mark} /> : <span className="c-blk-none" aria-hidden>&nbsp;</span>}
            </div>
          );
        })}
        {blocks.length === 0 &&
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="c-blk opacity-60" aria-hidden>
              <span className="c-blk-n">#&nbsp;</span>
              <span className="c-blk-txs" />
              <span className="c-blk-none">&nbsp;</span>
            </div>
          ))}
      </div>
      <div className="c-ticker-fade" aria-hidden />
    </div>
  );
}

/**
 * The ticker on live Monad blocks: block numbers from the RPC every 300 ms, and a stamp on each block that carries a
 * Shield transaction (Repriced or Exited), read from the chain's logs. `children` renders under it with the state, for
 * a caption. Works without the wallet providers.
 */
export function LiveBlockTicker({ className = "min-w-0", caption }: { className?: string; caption?: (s: { failed: boolean; stale: boolean; marksAvailable: boolean; latest?: number }) => ReactNode }) {
  const b = useChainBlocks();
  const stale = isStale(b);
  return (
    <div className={className}>
      <BlockTicker blocks={b.blocks.map((number) => ({ number }))} marks={b.marks} />
      {caption?.({ failed: b.failed, stale, marksAvailable: b.marksAvailable, latest: b.latest })}
    </div>
  );
}

/** The header's live block chip: a heart that beats per block and digits that roll. */
export function BlockChip({
  block,
  tone = "live",
  name = "Monad block",
  short = "Block",
  title,
  className,
}: {
  block?: number | bigint;
  /** live: green heart; warn: yellow (stale or a local fork); off: grey (connecting). */
  tone?: "live" | "warn" | "off";
  name?: string;
  /** The name in the phone header row, where space is short. */
  short?: string;
  title?: string;
  className?: string;
}) {
  const n = block === undefined ? undefined : Number(block);
  const text = n === undefined ? "connecting" : n.toLocaleString("en-US");
  return (
    <span className={cn("c-blockchip", className)} data-tone={tone === "warn" ? "warn" : undefined} title={title}>
      <i key={tone === "live" ? n : "still"} className={cn("c-heart", tone === "live" && n !== undefined && "beat")} data-tone={tone === "live" ? undefined : tone} aria-hidden />
      <span className="c-chip-name">{name}</span>
      <span className="c-chip-short" aria-hidden>
        {short}
      </span>
      {n === undefined ? <span className="c-muted">{text}</span> : <RollingDigits value={text} />}
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** BlockChip on the shared RPC poller, for pages without the wallet providers (the landing page). */
export function LiveBlockChip({ className }: { className?: string }) {
  const b = useChainBlocks();
  const stale = isStale(b);
  return (
    <BlockChip
      className={className}
      block={b.failed ? undefined : b.latest}
      tone={b.latest === undefined ? "off" : stale || isLocalRpc ? "warn" : "live"}
      name={isLocalRpc ? "Local fork, block" : stale ? "Reconnecting, block" : IS_TESTNET ? "Monad testnet block" : "Monad block"}
      short={isLocalRpc ? "Fork" : stale ? "Reconnecting" : IS_TESTNET ? "Test" : "Block"}
      title={isLocalRpc ? "Reading a local fork of Monad mainnet (test rehearsal)" : stale ? "No new block for over two seconds" : IS_TESTNET ? "Latest proposed block on Monad testnet" : "Latest proposed block on Monad"}
    />
  );
}
