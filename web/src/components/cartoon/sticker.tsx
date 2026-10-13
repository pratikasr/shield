import type { ReactNode } from "react";
import { cx as cn } from "./cx";

export type StickerTone = "safe" | "careful" | "danger" | "protected" | "saved" | "lowfuel" | "blocked" | "out" | "arming" | "none";

/**
 * A tilted status sticker in Lilita: Safe, Careful, Danger, Protected, Saved, Low fuel, Blocked, Out of fuel, Arming.
 * Status colours are fills behind Ink text. `pop` springs it in on mount. Words only, never numbers.
 */
export function Sticker({
  tone = "none",
  tilt = "left",
  size = "md",
  pop,
  className,
  children,
}: {
  tone?: StickerTone;
  tilt?: "left" | "right" | "none";
  size?: "md" | "small";
  pop?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("c-sticker", pop && "c-pop", className)} data-tone={tone} data-tilt={tilt === "left" ? undefined : tilt} data-size={size === "small" ? "small" : undefined}>
      {children}
    </span>
  );
}

/** A rounded pill with an Ink outline, optionally led by a status dot ("Shield is on"). */
export function Pill({
  dot,
  tone,
  wrap,
  className,
  children,
  title,
}: {
  /** on: green, off: grey, warn: yellow, bad: red. */
  dot?: "on" | "off" | "warn" | "bad";
  tone?: "cloud" | "grape" | "sky";
  wrap?: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cn("c-pill", className)} data-tone={tone} data-wrap={wrap || undefined} title={title}>
      {dot && <span className="c-dot" data-tone={dot} aria-hidden />}
      {children}
    </span>
  );
}

/** The dashed yellow tag every illustrative number carries: "Example", "Example numbers". */
export function SampleTag({ children = "Example", className }: { children?: ReactNode; className?: string }) {
  return <span className={cn("c-sample", className)}>{children}</span>;
}
