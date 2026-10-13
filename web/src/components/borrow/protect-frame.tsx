"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/cartoon/card";
import { Level, type LevelProps } from "@/components/cartoon/level";
import { FuelBar } from "@/components/cartoon/fuel-bar";
import { CartoonIcon, type CartoonIconName } from "@/components/cartoon/icons";
import { Pill, Sticker, type StickerTone } from "@/components/cartoon/sticker";
import { HashLink } from "@/components/data/hash-link";
import { Skeleton } from "@/components/ui/skeleton";
import type { TxState } from "@/hooks/useTx";
import { cn } from "@/lib/utils";

/**
 * The borrower page's frame and its small parts. Every state is one frame: a status head (sticker, pill, one-line
 * headline, one sentence), the loan as a level, and a body with one main action. On wide screens the level sits left
 * and stays in view; on phones the head comes first, then a three-line summary, then the level and the body.
 */
export function ProtectFrame({
  loanLine,
  head,
  summary,
  level,
  children,
  levelLast,
}: {
  loanLine?: ReactNode;
  head: ReactNode;
  /** Phones only: status, line and cost above the level, so the answer comes before the picture. */
  summary?: ReactNode;
  level: ReactNode;
  children: ReactNode;
  /** Phones: the level after the body (turning on, stepped in), where the body is what to do now. */
  levelLast?: boolean;
}) {
  return (
    <div>
      {loanLine ? <div className="mb-6 mt-1 flex flex-wrap items-center gap-2">{loanLine}</div> : <div className="h-2" />}
      <div className="grid grid-cols-1 items-start lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-x-10">
        <div className="order-1 mb-6 min-w-0 lg:col-start-2 lg:row-start-1 lg:mb-[22px]">
          {head}
          {summary && <div className="mt-4 lg:hidden">{summary}</div>}
        </div>
        <div className={cn("min-w-0 lg:sticky lg:top-24 lg:col-start-1 lg:row-span-2 lg:row-start-1", levelLast ? "order-3 mt-6 lg:mt-0" : "order-2 mb-6 lg:mb-0")}>{level}</div>
        <div className={cn("grid min-w-0 gap-[22px] lg:col-start-2 lg:row-start-2", levelLast ? "order-2" : "order-3")}>{children}</div>
      </div>
    </div>
  );
}

/** The status head: sticker and pill, the headline (the page's only h1) and one sentence. */
export function StateHead({
  sticker,
  tone,
  pill,
  title,
  say,
  headingRef,
}: {
  sticker?: ReactNode;
  tone?: StickerTone;
  pill?: ReactNode;
  title: ReactNode;
  say?: ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <div>
      {(sticker || pill) && (
        <div className="mb-3.5 flex flex-wrap items-center gap-3">
          {sticker && (
            <Sticker tone={tone} pop>
              {sticker}
            </Sticker>
          )}
          {pill}
        </div>
      )}
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="c-h1-app mb-3 text-balance outline-none">
        {title}
      </h1>
      {say && <p className="m-0 max-w-[30em] text-[18px] leading-[1.45] sm:text-[20px] [&_b]:font-bold">{say}</p>}
    </div>
  );
}

/** "Your Aave loan: 0.05 ETH ($135.80) in, $106.61 USDC borrowed" in a pill. */
export function LoanLine({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <>
      <Pill wrap className="px-3 py-1.5 leading-[1.3]">
        <CartoonIcon name="wallet" size={18} />
        <span className="num">{children}</span>
      </Pill>
      {extra}
    </>
  );
}

/** Phones: the three answers in three short lines, above the picture. */
export function MobileSummary({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-1.5 rounded-2xl border-2 border-ink bg-cloud px-4 py-3 text-[15px]">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-soft">{r.label}</dt>
          <dd className="m-0 text-right font-bold num">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One fact in the facts card: an icon tile, a Lilita title, a big Rubik number and a sentence. */
export function Fact({ icon, title, big, children }: { icon: CartoonIconName; title: ReactNode; big: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-start gap-3.5 sm:grid-cols-[56px_minmax(0,1fr)]">
      <div className="grid size-12 place-items-center rounded-2xl border-[2.5px] border-ink bg-sky-2 sm:size-14" aria-hidden>
        <CartoonIcon name={icon} size={30} />
      </div>
      <div className="min-w-0">
        <h2 className="mb-1.5 mt-0.5 font-display text-[22px] leading-[1.1]">{title}</h2>
        <span className="mb-0.5 block text-[26px] font-extrabold leading-[1.1] num sm:text-[30px]">{big}</span>
        {children}
      </div>
    </div>
  );
}

/** The two answers in one card: when Shield steps in and what happens, and what it costs with the fuel gauge. */
export function FactsCard({
  lineTitle = "When Shield steps in",
  lineBig,
  lineText,
  costBig,
  costText,
  fuel,
  footer,
}: {
  lineTitle?: ReactNode;
  lineBig: ReactNode;
  lineText: ReactNode;
  costBig: ReactNode;
  costText: ReactNode;
  fuel?: { level: number; tone: "ok" | "low" | "out"; label: string; blink?: boolean };
  footer?: ReactNode;
}) {
  return (
    <Card className="grid gap-[18px]">
      <Fact icon="line" title={lineTitle} big={lineBig}>
        <p className="m-0">{lineText}</p>
      </Fact>
      <Fact icon="fuel" title="What it costs" big={costBig}>
        <p className="m-0">{costText}</p>
        {fuel && <FuelBar className="mt-2.5" level={fuel.level} tone={fuel.tone} blink={fuel.blink} label={fuel.label} />}
      </Fact>
      {footer}
    </Card>
  );
}

/** Seconds a sent transaction may wait before the line says it is slow. */
const SLOW_MS = 10_000;

/**
 * Where one wallet action is, in plain words: checking, waiting for the wallet, sent, slow, done (with the block and
 * the transaction), rejected, or reverted with the reason. One line under the action's button.
 */
export function TxLine({ state, className, done }: { state: TxState; className?: string; done?: string }) {
  const [slowSeq, setSlowSeq] = useState(0);
  useEffect(() => {
    if (state.phase !== "pending") return;
    const t = setTimeout(() => setSlowSeq(state.seq), SLOW_MS);
    return () => clearTimeout(t);
  }, [state.phase, state.seq]);
  if (state.phase === "idle") return null;
  const slow = state.phase === "pending" && slowSeq === state.seq;
  const rejected = state.phase === "error" && /rejected|cancelled in your wallet/i.test(state.error ?? "");
  const reverted = state.phase === "error" && !rejected && Boolean(state.hash);
  let text: ReactNode;
  switch (state.phase) {
    case "checking":
      text = "Checking it with Monad first.";
      break;
    case "signing":
      text = "Waiting for your wallet.";
      break;
    case "pending":
      text = slow ? "Still waiting for Monad. This is taking longer than usual." : "Sent. Waiting for Monad.";
      break;
    case "proposed":
      text = `${done ?? state.label} included in block ${state.block?.toLocaleString("en-US")}, finalising.`;
      break;
    case "finalized":
      text = `${done ?? state.label} finalised in block ${state.block?.toLocaleString("en-US")}.`;
      break;
    default:
      text = rejected ? "You said no in your wallet. Nothing moved." : reverted ? `Nothing changed; only the gas was spent. ${state.error ?? ""}` : state.error;
  }
  const bad = state.phase === "error";
  return (
    <div
      role={bad ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border-2 px-3 py-2 text-[14.5px] leading-snug",
        bad ? "border-ink bg-lava-tint" : state.phase === "finalized" || state.phase === "proposed" ? "border-ink bg-chill-tint" : "border-ink/30 bg-sky-2",
        className,
      )}
    >
      <span className="min-w-0 font-semibold">{text}</span>
      {state.hash && <HashLink value={state.hash} className="text-ink" />}
    </div>
  );
}

/** While the loan is read: the frame's shapes, so nothing jumps and no $0 flashes. */
export function ProtectSkeleton({ label = "Reading your Aave loan" }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Skeleton className="mb-6 mt-1 h-9 w-72 rounded-full bg-cloud/70" />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-x-10">
        <div className="order-2 h-[340px] rounded-[24px] border-[2.5px] border-ink/20 bg-sky-2 sm:h-[520px] lg:order-1" />
        <div className="order-1 grid gap-4 lg:order-2">
          <Skeleton className="h-9 w-28 rounded-xl bg-cloud/70" />
          <Skeleton className="h-14 w-full max-w-lg rounded-xl bg-cloud/70" />
          <Skeleton className="h-6 w-full max-w-md bg-cloud/70" />
          <Skeleton className="mt-4 h-56 w-full rounded-[18px] bg-cloud/70" />
        </div>
      </div>
    </div>
  );
}

/** The page's level: the prototype's full height on wide screens, shorter on phones so the answer stays near the top. */
export function ProtectLevel(props: Omit<LevelProps, "size">) {
  return <Level size="hero" {...props} className={cn("max-sm:[--H:340px]", props.className)} />;
}
