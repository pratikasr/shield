"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./motion";

function burstPath(): string {
  let d = "";
  const n = 14;
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? 38 : 48;
    const a = (i * Math.PI) / n;
    d += `${i ? "L" : "M"}${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)} `;
  }
  return `${d}Z`;
}
const BURST = burstPath();

/** The spinning yellow starburst ("Nice save"), placed in the top right of a relatively positioned card. */
export function Burst({ children = "Nice save" }: { children?: React.ReactNode }) {
  return (
    <div className="c-burst" aria-hidden>
      <svg viewBox="0 0 100 100">
        <path d={BURST} fill="#FFC93C" stroke="#1B1430" strokeWidth={3} strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

/**
 * A number that counts up from zero once (900 ms, ease out), formatted by `format`. Shows the final value at once
 * under reduced motion, and to screen readers always.
 */
export function CountUp({ value, format, durationMs = 900, className }: { value: number; format: (v: number) => string; durationMs?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / durationMs);
      setShown(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    setShown(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return (
    <span className={className}>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
