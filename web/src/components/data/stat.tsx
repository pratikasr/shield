import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A labelled reading. The value is set in the expanded width with tabular figures. */
export function Stat({
  label,
  value,
  hint,
  tone,
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "safe" | "caution" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "reading mt-0.5 font-semibold",
          size === "lg" && "text-[2.25rem] leading-none",
          size === "md" && "text-xl",
          size === "sm" && "text-base",
          tone === "safe" && "text-safe",
          tone === "caution" && "text-caution",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </dd>
      {hint && <dd className="mt-1 text-[0.8125rem] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
