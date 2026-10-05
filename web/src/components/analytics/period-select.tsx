"use client";

import { useRef, type KeyboardEvent } from "react";
import { PERIODS, type Period } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** The period every earnings figure on the page follows: a radio group, one tab stop, arrow keys move. */
export function PeriodSelect({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = PERIODS.findIndex((p) => p.id === value);
    let next = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % PERIODS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + PERIODS.length) % PERIODS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = PERIODS.length - 1;
    else return;
    e.preventDefault();
    onChange(PERIODS[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Period" onKeyDown={onKey} className="inline-flex h-10 items-center rounded-lg border bg-muted p-[3px]">
      {PERIODS.map((p, i) => {
        const on = p.id === value;
        return (
          <button
            key={p.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(p.id)}
            className={cn(
              "hit relative h-full rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors sm:px-3.5",
              on ? "bg-card text-foreground shadow-sm dark:bg-input/40" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
