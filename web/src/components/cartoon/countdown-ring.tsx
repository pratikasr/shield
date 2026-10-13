"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cx as cn } from "./cx";

const R = 64;
const CIRC = 2 * Math.PI * R;

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * The arming countdown: a Grape ring that empties as the waiting period runs out, with m:ss in the middle. Either
 * controlled (`secondsLeft`) or self-ticking towards `endsAt` (browser ms), calling `onDone` once at zero.
 */
export function CountdownRing({
  totalSeconds,
  secondsLeft,
  endsAt,
  onDone,
  label = "Time until Shield arms",
  size = 160,
  className,
}: {
  totalSeconds: number;
  secondsLeft?: number;
  endsAt?: number;
  onDone?: () => void;
  label?: string;
  size?: number;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const done = useRef(false);
  useEffect(() => {
    if (endsAt === undefined) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  const left = secondsLeft ?? (endsAt !== undefined ? Math.max(0, (endsAt - now) / 1000) : totalSeconds);
  useEffect(() => {
    if (left <= 0 && !done.current) {
      done.current = true;
      onDone?.();
    }
    if (left > 0) done.current = false;
  }, [left, onDone]);
  const frac = totalSeconds > 0 ? Math.min(1, Math.max(0, left / totalSeconds)) : 0;
  const text = clock(left);
  return (
    <div className={cn("c-ring", className)} style={{ "--size": `${size}px` } as CSSProperties} role="timer" aria-label={`${label}: ${text}`}>
      <svg viewBox="0 0 160 160" aria-hidden>
        <circle className="c-ring-face" cx="80" cy="80" r="77" />
        <circle className="c-ring-track" cx="80" cy="80" r={R} />
        <circle className="c-ring-prog" cx="80" cy="80" r={R} strokeDasharray={CIRC.toFixed(1)} strokeDashoffset={(CIRC * (1 - frac)).toFixed(1)} />
        <circle className="c-ring-outline" cx="80" cy="80" r="56" />
        <circle className="c-ring-outline" cx="80" cy="80" r="72" />
      </svg>
      <span className="c-ring-time" aria-hidden>
        {text}
      </span>
    </div>
  );
}
