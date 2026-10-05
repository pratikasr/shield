/** Shield's mark: a track with the amber tripwire across it, the rail every screen is built around. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden>
        <rect x="1" y="8" width="24" height="2" rx="1" className="fill-muted-foreground" />
        <rect x="4" y="7" width="2" height="4" rx="1" className="fill-danger" />
        <rect x="11" y="1" width="3" height="16" rx="1.5" className="fill-caution" />
        <circle cx="20.5" cy="9" r="3" className="fill-safe" />
      </svg>
      <span className="hidden text-lg font-semibold tracking-tight min-[420px]:inline" style={{ fontStretch: "125%" }}>
        Shield
      </span>
    </span>
  );
}
