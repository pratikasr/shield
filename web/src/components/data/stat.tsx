import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A labelled reading: a quiet label above a tabular value, with an optional line of context. */
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
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {/* A fixed label height keeps values on one line across a row, with or without an info button. */}
      <dt className="flex min-h-6 items-center gap-1 text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "reading mt-1 font-semibold",
          size === "xl" && "text-[2.5rem] leading-none",
          size === "lg" && "text-[1.75rem] leading-tight",
          size === "md" && "text-[1.25rem] leading-snug",
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

/** A surface with an optional header row. Every app section is one of these; nothing nests inside another. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  labelledBy,
  as: Tag = "section",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  labelledBy?: string;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag className={cn("panel min-w-0", className)} aria-labelledby={labelledBy}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            {title && (
              <h2 id={labelledBy} className="text-base font-semibold">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn("p-5 sm:p-6", (title || action) && "pt-4 sm:pt-4", bodyClassName)}>{children}</div>
    </Tag>
  );
}
