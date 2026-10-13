"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cx as cn } from "./cx";
import { CartoonIcon } from "./icons";
import { Mascot } from "./mascot";
import type { MascotMood } from "./mascot-art";
import { replayClass } from "./motion";

/**
 * A level map of N stops for a multi-step flow ("Allow ETH", "Allow USDC", "Add fuel", "Switch on"). The track fills
 * to the current stop, finished stops stamp a check, and the small mascot hops along when `current` changes.
 */
export function ProgressTrack({
  steps,
  current,
  mood = "arming",
  label = "Progress",
  className,
}: {
  steps: readonly { label: string }[];
  /** Index of the step in progress; steps before it are done. steps.length means all done. */
  current: number;
  mood?: MascotMood;
  label?: string;
  className?: string;
}) {
  const n = Math.max(1, steps.length);
  const at = Math.min(Math.max(current, 0), n - 1);
  const fill = n > 1 ? (at / (n - 1)) * 100 : 100;
  const player = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    replayClass(player.current, "hop");
  }, [at]);
  return (
    <div className={cn("relative", className)}>
      <ol className="c-track" style={{ "--n": n } as CSSProperties} aria-label={label}>
        <li aria-hidden className="c-track-line">
          <div className="c-track-fill" style={{ width: `${fill}%` }} />
        </li>
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === at ? "now" : undefined;
          return (
            <li key={i} className="c-tnode" data-state={state} aria-current={i === at && current < n ? "step" : undefined}>
              <span className="c-tdot" aria-hidden>
                {state === "done" ? <CartoonIcon name="check" size={22} /> : i + 1}
              </span>
              <span className="c-tl">
                <span className="sr-only">{`Step ${i + 1} of ${n}: `}</span>
                {s.label}
                {state === "done" && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <div ref={player} className="c-track-player" style={{ left: `${((at + 0.5) / n) * 100}%` }} aria-hidden>
        <Mascot mood={mood} motion="none" />
      </div>
    </div>
  );
}
