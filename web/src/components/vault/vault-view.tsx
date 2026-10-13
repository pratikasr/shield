"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { FundingSource } from "@/components/aurora/funding-source";
import { ExitTable } from "@/components/borrow/history";
import { useSentLock } from "@/components/borrow/cover-shared";
import { AmountHint, AmountInput } from "@/components/data/amount-input";
import { HashLink } from "@/components/data/hash-link";
import { Info } from "@/components/data/info";
import { Panel, Stat } from "@/components/data/stat";
import { TokenIcon } from "@/components/data/token";
import { SwitchButton, useWrongNetwork } from "@/components/shell/network-guard";
import { TxStatus } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VaultIncome, headlineUsd } from "@/components/vault/vault-income";
import { useShieldConfig, vaultPremiumShare } from "@/hooks/useShieldConfig";
import { useTx } from "@/hooks/useTx";
import { useVault, type VaultState } from "@/hooks/useVault";
import { erc20Abi, shieldVaultAbi } from "@/lib/abis";
import { amountText, checkAmount, unitsUsd } from "@/lib/amount";
import { BLOCKS_PER_YEAR } from "@/lib/economics";
import { useIndexerQuery } from "@/hooks/useIndexer";
import { PROTECTED_RATE_LIMIT, VAULT_HISTORY, historyError, type ExitRow, type PositionRow, type VaultFlowRow } from "@/lib/envio";
import { aave, collateralName, envioUrl, isDeployed, shield } from "@/lib/env";
import { firstLine, formatDiscount, formatDuration, formatPct, formatToken, formatUsd, timeAgo, toNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface VaultHistory {
  VaultStats: { deposited: string; withdrawn: string; premiumEarned: string; exitsExecuted: number; depositors: number }[];
  Exit: ExitRow[];
  flashExits: { txHash: string }[];
  Position: PositionRow[];
  protectedRates: { premiumPerBlock: string }[];
  everCovered: { borrower: string }[];
  VaultFlow: VaultFlowRow[];
}

const FLOW_LABEL: Record<VaultFlowRow["kind"], string> = {
  Deposit: "Deposit",
  Withdraw: "Withdrawal",
  Premium: "Premium swept in",
  ExitFunded: "Exit funded",
  CollateralReceived: "Collateral received",
  Unwound: "Collateral sold",
};

/** Seconds the vault page waits for its first reading before it says the RPC is not answering. */
const LOAD_TIMEOUT_MS = 10_000;

const th = "px-3 pb-2.5 font-medium first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";
const td = "px-3 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";

type VaultUser = NonNullable<VaultState["user"]>;

function DepositForm({ u, vault, refetch }: { u?: VaultUser; vault?: VaultState; refetch: () => Promise<unknown> }) {
  const { address } = useAccount();
  const wrong = useWrongNetwork();
  const tx = useTx();
  const lock = useSentLock();
  const [deposit, setDeposit] = useState("");
  const check = checkAmount(deposit, { balance: u?.usdcBalance });
  const shares = vault && vault.sharePrice > 0 && check.units > 0n ? Number(formatUnits(check.units, 6)) / vault.sharePrice : 0;
  const needsApproval = Boolean(u && check.units > 0n && u.usdcAllowance < check.units);
  const approveKey = `approve:${check.units}`;
  const after = async (receipt: unknown, key?: string) => {
    if (!receipt) return false;
    if (key) lock.hold(key);
    await refetch();
    return true;
  };
  return (
    <>
      <Label htmlFor="deposit">Amount, USDC</Label>
      <AmountInput
        id="deposit"
        size="lg"
        value={deposit}
        onChange={setDeposit}
        onMax={() => u && setDeposit(amountText(u.usdcBalance))}
        maxDisabled={!u || u.usdcBalance === 0n}
        check={check}
        hintId="deposit-help"
      />
      <div className="flex items-center justify-between text-[0.8125rem] text-muted-foreground num">
        <span>You receive</span>
        <span className="text-foreground">{shares > 0 ? `${shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shUSDC` : "0 shUSDC"}</span>
      </div>
      <AmountHint id="deposit-help" check={check}>
        Shares are priced at the vault&rsquo;s value now; exit gains reach the share price over {formatDuration(vault?.profitUnlockSeconds ?? 21_600)}.
      </AmountHint>
      {wrong ? (
        <SwitchButton action="deposit" size="lg" className="h-12 w-full" />
      ) : needsApproval ? (
        <Button
          className="h-12 w-full"
          size="lg"
          disabled={tx.busy || !check.ok || lock.isHeld(approveKey)}
          onClick={async () =>
            // The typed amount stays after the approval, so the deposit is one more click.
            after(await tx.send("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.vault!, check.units] }, { context: "vault" }), approveKey)
          }
        >
          Approve USDC
        </Button>
      ) : (
        <Button
          className="h-12 w-full"
          size="lg"
          disabled={tx.busy || !check.ok || !u}
          onClick={async () => {
            if (await after(await tx.send("Deposit", { address: shield.vault!, abi: shieldVaultAbi, functionName: "deposit", args: [check.units, address!] }, { context: "vault" }))) setDeposit("");
          }}
        >
          {tx.busy ? "Check your wallet" : deposit.trim() === "" ? "Enter an amount" : `Deposit ${check.units > 0n ? unitsUsd(check.units) : ""}`}
        </Button>
      )}
      <TxStatus state={tx.state} />
    </>
  );
}

function WithdrawForm({ u, vault, refetch }: { u?: VaultUser; vault?: VaultState; refetch: () => Promise<unknown> }) {
  const { address } = useAccount();
  const wrong = useWrongNetwork();
  const tx = useTx();
  const [withdraw, setWithdraw] = useState("");
  // Max redeems the exact share count, so no dust of shares is left behind.
  const [maxShares, setMaxShares] = useState<bigint>();
  const check = checkAmount(withdraw, {
    available: u?.maxWithdraw,
    availableMessage: (a) =>
      `Only ${unitsUsd(a)} is available now. The rest is collateral from exits, which leaves the vault only when it is sold. Lower the amount or use Max.`,
  });
  const slippage = `${(vault?.maxSwapSlippageBps ?? 300) / 100}%`;
  return (
    <>
      <Label htmlFor="withdraw-lp">Amount, USDC</Label>
      <AmountInput
        id="withdraw-lp"
        size="lg"
        value={withdraw}
        onChange={(v) => {
          setWithdraw(v);
          setMaxShares(undefined);
        }}
        onMax={() => {
          if (!u) return;
          setWithdraw(amountText(u.maxWithdraw));
          setMaxShares(u.maxRedeem);
        }}
        maxDisabled={!u || u.maxWithdraw === 0n}
        check={check}
        hintId="withdraw-lp-help"
      />
      <AmountHint id="withdraw-lp-help" check={check}>
        Available now: <span className="text-foreground num">{u ? unitsUsd(u.maxWithdraw) : "..."}</span>. Collateral the vault took at exits counts toward
        its value but stays in Aave, and cannot be withdrawn, until the owner or the unwinder sells it through the swap adapter for no less than
        Aave&rsquo;s price minus {slippage}.
      </AmountHint>
      {wrong ? (
        <SwitchButton action="withdraw" size="lg" className="h-12 w-full" />
      ) : (
        <Button
          className="h-12 w-full"
          size="lg"
          variant="outline"
          disabled={tx.busy || !check.ok || !u}
          onClick={async () => {
            const req =
              maxShares !== undefined && maxShares > 0n
                ? { address: shield.vault!, abi: shieldVaultAbi, functionName: "redeem", args: [maxShares, address!, address!] }
                : { address: shield.vault!, abi: shieldVaultAbi, functionName: "withdraw", args: [check.units, address!, address!] };
            if (await tx.send("Withdrawal", req, { context: "vault" })) {
              await refetch();
              setWithdraw("");
              setMaxShares(undefined);
            }
          }}
        >
          {tx.busy ? "Check your wallet" : withdraw.trim() === "" ? "Enter an amount" : `Withdraw ${check.units > 0n ? unitsUsd(check.units) : ""}`}
        </Button>
      )}
      <TxStatus state={tx.state} />
    </>
  );
}

/** Why deposits are closed to this account, and what is planned. */
function DepositsClosed({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg bg-raised p-4 text-sm", className)} role="note">
      <p className="flex items-center gap-2 font-medium">
        <Lock className="size-4 text-muted-foreground" aria-hidden />
        Deposits are closed to this wallet
      </p>
      <p className="mt-1 text-muted-foreground">
        The vault is funded by the protocol at launch, so only the protocol treasury can deposit. Outside liquidity providers are planned; the owner can add
        them to the depositor list later, without a new contract. Withdrawals need no place on the list: any shareholder can withdraw up to the USDC the
        vault holds.
      </p>
    </div>
  );
}

function DepositWithdraw() {
  const { address, isConnected } = useAccount();
  const wrong = useWrongNetwork();
  const { vault, refetch } = useVault(isConnected ? address : undefined);
  const [tab, setTab] = useState("deposit");

  if (!isConnected) {
    return (
      <div className="panel p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <TokenIcon symbol="USDC" size={32} />
          <div>
            <h2 className="text-lg font-semibold">Funded by the protocol</h2>
            <p className="text-[0.8125rem] text-muted-foreground">Deposits come from the protocol treasury only</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          The vault is funded by the protocol at launch, and outside liquidity providers are planned. Anyone holding shares can withdraw, up to the USDC the
          vault holds: connect the wallet that holds them.
        </p>
        <ConnectButton.Custom>
          {({ openConnectModal }) => (
            <Button className="mt-5 h-12 w-full" size="lg" onClick={openConnectModal}>
              Connect wallet
            </Button>
          )}
        </ConnectButton.Custom>
      </div>
    );
  }
  const u = vault?.user;
  // Undefined means the vault has no allowlist to read (an older deployment): deposits are open, as before.
  const allowed = u ? u.depositAllowed !== false : undefined;
  const holds = (u?.shares ?? 0n) > 0n;

  return (
    <section aria-labelledby="dw-heading" className="panel overflow-hidden">
      <h2 id="dw-heading" className="sr-only">
        {allowed === false ? "Withdraw" : "Deposit or withdraw"}
      </h2>
      <dl className="grid grid-cols-2 gap-4 border-b px-5 py-5 sm:px-6">
        <Stat size="sm" label="Your shares' value" value={u ? formatUsd(u.assets) : "..."} />
        {allowed === false ? (
          <Stat size="sm" label="Withdrawable now" value={u ? unitsUsd(u.maxWithdraw) : "..."} />
        ) : (
          <Stat size="sm" label="Wallet USDC" value={u ? unitsUsd(u.usdcBalance) : "..."} />
        )}
      </dl>
      <div className="px-5 py-5 sm:px-6">
        {allowed === undefined ? (
          <div className="space-y-3" aria-busy="true" aria-label="Reading the vault">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : allowed ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="deposit">Deposit</TabsTrigger>
              <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
            </TabsList>
            <TabsContent value="deposit" className="mt-5">
              {address && (
                <FundingSource kind="vault" owner={address} refundTo={address} wrongNetwork={wrong} onSwept={() => void refetch()}>
                  <DepositForm u={u} vault={vault} refetch={refetch} />
                </FundingSource>
              )}
            </TabsContent>
            <TabsContent value="withdraw" className="mt-5 space-y-3">
              <WithdrawForm u={u} vault={vault} refetch={refetch} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-3">
            <DepositsClosed />
            {holds ? (
              <div className="space-y-3 pt-2">
                <WithdrawForm u={u} vault={vault} refetch={refetch} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This wallet holds no vault shares, so there is nothing to withdraw.</p>
            )}
          </div>
        )}
      </div>
      <p className="flex items-start gap-2 border-t bg-raised/60 px-5 py-4 text-[0.75rem] text-muted-foreground sm:px-6">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          ERC-4626 vault, funded by the protocol. It pays out only to fund exits and to shareholders who withdraw; its share of premiums and the exit discounts
          accrue to every share. Collateral from exits leaves only when the owner or the unwinder sells it through the swap adapter within the slippage bound,
          and a sale can cost more than the discount earned.
        </span>
      </p>
    </section>
  );
}

function Composition({ vault }: { vault: VaultState }) {
  const total = Math.max(vault.gross, 1e-9);
  const parts = [
    { label: "USDC", value: vault.usdcOnHand, cls: "bg-brand" },
    { label: "Collateral from exits", value: vault.collateralHeld, cls: "bg-caution" },
    { label: "Premium to sweep", value: vault.premiumPending, cls: "bg-safe" },
  ];
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {parts.map((p) => (
          <span key={p.label} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[0.8125rem]">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-muted-foreground">
            <span className={`size-2 rounded-full ${p.cls}`} aria-hidden />
            {p.label} <span className="font-medium text-foreground num">{formatUsd(p.value)}</span>
          </li>
        ))}
        {vault.lockedProfit > 0 && (
          <li className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2 rounded-full border border-muted-foreground" aria-hidden />
            Exit gains unlocking <span className="font-medium text-foreground num">{formatUsd(vault.lockedProfit)}</span>
          </li>
        )}
      </ul>
      {vault.lockedProfit > 0 && (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          Exit gains reach the share price evenly over {formatDuration(vault.profitUnlockSeconds)}, so the vault value is the parts above less{" "}
          {formatUsd(vault.lockedProfit)} still unlocking.
        </p>
      )}
    </div>
  );
}

function Empty({ children, tone }: { children: React.ReactNode; tone?: "caution" }) {
  return (
    <p className={tone ? "px-5 py-6 text-center text-sm text-caution sm:px-6" : "px-5 py-8 text-center text-sm text-muted-foreground sm:px-6"} role={tone ? "status" : undefined}>
      {children}
    </p>
  );
}

function FlowAmount({ f }: { f: VaultFlowRow }) {
  const usdc = formatUsd(toNumber(BigInt(f.assets), 6));
  if (f.kind === "CollateralReceived" || f.kind === "Unwound") {
    const c = collateralName(f.collateral ?? undefined);
    return (
      <>
        <span className="block">{formatToken(toNumber(BigInt(f.collateralAmount), c.decimals), c.symbol)}</span>
        <span className="block text-[0.8125rem] text-muted-foreground">{f.kind === "Unwound" ? `sold for ${usdc}` : `worth ${usdc} at Aave's price`}</span>
      </>
    );
  }
  return <>{usdc}</>;
}

export function VaultView() {
  const { address, isConnected } = useAccount();
  const { vault, isLoading, error, refetch } = useVault(isConnected ? address : undefined);
  const { config } = useShieldConfig();
  const history = useIndexerQuery<VaultHistory>(["vault-history"], VAULT_HISTORY);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (vault) return;
    const t = setTimeout(() => setWaited(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [vault]);

  if (!isDeployed) {
    return (
      <div className="panel mx-auto max-w-xl p-8 text-center">
        <h1 className="text-2xl font-semibold">Shield is not configured</h1>
        <p className="mt-3 text-muted-foreground">This build has no contract addresses. Set the NEXT_PUBLIC_SHIELD_* variables or run scripts/web-env.sh.</p>
      </div>
    );
  }

  const h = history.data;
  const indexerDown = Boolean(envioUrl && history.error);
  const rates = h?.protectedRates ?? [];
  const activeRatePerBlock = rates.reduce((sum, p) => sum + toNumber(BigInt(p.premiumPerBlock ?? "0"), 18), 0);
  // What the vault keeps of what covers pay: the protocol's share goes to the treasury (ADR-037).
  const premiumRate = vault && config && vault.nav > 0 ? (activeRatePerBlock * vaultPremiumShare(config) * BLOCKS_PER_YEAR) / vault.nav : undefined;
  const sharePct = config ? config.protocolShareBps / 100 : undefined;
  const premiumRateText = !envioUrl || indexerDown ? "Unavailable" : !h ? undefined : activeRatePerBlock === 0 ? "No active covers" : premiumRate !== undefined ? `${formatPct(premiumRate)} a year` : undefined;
  const flashUsed = (h?.flashExits.length ?? 0) > 0;
  const listState = (rows: unknown[] | undefined, empty: string): { text: string; tone?: "caution" } | null =>
    !envioUrl
      ? { text: "History comes from the Envio indexer. Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to show it." }
      : indexerDown
        ? { text: historyError(history.error), tone: "caution" }
        : !rows
          ? { text: "Loading." }
          : rows.length
            ? null
            : { text: empty };
  const exitsEmpty = listState(h?.Exit, "No exits yet. Each exit the vault funds appears here with what it saved the borrower against Aave's bonus.");
  const positionsEmpty = listState(
    h?.Position,
    (h?.everCovered.length ?? 0) > 0 ? "No active covers. Borrowers who opt in again appear here." : "No covered positions yet. Borrowers appear here when they opt in.",
  );
  const flowsEmpty = listState(h?.VaultFlow, "No activity yet. Deposits, premiums and exits appear here.");
  const discount = config ? `${config.exitDiscountBps / 100}%` : "1%";
  const showError = !vault && (error || waited);

  return (
    <div className="grid gap-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
            <TokenIcon symbol="USDC" size={18} />
            Shield vault, USDC
          </p>
          <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.02em]">The vault that funds exits</h1>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            Funded by the protocol. The vault repays covered borrowers&rsquo; debt at their trigger and takes collateral worth {discount} more, held in Aave until
            it is sold. It keeps{" "}
            {/* A fixed-width slot, so the sentence does not reflow when the registry answers. */}
            <span className="inline-block min-w-[1.9em] num">{sharePct !== undefined ? `${100 - sharePct}%` : " "}</span> of every premium, block by block,
            and the protocol treasury holds its shares.
          </p>
        </div>
        {/* Phones: a wrapped label must not push its value below its neighbour's. Desktop: labels share one height. */}
        <dl className="grid grid-cols-2 items-end gap-x-8 gap-y-4 sm:grid-cols-3 sm:items-start lg:flex lg:gap-x-10" aria-busy={!vault}>
          <Stat
            label={
              <>
                Vault value
                <Info>
                  USDC the vault holds, plus collateral it took at exits valued at Aave&rsquo;s oracle, plus premium accrued at the Repricer and not yet swept in,
                  less exit gains still unlocking. Exit gains reach the share price evenly over {formatDuration(vault?.profitUnlockSeconds ?? 21_600)}, so a
                  deposit made just before an exit cannot take the discount earned by the shares that carried the cover.
                </Info>
              </>
            }
            value={vault ? formatUsd(vault.nav) : <Skeleton className="h-7 w-24" />}
          />
          <Stat
            label={
              <>
                Premium rate, variable
                <Info>
                  What every Protected cover pays per block right now, less the {sharePct !== undefined ? `${sharePct}% ` : "share "}paid to the treasury directly, times a
                  year of 300&nbsp;ms blocks, over the vault&rsquo;s value. Variable: it moves with health factors, volatility and how many borrowers are covered. Read from the indexer.
                  The exit discount comes on top.
                </Info>
              </>
            }
            value={!vault || premiumRateText === undefined ? <Skeleton className="h-7 w-24" /> : premiumRateText}
          />
          <Stat label="Share price" value={vault ? vault.sharePrice.toFixed(4) : <Skeleton className="h-7 w-20" />} hint="USDC per shUSDC" />
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-1">
          <Panel title="Vault overview" labelledBy="overview-heading">
            {showError ? (
              <div role="alert">
                <p className="text-sm text-danger">
                  {error
                    ? `Could not read the vault from Monad: ${firstLine(error.message)}.`
                    : `The vault has not answered for ${LOAD_TIMEOUT_MS / 1000} seconds; the Monad RPC may be down or slow.`}{" "}
                  Check your connection and retry.
                </p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => void refetch()}>
                  Retry
                </Button>
              </div>
            ) : isLoading || !vault ? (
              <div aria-busy="true" aria-label="Loading vault">
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="mt-3 h-5 w-full max-w-md" />
                <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-5 border-t pt-5 sm:grid-cols-3">
                  {["Premium earned", "Exits executed", "Average discount captured"].map((l) => (
                    <Stat key={l} label={l} value={<Skeleton className="h-7 w-20" />} hint={<Skeleton className="h-4 w-24" />} />
                  ))}
                </dl>
              </div>
            ) : (
              <>
                <Composition vault={vault} />
                <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-5 border-t pt-5 sm:grid-cols-3">
                  <Stat label="Premium earned" value={headlineUsd(vault.premiumEarned)} hint="The vault's share, counted every block" />
                  <Stat
                    label="Exits executed"
                    value={vault.exitsExecuted.toLocaleString("en-US")}
                    hint={vault.exitsExecuted === 0 ? "None yet" : flashUsed ? "Including flash-assisted exits" : h ? "Funded by this vault" : "Exits this vault took part in"}
                  />
                  <Stat
                    label={
                      <>
                        Average discount captured
                        <Info>
                          Collateral value received over debt repaid, on exits the vault funded alone. Exits that needed an Aave flash loan are left out: their swap
                          and flash fee come out of the discount.
                        </Info>
                      </>
                    }
                    value={vault.averageDiscountBps > 0 ? formatDiscount(vault.averageDiscountBps) : "None yet"}
                    hint="On exits the vault funded alone"
                  />
                </dl>
              </>
            )}
          </Panel>
        </div>

        <aside className="min-w-0 self-start lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="Fund or withdraw">
          <DepositWithdraw />
        </aside>

        <div className="grid min-w-0 gap-6 self-start lg:col-start-1">
          <VaultIncome vault={vault} config={config} />
          <Panel bodyClassName="p-0 sm:p-0" className="overflow-hidden">
            <Tabs defaultValue="exits">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
                <h2 className="text-base font-semibold">Activity</h2>
                <TabsList>
                  <TabsTrigger value="exits">Exits</TabsTrigger>
                  <TabsTrigger value="positions">Covered positions</TabsTrigger>
                  <TabsTrigger value="flows">Vault flows</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="exits" className="mt-4">
                {exitsEmpty ? <Empty tone={exitsEmpty.tone}>{exitsEmpty.text}</Empty> : <ExitTable rows={h!.Exit} borrowerColumn />}
              </TabsContent>
              <TabsContent value="positions" className="mt-4">
                {positionsEmpty ? (
                  <Empty tone={positionsEmpty.tone}>{positionsEmpty.text}</Empty>
                ) : (
                  <div className="relative overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b text-[0.75rem] text-muted-foreground">
                          <th scope="col" className={th}>Borrower</th>
                          <th scope="col" className={th}>Status</th>
                          <th scope="col" className={`${th} text-right`}>Trigger</th>
                          <th scope="col" className={`${th} text-right`}>Premium paid</th>
                          <th scope="col" className={`${th} text-right`}>Reprices</th>
                        </tr>
                      </thead>
                      <tbody className="num">
                        {h?.Position.map((p) => (
                          <tr key={p.borrower} className="border-b last:border-b-0">
                            <td className={td}><HashLink value={p.borrower} kind="address" /></td>
                            <td className={td}>
                              <span className={p.status === "Protected" ? "inline-flex items-center gap-1.5 text-safe" : "inline-flex items-center gap-1.5 text-caution"}>
                                <span className={p.status === "Protected" ? "size-1.5 rounded-full bg-safe" : "size-1.5 rounded-full bg-caution"} aria-hidden />
                                {p.status === "Protected" ? "Paid up" : "Lapsed"}
                              </span>
                            </td>
                            <td className={`${td} text-right`}>{(p.trigger / 1e4).toFixed(2)}</td>
                            <td className={`${td} text-right`}>{formatUsd(toNumber(BigInt(p.premiumPaid), 18))}</td>
                            <td className={`${td} text-right`}>{p.repriceCount.toLocaleString("en-US")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!positionsEmpty && rates.length >= PROTECTED_RATE_LIMIT && (
                  <p className="border-t px-5 py-3 text-[0.8125rem] text-muted-foreground sm:px-6">The premium rate counts the first {PROTECTED_RATE_LIMIT} paid-up covers.</p>
                )}
              </TabsContent>
              <TabsContent value="flows" className="mt-4">
                {flowsEmpty ? (
                  <Empty tone={flowsEmpty.tone}>{flowsEmpty.text}</Empty>
                ) : (
                  <div className="relative overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b text-[0.75rem] text-muted-foreground">
                          <th scope="col" className={th}>What</th>
                          <th scope="col" className={`${th} text-right`}>Amount</th>
                          <th scope="col" className={th}>When</th>
                          <th scope="col" className={th}>Transaction</th>
                        </tr>
                      </thead>
                      <tbody className="num">
                        {h?.VaultFlow.map((f) => (
                          <tr key={f.txHash + f.kind + f.blockNumber} className="border-b last:border-b-0">
                            <td className={td}>{FLOW_LABEL[f.kind]}</td>
                            <td className={`${td} text-right`}>
                              <FlowAmount f={f} />
                            </td>
                            <td className={`${td} text-muted-foreground`}>{timeAgo(Number(f.timestamp))}</td>
                            <td className={td}><HashLink value={f.txHash} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </Panel>
        </div>
      </div>
    </div>
  );
}
