import type { ElementType, ReactNode } from "react";
import { cx as cn } from "./cx";

export type CardTone = "cloud" | "grape" | "chill" | "heads" | "lava" | "sky";

/** The white sticker card: 2.5 px Ink outline, 18 px radius, hard 4 px shadow. Tones tint it for a moment. */
export function Card({
  as: Tag = "div",
  tone,
  pad = "md",
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  tone?: CardTone;
  pad?: "md" | "tight" | "none";
  className?: string;
  children: ReactNode;
  id?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  role?: string;
}) {
  return (
    <Tag className={cn("c-card", className)} data-tone={tone === "cloud" ? undefined : tone} data-pad={pad === "md" ? undefined : pad} {...rest}>
      {children}
    </Tag>
  );
}

/** A quiet sky panel inside a card or a page: thinner outline, no shadow. */
export function QuietPanel({ as: Tag = "div", className, children }: { as?: ElementType; className?: string; children: ReactNode }) {
  return <Tag className={cn("c-panel", className)}>{children}</Tag>;
}

/**
 * A loud, friendly callout with an icon tile: heads (yellow) for a warning, lava for out of fuel or an error, grape
 * for a note, chill for good news. Put one main button inside when there is one fix.
 */
export function Callout({
  tone = "heads",
  icon,
  title,
  children,
  role,
  shake,
  className,
}: {
  tone?: "heads" | "lava" | "grape" | "chill" | "cloud";
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  role?: "alert" | "status";
  /** Shake once on mount (out of fuel). */
  shake?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("c-alert", shake && "c-shake", !icon && "grid-cols-1", className)} data-tone={tone === "cloud" ? undefined : tone} role={role}>
      {icon && (
        <div className="c-alert-ico" aria-hidden>
          {icon}
        </div>
      )}
      <div className="min-w-0">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}
