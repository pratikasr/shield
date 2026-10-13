"use client";

import { TokenIcon } from "@/components/data/token";
import { Input } from "@/components/ui/input";
import { cleanAmountInput, type AmountCheck } from "@/lib/amount";
import { cn } from "@/lib/utils";

/**
 * The one amount field: token icon inside, optional Max, raw text kept as typed (a comma stays a comma until parsed),
 * and the check's message wired to the field for screen readers.
 */
export function AmountInput({
  id,
  value,
  onChange,
  onMax,
  maxDisabled,
  disabled,
  check,
  hintId,
  placeholder = "0.00",
  size = "md",
  symbol = "USDC",
  label,
}: {
  id: string;
  value: string;
  onChange: (raw: string) => void;
  onMax?: () => void;
  maxDisabled?: boolean;
  disabled?: boolean;
  check?: AmountCheck;
  /** The id of the hint line under the field. */
  hintId?: string;
  placeholder?: string;
  size?: "md" | "lg";
  symbol?: string;
  /** Accessible name when no visible label points at the field. */
  label?: string;
}) {
  const invalid = check?.tone === "danger";
  return (
    <div className="relative">
      <TokenIcon symbol={symbol} size={size === "lg" ? 24 : 22} className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2", size === "lg" ? "left-3.5" : "left-3")} />
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
        className={cn("c-field h-auto", size === "lg" ? "min-h-14 pl-12 text-[20px]" : "pl-11", onMax ? "pr-18" : "pr-3")}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(cleanAmountInput(e.target.value))}
      />
      {onMax && (
        <button
          type="button"
          className="hit absolute right-2.5 top-1/2 h-8 -translate-y-1/2 rounded-full border-2 border-ink bg-grape-tint px-3 text-[14px] font-bold text-ink hover:bg-grape hover:text-white disabled:opacity-50"
          onClick={onMax}
          disabled={disabled || maxDisabled}
        >
          Max
        </button>
      )}
    </div>
  );
}

/** The line under an amount field: the check's message in red, else the neutral outcome text. */
export function AmountHint({ id, check, children, className }: { id: string; check?: AmountCheck; children?: React.ReactNode; className?: string }) {
  const danger = check?.tone === "danger" && check.message;
  return (
    <p id={id} className={cn("text-[14.5px] leading-snug", danger ? "font-semibold text-danger" : "text-ink-soft", className)} aria-live="polite">
      {danger ? check!.message : children}
    </p>
  );
}
