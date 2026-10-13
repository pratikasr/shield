"use client";

import { LiveBlockTicker } from "@/components/cartoon/block-ticker";

/** The live Monad block ticker with a caption that says what a stamp means and whether the feed is live. */
export function LandingTicker() {
  return (
    <LiveBlockTicker
      caption={(s) => (
        <div className="c-ticker-meta">
          {s.failed ? (
            <span className="c-pill" role="status">
              <span className="c-dot" data-tone="bad" aria-hidden />
              Can&rsquo;t reach Monad right now
            </span>
          ) : (
            <span className="c-pill" role="status">
              <span className="c-dot" data-tone={s.latest === undefined ? "off" : s.stale ? "warn" : "on"} aria-hidden />
              {s.latest === undefined ? "Connecting to Monad" : s.stale ? "Reconnecting" : "Live from Monad"}
            </span>
          )}
          <span className="c-small c-muted">
            Each tile is a real Monad block. A purple stamp marks a block that holds a Shield transaction, a repricing or a rescue; tap it to open it on
            MonadVision. Shield also reads every protected loan in every block, and those reads leave nothing on chain.
          </span>
        </div>
      )}
    />
  );
}
