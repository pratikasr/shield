import type { ReactNode } from "react";
import { CartoonIcon } from "@/components/cartoon/icons";
import { LENDERS_SOURCE, LENDER_STATUS_TEXT, MONAD_LENDERS, SHIELD_NEXT_STEPS, formatTvl } from "@/lib/analytics";
import { cn } from "@/lib/utils";

function Level({ live, name, status, children }: { live?: boolean; name: string; status: string; children?: ReactNode }) {
  return (
    <li
      className={cn(
        "flex min-h-[150px] min-w-0 flex-col justify-between gap-3 rounded-2xl border-[2.5px] p-4 max-sm:min-h-[128px] max-sm:p-3.5",
        live ? "border-ink bg-chill-tint shadow-sticker-sm" : "border-ink-soft bg-grey-tint text-ink-soft shadow-[3px_3px_0_var(--color-ink-soft)]",
      )}
    >
      {live ? <CartoonIcon name="shield" size={32} /> : <CartoonIcon name="lock" size={36} />}
      <div className="min-w-0">
        <h3 className={cn("text-[22px] leading-tight max-sm:text-[19px]", !live && "text-ink/75")}>{name}</h3>
        <p className="m-0 mt-1 text-[14.5px] leading-snug font-semibold max-sm:text-[13.5px]">{status}</p>
        {children}
      </div>
    </li>
  );
}

function Tvl({ usd }: { usd: number }) {
  return (
    <p className="m-0 mt-1 text-[14.5px] leading-snug tnum max-sm:text-[13.5px]">
      Holds {formatTvl(usd)} on Monad
      <span className="sr-only"> in total value locked</span>
    </p>
  );
}

/**
 * The map of levels: Aave V3, the one Shield works with, then what is not built yet. First Shield's own next steps on
 * Aave, from the decision records, then the other lenders on Monad, which would each need their own exit path and
 * tests. No dates: nothing here is scheduled.
 */
export function NextLevels() {
  const [aave, ...others] = MONAD_LENDERS;
  return (
    <div className="grid gap-8">
      <div>
        <h3 className="mb-3.5 text-[24px]">On Aave V3</h3>
        <ul className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 lg:grid-cols-4" aria-label="Shield on Aave V3">
          {aave && (
            <Level live name={aave.name} status={LENDER_STATUS_TEXT.Live}>
              <Tvl usd={aave.tvlUsd} />
            </Level>
          )}
          {SHIELD_NEXT_STEPS.map((s) => (
            <Level key={s.name} name={s.name} status="Not built yet">
              <p className="m-0 mt-1 text-[14.5px] leading-snug max-sm:text-[13.5px]">{s.why}</p>
            </Level>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-3.5 text-[24px]">Other lenders on Monad</h3>
        <ul className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 lg:grid-cols-4" aria-label="Other lenders on Monad">
          {others.map((l) => (
            <Level key={l.name} name={l.name} status={LENDER_STATUS_TEXT[l.status]}>
              <Tvl usd={l.tvlUsd} />
            </Level>
          ))}
        </ul>
        <p className="m-0 mt-4 max-w-[52em] text-[14.5px] text-ink-soft">
          Each of these would need its own exit path and its own tests against the real lender before Shield could step in there. What each one holds
          is from {LENDERS_SOURCE.name} on {LENDERS_SOURCE.date} (
          <a href={LENDERS_SOURCE.url} target="_blank" rel="noreferrer" className="c-link">
            api.llama.fi/protocols
          </a>
          ).
        </p>
      </div>
    </div>
  );
}
