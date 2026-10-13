"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import { cx as cn } from "./cx";
import { MASCOT_VIEWBOX, MascotParts, type MascotMood } from "./mascot-art";
import { replayClass } from "./motion";

export type MascotMotion = "squash" | "jump" | "shake" | "none";

/** A stable pseudo-random blink offset per mascot, the same on the server and in the browser. */
function blinkDelay(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `${(1 + (h % 300) / 100).toFixed(2)}s`;
}

/**
 * Shield's mascot. It bobs and blinks while idle, and plays `motion` (a squash by default) whenever `mood` changes or
 * `playKey` changes. Decorative unless `label` is given. Every loop stops under prefers-reduced-motion.
 */
export function Mascot({
  mood = "chill",
  size,
  motion = "squash",
  playKey,
  playOnMount = false,
  still = false,
  label,
  className,
  style,
}: {
  mood?: MascotMood;
  /** Width in px; the height follows. Or size it with className (for example w-24). */
  size?: number;
  /** What plays when the mood or playKey changes. */
  motion?: MascotMotion;
  /** Change this to replay `motion` without changing the mood (for example a jump on a celebration). */
  playKey?: string | number;
  playOnMount?: boolean;
  /** No idle bob. */
  still?: boolean;
  /** Accessible name; without it the mascot is hidden from screen readers. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (!playOnMount) return;
    }
    if (motion !== "none") replayClass(ref.current, motion, ["squash", "jump", "shake"]);
  }, [mood, playKey, motion, playOnMount]);
  return (
    <span
      ref={ref}
      className={cn("mascot", className)}
      data-mood={mood}
      data-still={still || undefined}
      style={{ width: size, ["--blink-delay" as string]: blinkDelay(id), ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox={MASCOT_VIEWBOX}>
        <MascotParts mood={mood} />
      </svg>
    </span>
  );
}
