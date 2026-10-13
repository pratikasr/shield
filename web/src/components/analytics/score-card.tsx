"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "@/components/cartoon/motion";
import type { Figure } from "@/lib/analytics";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const COUNT_MS = 900;

/**
 * The figure's text, counted up from zero the first time a value arrives (900 ms, ease-out). Later values, such as a
 * premium that grows every block, show straight away. No count with reduced motion or below a cent.
 */
function useCountUp(figure: Figure): string | undefined {
  const [shown, setShown] = useState<string>();
  // One count per card: it starts when the first value arrives and keeps its clock if the value moves meanwhile.
  const started = useRef<number | undefined>(undefined);
  const done = useRef(false);
  const value = figure.state === "value" ? figure.value : undefined;
  const money = figure.state === "value" && figure.money;
  useEffect(() => {
    if (value === undefined || done.current) return;
    if (prefersReducedMotion() || (money && value < 0.01) || value === 0) {
      done.current = true;
      setShown(undefined);
      return;
    }
    const format = (v: number) => (money ? formatUsd(v) : Math.round(v).toLocaleString("en-US"));
    started.current ??= performance.now();
    const t0 = started.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / COUNT_MS);
      if (k >= 1) {
        done.current = true;
        setShown(undefined);
        return;
      }
      setShown(format(value * (1 - (1 - k) ** 3)));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, money]);
  return shown;
}

/**
 * One big number on a scoreboard: a label, the number in Rubik with tabular figures, and a line saying when or what.
 * A dt and its dd pair, so it sits inside a dl and reads as "label: value". A figure the page cannot know right now
 * shows a question block and why, never a zero.
 */
export function ScoreCard({ label, figure, dense, className }: { label: ReactNode; figure: Figure; dense?: boolean; className?: string }) {
  const counting = useCountUp(figure);
  return (
    // Three rows of the scoreboard's grid (label, number, line), so numbers line up across a row however a label wraps.
    <div className={cn("c-card row-span-3 grid min-w-0 grid-rows-subgrid content-start gap-y-0 p-5", dense && "max-sm:p-3.5", className)}>
      <dt className={cn("m-0 text-[15.5px] leading-snug font-semibold text-ink-soft", dense && "max-sm:text-[14.5px]")}>{label}</dt>
      <dd
        className={cn("m-0 mt-1.5 text-[clamp(36px,3.8vw,50px)] leading-none font-extrabold tracking-[-0.01em] tnum", dense && "max-sm:text-[30px]")}
        aria-busy={figure.state === "loading" || undefined}
      >
        {figure.state === "value" ? (
          <>
            <span aria-hidden={counting !== undefined || undefined}>{counting ?? figure.text}</span>
            {counting !== undefined && <span className="sr-only">{figure.text}</span>}
          </>
        ) : figure.state === "unknown" ? (
          <span className="inline-flex h-[1em] min-w-[1em] items-center justify-center rounded-[10px] border-[2.5px] border-ink bg-heads px-[0.18em] text-[0.8em] shadow-sticker-sm">
            <span aria-hidden>?</span>
            <span className="sr-only">Not known right now</span>
          </span>
        ) : (
          <span className="inline-block h-[1em] w-[3.2em] animate-pulse rounded-lg bg-sky-2" aria-label="Loading" />
        )}
      </dd>
      <dd className={cn("m-0 mt-2.5 text-[14.5px] leading-snug text-ink-soft", dense && "max-sm:text-[13.5px]")}>
        {figure.state === "value" ? (
          <>
            {figure.exact && <span className="tnum">Exactly {figure.exact}. </span>}
            {figure.when}
          </>
        ) : figure.state === "unknown" ? (
          figure.when
        ) : (
          <span className="inline-block h-[1em] w-32 animate-pulse rounded bg-sky-2" aria-hidden />
        )}
      </dd>
    </div>
  );
}
