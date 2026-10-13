"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Info } from "@/components/data/info";
import { Panel, Stat } from "@/components/data/stat";
import { Skeleton } from "@/components/ui/skeleton";
import { useIndexerQuery } from "@/hooks/useIndexer";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import type { VaultState } from "@/hooks/useVault";
import { EARNINGS_ALL, historyError, type EarningsAll } from "@/lib/envio";
import { envioUrl } from "@/lib/env";
import { formatUsd, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A dollar figure for a headline: a sub-cent amount reads "<$0.01" there (docs/DESIGN.md) and `exactly` gives it in full. */
export function headlineUsd(v: number): string {
  return v > 0 && v < 0.01 ? "<$0.01" : formatUsd(v);
}
/** "Exactly $0.0000087. " for a sub-cent amount shown as "<$0.01", else nothing. */
export function exactly(v: number): string {
  return v > 0 && v < 0.01 ? `Exactly ${formatUsd(v)}. ` : "";
}
/** A part of a whole in whole percents, "<1%" for a sliver that is not zero. */
function partOf(v: number, all: number): string {
  if (!(all > 0) || v <= 0) return "0%";
  const p = v / all;
  return p < 0.005 ? "<1%" : p > 0.995 && p < 1 ? ">99%" : `${Math.round(p * 100)}%`;
}

/** "All of Shield's income goes to the protocol: 10% of each premium to the treasury directly, the rest through the vault." */
export function SplitLine({ config, className }: { config?: Pick<ShieldConfig, "protocolShareBps">; className?: string }) {
  if (!config) return <Skeleton className={cn("h-5 w-full max-w-lg", className)} />;
  const share = config.protocolShareBps / 100;
  return (
    <p className={className}>
      {share === 0
        ? "All of Shield's income goes to the protocol: every premium and the whole exit discount go to the vault, whose shares the treasury holds."
        : `All of Shield's income goes to the protocol: ${share}% of each premium is paid to the treasury directly, and the other ${100 - share}% plus the whole exit discount go to the vault, whose shares the treasury holds.`}
    </p>
  );
}

/** What the vault's income depends on, and what is planned. Shown whatever the indexer says. */
function IncomeNotes() {
  const notes = [
    "Premium income accrues every block while covers are active, but exit income depends on volatility and timing.",
    "Between an exit and the unwind the vault holds the seized collateral and carries its price, and a flash-assisted exit pays a flash-loan fee out of its discount.",
  ];
  return (
    <div className="mt-6 border-t pt-5">
      <h3 className="text-sm font-medium">What this income depends on</h3>
      <ul className="mt-2 grid gap-1.5 text-[0.8125rem] text-muted-foreground">
        {notes.map((n) => (
          <li key={n} className="flex items-start gap-2">
            <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
            {n}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[0.8125rem] text-muted-foreground">
        <span className="font-medium text-foreground">Roadmap: outside liquidity providers.</span> The vault takes deposits from the treasury only today. If
        outside liquidity providers are enabled, the plan is 90% of income to them through the share price and 10% to the protocol.
      </p>
    </div>
  );
}

/**
 * Where Shield's income comes from, since deployment: the vault's share of premiums and the gross exit discounts, and
 * the share of premiums paid to the treasury directly. All of it goes to the protocol: the treasury holds the vault's
 * shares (ADR-039). All-time figures come from the indexer's "all" earnings bucket (ADR-038); the vault's premium
 * charged but not yet swept in is read live from the vault.
 */
export function VaultIncome({ vault, config }: { vault?: VaultState; config?: ShieldConfig }) {
  const q = useIndexerQuery<{ EarningsBucket: EarningsAll[] }>(["earnings-all"], EARNINGS_ALL, {}, true, 4_000);
  const e = q.data?.EarningsBucket[0];
  const share = config ? config.protocolShareBps / 100 : undefined;

  const toVault = e ? toNumber(BigInt(e.premiumToVault), 18) : 0;
  const toProtocol = e ? toNumber(BigInt(e.premiumToProtocol), 18) : 0;
  const charged = e ? toNumber(BigInt(e.premiumCharged), 18) : 0;
  const discount = e ? toNumber(BigInt(e.exitDiscount), 6) : 0;
  const repaid = e ? toNumber(BigInt(e.debtRepaid), 6) : 0;
  const paidOut = e ? toNumber(BigInt(e.protocolPaid), 6) : 0;
  const exits = e?.exits ?? 0;
  const all = toVault + discount + toProtocol;

  const link = (
    <Link href="/app/analytics" className="hit relative inline-flex items-center gap-1 rounded-sm text-[0.8125rem] font-medium text-brand underline-offset-4 hover:underline">
      Platform analytics
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );

  let body: React.ReactNode;
  if (!envioUrl) {
    body = <p className="text-sm text-muted-foreground">Income history comes from the Envio indexer. Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to its GraphQL endpoint to show it.</p>;
  } else if (q.error && !q.data) {
    body = (
      <p className="text-sm text-caution" role="status">
        {historyError(q.error)}
      </p>
    );
  } else if (!q.data) {
    body = (
      <div aria-busy="true" aria-label="Loading income">
        <Skeleton className="h-2.5 w-full" />
        <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-6 h-16 w-full" />
      </div>
    );
  } else if (all === 0) {
    body = (
      <p className="text-sm text-muted-foreground">
        No income yet. Premiums appear once a covered borrower is repriced, and exit discounts once an exit runs.
      </p>
    );
  } else {
    const parts = [
      { label: "Premiums to the vault", value: toVault, cls: "bg-safe" },
      { label: "Exit discounts to the vault", value: discount, cls: "bg-caution" },
      { label: "Premiums to the treasury", value: toProtocol, cls: "bg-muted-foreground/50" },
    ];
    body = (
      <>
        {/* Segments sit 2 px apart so the treasury's direct part reads as separate from the vault's parts. */}
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <span key={p.label} className={cn("h-full first:rounded-l-full last:rounded-r-full", p.cls)} style={{ width: `${(p.value / all) * 100}%`, minWidth: 4 }} />
            ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[0.8125rem] text-muted-foreground">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", p.cls)} aria-hidden />
              {p.label} <span className="font-medium text-foreground num">{partOf(p.value, all)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-5 border-t pt-5 sm:grid-cols-3">
          <Stat
            label="Premiums to the vault"
            value={headlineUsd(toVault)}
            hint={
              <>
                {exactly(toVault)}
                {share !== undefined ? `${100 - share}%` : "The vault's share"} of {formatUsd(charged)} charged.
                {vault ? ` ${formatUsd(vault.premiumPending)} of it is waiting to be swept in, live.` : ""}
              </>
            }
          />
          <Stat
            label={
              <>
                Exit discounts, gross
                <Info label="What gross means here">
                  The collateral the vault took above the debt it repaid, at Aave&rsquo;s oracle price when each exit ran. A flash-assisted exit pays its flash
                  fee and swap cost out of this, and a later sale of the collateral can fetch less, so what the vault keeps can be lower.
                </Info>
              </>
            }
            value={headlineUsd(discount)}
            hint={`${exactly(discount)}${exits.toLocaleString("en-US")} exit${exits === 1 ? "" : "s"}, ${formatUsd(repaid)} of debt repaid.`}
          />
          <Stat label="Protocol income, total" value={headlineUsd(all)} hint={`${exactly(all)}Premiums and exit discounts, to the vault and the treasury.`} />
        </dl>

        <div className="mt-6 rounded-lg bg-raised px-4 py-3 text-[0.8125rem]">
          <p className="font-medium text-foreground">
            Premiums paid to the treasury directly: <span className="num">{formatUsd(toProtocol)}</span>
          </p>
          <p className="mt-0.5 text-muted-foreground num">
            {formatUsd(paidOut)} paid to the treasury so far, {formatUsd(Math.max(toProtocol - paidOut, 0))} waiting for the next sweep. Not part of the
            vault&rsquo;s value.
          </p>
        </div>
      </>
    );
  }

  return (
    <Panel
      title="Income since launch"
      labelledBy="income-heading"
      description="Where Shield's income comes from, from the Envio indexer"
      action={link}
    >
      <SplitLine config={config} className="mb-5 text-sm" />
      {body}
      <IncomeNotes />
    </Panel>
  );
}
