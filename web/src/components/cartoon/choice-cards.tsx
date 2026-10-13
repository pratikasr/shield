"use client";

import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cx as cn } from "./cx";
import { CartoonIcon } from "./icons";

export interface ChoiceOption<T extends string = string> {
  value: T;
  /** Lilita name: "Early", "Balanced", "Last call", "1 month". Words, not numbers. */
  name: ReactNode;
  /** The big Rubik number: "$2,640", "$0.30". */
  big?: ReactNode;
  /** Small line under the number: "2.8% below today". */
  sub?: ReactNode;
  /** A pill: "$0.89 a month". */
  cost?: ReactNode;
  /** One more sentence: "Steps in soonest. Costs the most." */
  note?: ReactNode;
  disabled?: boolean;
  /** Accessible name when the visible content is not enough. */
  ariaLabel?: string;
}

/**
 * An accessible radio group drawn as big cards (trigger and fuel presets) or as pills ("USDC on Monad" or "From
 * another chain"). Arrow keys move and select, Home and End jump; one tab stop for the group. The picked card lifts and
 * a check sticker pops in.
 */
export function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  variant = "cards",
  columns = 3,
  className,
}: {
  options: readonly ChoiceOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** Accessible name for the group (or use labelledBy). */
  label?: string;
  labelledBy?: string;
  variant?: "cards" | "pills";
  /** Card columns from 600 px up; phones always stack. */
  columns?: number;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabStop = selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : (enabled[0] ?? -1);

  const move = (from: number, e: KeyboardEvent) => {
    const pos = enabled.indexOf(from);
    let next: number | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(pos + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  const pills = variant === "pills";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cn(pills ? "c-seg" : "c-choices", className)}
      style={pills ? undefined : ({ "--cols": columns } as CSSProperties)}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            disabled={o.disabled}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => move(i, e)}
            className={pills ? undefined : "c-choice"}
          >
            {pills ? (
              <>
                <span className="c-ring-dot" aria-hidden />
                {o.name}
              </>
            ) : (
              <>
                <span className="c-check" aria-hidden>
                  <CartoonIcon name="check" size={16} />
                </span>
                <span className="c-name">{o.name}</span>
                {o.big != null && <span className="c-big">{o.big}</span>}
                {o.sub != null && <span className="c-sub">{o.sub}</span>}
                {o.cost != null && <span className="c-cost">{o.cost}</span>}
                {o.note != null && <span className="c-note">{o.note}</span>}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
