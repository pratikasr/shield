import type { ReactNode } from "react";
import { C, INK } from "./mascot-art";

/** Cartoon icons from the prototype: Ink outlines, flat fills, 32 px grid. Decorative (aria-hidden). */
export type CartoonIconName = "check" | "line" | "fuel" | "lock" | "warn" | "code" | "flask" | "hand" | "battery" | "wallet" | "coin" | "shield" | "clock" | "chain";

const sw = { stroke: INK, strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<CartoonIconName, { viewBox: string; body: ReactNode }> = {
  check: { viewBox: "0 0 24 24", body: <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" {...sw} strokeWidth={3.5} /> },
  line: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <path d="M16 29c-6-2.6-10-7.5-10-14V7.5c4-.4 7-1.8 10-4.5 3 2.7 6 4.1 10 4.5V15c0 6.5-4 11.4-10 14z" fill={C.grape} {...sw} />
        <path d="M2 17h28" fill="none" {...sw} strokeDasharray="3 3.5" />
      </>
    ),
  },
  fuel: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <rect x="6" y="8" width="16" height="20" rx="3" fill={C.heads} {...sw} />
        <path d="M10 8V5h8v3M22 13l4 3v8a2 2 0 0 1-4 0v-5" fill="none" {...sw} />
        <path d="M10 14h8" {...sw} />
      </>
    ),
  },
  lock: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <rect x="7" y="14" width="18" height="14" rx="3" fill={C.heads} {...sw} />
        <path d="M11 14v-4a5 5 0 0 1 10 0v4" fill="none" {...sw} />
        <circle cx="16" cy="21" r="2" fill={INK} />
      </>
    ),
  },
  warn: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <path d="M16 4l13 23H3z" fill={C.heads} {...sw} />
        <path d="M16 12v7" {...sw} strokeWidth={3} />
        <circle cx="16" cy="23" r="1.8" fill={INK} />
      </>
    ),
  },
  code: { viewBox: "0 0 32 32", body: <path d="M11 9l-7 7 7 7M21 9l7 7-7 7M18 6l-4 20" fill="none" {...sw} strokeWidth={3} /> },
  flask: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <path d="M12 4h8M13 4v8L6 25a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3l-7-13V4" fill={C.white} {...sw} />
        <path d="M9 21h14l2 4H7z" fill={C.chill} {...sw} />
      </>
    ),
  },
  hand: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <circle cx="16" cy="16" r="12" fill={C.white} {...sw} />
        <path d="M16 9v8l5 3" fill="none" {...sw} strokeWidth={3} />
      </>
    ),
  },
  clock: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <circle cx="16" cy="16" r="12" fill={C.white} {...sw} />
        <path d="M16 9v8l5 3" fill="none" {...sw} strokeWidth={3} />
      </>
    ),
  },
  battery: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <rect x="3" y="10" width="23" height="13" rx="3" fill={C.white} {...sw} />
        <rect x="6" y="13" width="5" height="7" rx="1" fill={C.heads} stroke={INK} strokeWidth={1.5} />
        <path d="M29 14v5" {...sw} strokeWidth={3} />
      </>
    ),
  },
  wallet: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <rect x="4" y="8" width="24" height="18" rx="4" fill={C.white} {...sw} />
        <path d="M20 15h8v6h-8a3 3 0 0 1 0-6z" fill={C.heads} {...sw} />
      </>
    ),
  },
  coin: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <ellipse cx="16" cy="19" rx="11" ry="5" fill="#D69E14" {...sw} />
        <ellipse cx="16" cy="15" rx="11" ry="5" fill={C.heads} {...sw} />
      </>
    ),
  },
  chain: {
    viewBox: "0 0 32 32",
    body: (
      <>
        <rect x="3" y="11" width="15" height="10" rx="5" fill={C.white} {...sw} />
        <rect x="14" y="11" width="15" height="10" rx="5" fill="none" {...sw} />
      </>
    ),
  },
  shield: {
    viewBox: "0 0 24 28",
    body: (
      <>
        <path d="M12 26c-5.5-2.4-9-6.8-9-12.5V6c3.5-.4 6.5-1.6 9-4 2.5 2.4 5.5 3.6 9 4v7.5C21 19.2 17.5 23.6 12 26z" fill={C.grape} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
        <path d="M8 13.5l3 3 5.5-6" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
};

export function CartoonIcon({ name, size = 24, className }: { name: CartoonIconName; size?: number; className?: string }) {
  const icon = ICONS[name];
  const [, , w, h] = icon.viewBox.split(" ").map(Number);
  return (
    <svg viewBox={icon.viewBox} width={size} height={(size * h) / w} className={className} aria-hidden focusable="false">
      {icon.body}
    </svg>
  );
}
