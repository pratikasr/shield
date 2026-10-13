"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ScoreCard } from "@/components/analytics/score-card";
import { RescueList } from "@/components/analytics/rescue-list";
import { useChainTime } from "@/components/analytics/use-live-protocol";
import { Card } from "@/components/cartoon/card";
import { Disclosure, NerdGrid } from "@/components/cartoon/disclosure";
import { CartoonIcon } from "@/components/cartoon/icons";
import { Pill } from "@/components/cartoon/sticker";
import { HashLink } from "@/components/data/hash-link";
import { Button } from "@/components/ui/button";
import { VaultArt } from "@/components/vault/vault-art";
import { VaultMoney } from "@/components/vault/vault-money";
import { useIndexerQuery } from "@/hooks/useIndexer";
import { useShieldConfig } from "@/hooks/useShieldConfig";
import { useVault } from "@/hooks/useVault";
import {
  VAULT_PAGE_QUERY,
  agoInWords,
  collateralWords,
  historyStatus,
  rescueItems,
  shareInWords,
  vaultScoreboard,
  type VaultPageData,
} from "@/lib/analytics";
import { collateralName, envioUrl, isDeployed, isFork, shield } from "@/lib/env";
import { formatBps, formatDiscount, formatDuration, formatUsd } from "@/lib/format";

/** How long the page waits for the vault's first reading before it says Monad is not answering. */
const LOAD_TIMEOUT_MS = 10_000;

function Risk({ children }: { children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-3">
      <span className="grid size-[34px] place-items-center rounded-[10px] border-2 border-ink bg-heads" aria-hidden>
        <CartoonIcon name="warn" size={20} />
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * The vault: the protocol's own pot that pays for every rescue and earns from them. Three numbers read live from the
 * vault contract, where its money comes from, the two risks, the treasury's controls (or why deposits are closed),
 * the rescues it paid for, and the rest for nerds.
 */
export function VaultView() {
  const { address, isConnected } = useAccount();
  const { vault, error, refetch } = useVault(isConnected ? address : undefined);
  const { config } = useShieldConfig();
  const now = useChainTime();
  const page = useIndexerQuery<VaultPageData>(["vault-page"], VAULT_PAGE_QUERY, {}, true, 4_000);
  const status = historyStatus(Boolean(envioUrl), Boolean(page.data), Boolean(page.error));
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (vault) return;
    const t = setTimeout(() => setWaited(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [vault]);

  const collateral = collateralWords(config?.assets.filter((a) => a.enabled).map((a) => collateralName(a.asset).priceName) ?? []);
  const exits = page.data?.Exit;
  const launchSec = Number(page.data?.launch[0]?.timestamp ?? 0) || undefined;
  const figures = vaultScoreboard({
    vault,
    unreachable: !vault && (Boolean(error) || waited),
    lastExitSec: exits?.[0] ? Number(exits[0].timestamp) : undefined,
    launchSec,
    collateral,
    now,
  });
  const rescues = useMemo(() => (exits ? rescueItems(exits, now) : undefined), [exits, now]);

  if (!isDeployed)
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="c-h3">Shield isn&rsquo;t set up in this build</h1>
        <p className="m-0 mt-3 text-ink-soft">It has no contract addresses. Set the NEXT_PUBLIC_SHIELD_* variables or run scripts/web-env.sh.</p>
      </Card>
    );

  const share = config ? shareInWords(config.protocolShareBps) : undefined;
  const slice = config ? formatBps(config.exitDiscountBps) : undefined;

  return (
    <div>
      <section className="mb-7 grid items-center gap-9 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] max-md:gap-6">
        <div className="min-w-0">
          <h1 className="c-h1">Shield&rsquo;s vault.</h1>
          <p className="m-0 mt-3.5 max-w-[32em] text-[20px] leading-normal max-sm:text-[18px]">
            The protocol&rsquo;s own pot. It pays for every rescue and earns from them. The protocol filled it at launch.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Pill dot={vault ? "on" : figures.balance.state === "unknown" ? "bad" : "off"}>{isFork ? "Live from a local copy of Monad" : "Live from Monad"}</Pill>
          </div>
        </div>
        <VaultArt className="w-full max-w-[340px] justify-self-center max-md:max-w-[220px] max-md:justify-self-start" />
      </section>

      <dl className="m-0 grid gap-4 sm:grid-cols-3" aria-label="The vault in three numbers">
        <ScoreCard label="In the vault" figure={figures.balance} />
        <ScoreCard label="Rescues paid for" figure={figures.rescues} />
        <ScoreCard label="Earned so far" figure={figures.earned} />
      </dl>
      {figures.balance.state === "unknown" && (
        <div className="mt-4 flex flex-wrap items-center gap-3" role="status">
          <p className="m-0 text-ink-soft">The vault isn&rsquo;t answering. Check your connection; the page keeps trying.</p>
          <Button size="small" variant="white" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}

      <div className="mt-[22px] grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="c-h3 mb-2">Where its money comes from</h2>
          <p className="m-0">
            Most of every fuel payment{share ? ` (the treasury keeps ${share})` : ""}, plus the {slice ?? "1%"} slice from every rescue.
          </p>
          {vault && (
            <p className="m-0 mt-2 text-[15px] text-ink-soft">
              So far: <span className="tnum font-semibold text-ink">{formatUsd(vault.premiumEarned)}</span> from fuel and{" "}
              <span className="tnum font-semibold text-ink">{formatUsd(vault.exitGains)}</span> from rescue slices.
            </p>
          )}
          <h2 className="c-h3 mt-[22px] mb-3">The two risks</h2>
          <ul className="m-0 grid list-none gap-3.5 p-0">
            <Risk>
              After a rescue the vault holds {collateral} until it swaps it back to USDC, so for a while it rides {collateral}&rsquo;s price, down as well as
              up.
            </Risk>
            <Risk>The contracts are not audited yet. A bug could lose what&rsquo;s in the vault.</Risk>
          </ul>
        </Card>
        <VaultMoney vault={vault} refetch={refetch} treasury={config?.treasury} collateral={collateral} />
      </div>

      <Card className="mt-5" aria-labelledby="vault-rescues">
        <h2 id="vault-rescues" className="c-h3 mb-4">
          Rescues the vault paid for
        </h2>
        <RescueList
          items={rescues}
          status={status}
          empty="No rescues yet. When Shield steps in for someone, it shows up here with the transaction."
          note={vault ? `The count above is read live from Monad: ${vault.exitsExecuted.toLocaleString("en-US")} so far.` : undefined}
        />
        {status === "ok" && page.error && (
          <p className="m-0 mt-4 text-[14.5px] text-ink-soft" role="status">
            History is catching up. This list is from its last answer.
          </p>
        )}
      </Card>

      <Disclosure className="mt-5" note="Read live from the vault contract on Monad.">
        <NerdGrid
          rows={[
            ["Share price", vault ? `${vault.sharePrice.toFixed(4)} USDC a share` : "..."],
            ["Vault value", vault ? formatUsd(vault.nav) : "..."],
            ["USDC it holds", vault ? formatUsd(vault.usdcOnHand) : "..."],
            [`${collateral} from rescues, at Aave's price`, vault ? formatUsd(vault.collateralHeld) : "..."],
            ["Fuel payments waiting to sweep in", vault ? formatUsd(vault.premiumPending) : "..."],
            [
              `Rescue gains unlocking over ${formatDuration(vault?.profitUnlockSeconds ?? 21_600)}`,
              vault ? formatUsd(vault.lockedProfit) : "...",
            ],
            ["Average discount captured", vault ? (vault.averageDiscountBps > 0 ? formatDiscount(vault.averageDiscountBps) : "None yet") : "..."],
            ["Treasury's direct share of fuel", config ? formatBps(config.protocolShareBps) : "..."],
            ["Most a sale may fall short of Aave's price", vault ? formatBps(vault.maxSwapSlippageBps) : "..."],
            ["Launched", launchSec ? (agoInWords(launchSec, now) ?? "...") : status === "ok" ? "Not yet" : "Needs the history service"],
            ["Vault contract", <HashLink key="v" value={shield.vault!} kind="address" />],
            ["Treasury", config ? <HashLink key="t" value={config.treasury} kind="address" /> : "..."],
          ]}
        />
      </Disclosure>
    </div>
  );
}
