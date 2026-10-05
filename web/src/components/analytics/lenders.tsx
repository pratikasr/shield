import { LENDERS_SOURCE, MONAD_LENDERS, formatTvl, type LenderStatus } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** A neutral lettered avatar: names only, no third-party logos. */
function Initials({ text, size = 32 }: { text: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full border bg-raised text-[0.6875rem] font-semibold tracking-wide text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {text}
    </span>
  );
}

function StatusChip({ status }: { status: LenderStatus }) {
  const live = status === "Live";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.75rem] font-medium",
        live ? "border-safe/30 bg-safe-soft text-safe" : "text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", live ? "bg-safe" : "bg-muted-foreground/60")} aria-hidden />
      {status}
    </span>
  );
}

export function LendersSource({ className }: { className?: string }) {
  return (
    <p className={cn("text-[0.8125rem] text-muted-foreground", className)}>
      Monad TVL from {LENDERS_SOURCE.name} as of {LENDERS_SOURCE.date} (
      <a href={LENDERS_SOURCE.url} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:text-foreground">
        api.llama.fi/protocols
      </a>
      , chain Monad, category Lending).
    </p>
  );
}

/** Lenders on Monad by TVL: Aave V3, which Shield covers, and the ones that come next. */
export function LendersList() {
  const max = Math.max(...MONAD_LENDERS.map((l) => l.tvlUsd));
  return (
    <div>
      <ul className="divide-y">
        {MONAD_LENDERS.map((l) => (
          <li key={l.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
            <Initials text={l.initials} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="font-medium">{l.name}</span>
                <StatusChip status={l.status} />
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden>
                <div className={cn("h-full rounded-full", l.status === "Live" ? "bg-foreground" : "bg-muted-foreground/45")} style={{ width: `${(l.tvlUsd / max) * 100}%` }} />
              </div>
            </div>
            <span className="text-right text-sm font-medium num">
              {formatTvl(l.tvlUsd)}
              <span className="sr-only"> total value locked on Monad</span>
            </span>
          </li>
        ))}
      </ul>
      <LendersSource className="mt-4" />
    </div>
  );
}

/** One row of lenders for the landing page. */
export function LendersStrip() {
  return (
    <div>
      <ul className="grid gap-px overflow-hidden rounded-[14px] border bg-border sm:grid-cols-2 lg:grid-cols-5">
        {MONAD_LENDERS.map((l) => (
          <li key={l.name} className="flex items-center gap-3 bg-card px-4 py-4">
            <Initials text={l.initials} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.name}</p>
              <p className="text-[0.8125rem] text-muted-foreground num">{formatTvl(l.tvlUsd)} on Monad</p>
            </div>
            <StatusChip status={l.status} />
          </li>
        ))}
      </ul>
      <LendersSource className="mt-3" />
    </div>
  );
}
