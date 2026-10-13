"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { prefersReducedMotion } from "./motion";

const COLORS = ["#6A4CF5", "#2FD47F", "#FFC93C", "#FF5A4E", "#FF9BD8", "#85E6FF", "#FFFFFF"];

interface Piece {
  id: number;
  x: number;
  y: number;
  style: CSSProperties;
  round: boolean;
}

/**
 * One confetti burst, no library: 72 pieces fly up and fall, then the layer empties. Fires when `fire` changes to a
 * new truthy value. The burst starts at `origin` (an element, or viewport x and y), or the middle of the screen.
 * Nothing renders under prefers-reduced-motion.
 */
export function Confetti({ fire, origin, count = 72 }: { fire: number | boolean | string | undefined; origin?: RefObject<HTMLElement | null> | { x: number; y: number }; count?: number }) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  useEffect(() => {
    if (!fire || prefersReducedMotion()) return;
    let ox = window.innerWidth / 2;
    let oy = window.innerHeight / 3;
    if (origin && "current" in origin && origin.current) {
      const r = origin.current.getBoundingClientRect();
      ox = r.left + r.width / 2;
      oy = r.top + r.height / 2;
    } else if (origin && "x" in origin) {
      ox = origin.x;
      oy = origin.y;
    }
    const base = Date.now();
    const next: Piece[] = Array.from({ length: count }, (_, i) => {
      const a = Math.random() * Math.PI * 2;
      const d = 120 + Math.random() * 300;
      return {
        id: base + i,
        x: ox,
        y: oy,
        round: i % 3 === 0,
        style: {
          left: ox,
          top: oy,
          background: COLORS[i % COLORS.length],
          "--dx": `${(Math.cos(a) * d).toFixed(0)}px`,
          "--up": `${(-90 - Math.random() * 230).toFixed(0)}px`,
          "--down": `${(160 + Math.random() * 340).toFixed(0)}px`,
          "--rot": `${(Math.random() * 720 - 360).toFixed(0)}deg`,
          "--dur": `${(1.1 + Math.random() * 0.7).toFixed(2)}s`,
        } as CSSProperties,
      };
    });
    setPieces(next);
    const t = setTimeout(() => setPieces([]), 2100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per new `fire` value
  }, [fire]);
  if (!pieces.length) return null;
  return (
    <div className="c-confetti" aria-hidden>
      {pieces.map((p) => (
        <i key={p.id} className="c-cf" data-round={p.round || undefined} style={p.style} />
      ))}
    </div>
  );
}
