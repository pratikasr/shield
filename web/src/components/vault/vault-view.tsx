"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import { HashLink } from "@/components/data/hash-link";
import { Info } from "@/components/data/info";
import { Stat } from "@/components/data/stat";
import { useWrongNetwork } from "@/components/shell/network-guard";
import { TxStatus } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTx } from "@/hooks/useTx";
import { useVault } from "@/hooks/useVault";
import { erc20Abi, shieldVaultAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { VAULT_HISTORY, envioQuery, type ExitRow, type PositionRow, type VaultFlowRow } from "@/lib/envio";
import { aave, envioUrl, isDeployed, shield } from "@/lib/env";
import { BLOCKS_PER_DAY } from "@/lib/economics";
import { formatBps, formatHf, formatPct, formatUsd, timeAgo, toNumber, truncateHex } from "@/lib/format";

const chainId = monadMainnet.id;

interface VaultHistory {
  VaultStats: { deposited: string; withdrawn: string; premiumEarned: string; exitsExecuted: number; depositors: number }[];
  Exit: ExitRow[];
  Position: PositionRow[];
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

function DepositWithdraw() {
  const { address, isConnected } = useAccount();
  const wrong = useWrongNetwork();
  const { vault, refetch } = useVault(isConnected ? address : undefined);
  const tx = useTx();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const v = Number(amount);
  const units = Number.isFinite(v) && v > 0 ? parseUnits(v.toFixed(6), 6) : 0n;
  const busy = tx.state.phase === "signing" || tx.state.phase === "pending";
  const run = async (l: string, args: Parameters<typeof tx.send>[0]) => {
    setLabel(l);
    if (await tx.send(args)) {
      setAmount("");
      void refetch();
    }
  };

  if (!isConnected) {
    return (
      <div className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Deposit USDC</h2>
        <p className="mt-2 text-sm text-muted-foreground">Connect a wallet holding USDC on Monad to deposit or withdraw.</p>
        <ConnectButton.Custom>{({ openConnectModal }) => <Button className="mt-5 w-full" size="lg" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>
      </div>
    );
  }
  const u = vault?.user;
  return (
    <section aria-labelledby="dw-heading" className="rounded-xl border bg-card p-5 sm:p-6">
      <h2 id="dw-heading" className="sr-only">Deposit or withdraw</h2>
      <dl className="grid grid-cols-2 gap-4">
        <Stat size="sm" label="Your deposit" value={u ? formatUsd(u.assets) : "..."} />
        <Stat size="sm" label="Wallet USDC" value={u ? formatUsd(u.usdcBalance) : "..."} />
      </dl>
      <Tabs defaultValue="deposit" className="mt-5" onValueChange={() => setAmount("")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>
        <TabsContent value="deposit" className="mt-4 space-y-3">
          <Label htmlFor="deposit">Amount, USDC</Label>
          <div className="flex gap-2">
            <Input id="deposit" inputMode="decimal" className="h-11 num" placeholder="100" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
            <Button variant="outline" className="h-11" onClick={() => setAmount(String(u?.usdcBalance ?? 0))} disabled={!u}>
              Max
            </Button>
          </div>
          {u && v > u.usdcBalance && <p className="text-[0.8125rem] text-danger">This wallet holds {formatUsd(u.usdcBalance)}. Lower the amount.</p>}
          {u && u.usdcAllowance < units ? (
            <Button className="w-full" size="lg" disabled={wrong || busy || units === 0n || v > u.usdcBalance} onClick={() => void run("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.vault!, units], chainId })}>
              Approve USDC
            </Button>
          ) : (
            <Button className="w-full" size="lg" disabled={wrong || busy || units === 0n || !u || v > u.usdcBalance} onClick={() => void run("Deposit", { address: shield.vault!, abi: shieldVaultAbi, functionName: "deposit", args: [units, address!], chainId })}>
              Deposit {amount ? formatUsd(v) : ""}
            </Button>
          )}
        </TabsContent>
        <TabsContent value="withdraw" className="mt-4 space-y-3">
          <Label htmlFor="withdraw-lp">Amount, USDC</Label>
          <div className="flex gap-2">
            <Input id="withdraw-lp" inputMode="decimal" className="h-11 num" placeholder="50" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
            <Button variant="outline" className="h-11" onClick={() => setAmount((u?.maxWithdraw ?? 0).toFixed(6))} disabled={!u}>
              Max
            </Button>
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            You can withdraw up to {formatUsd(u?.maxWithdraw ?? 0)} now. Collateral the vault took at exits counts toward its value but must
            be sold back to USDC before it can be withdrawn.
          </p>
          <Button className="w-full" size="lg" variant="outline" disabled={wrong || busy || units === 0n || !u || v > u.maxWithdraw + 1e-6} onClick={() => void run("Withdrawal", { address: shield.vault!, abi: shieldVaultAbi, functionName: "withdraw", args: [units, address!, address!], chainId })}>
            Withdraw {amount ? formatUsd(v) : ""}
          </Button>
        </TabsContent>
      </Tabs>
      <TxStatus state={tx.state} label={label} className="mt-3" />
    </section>
  );
}

function Table({ title, empty, children, minWidth }: { title: string; empty: string | null; children?: React.ReactNode; minWidth: string }) {
  return (
    <section className="rounded-xl border bg-card" aria-label={title}>
      <h2 className="px-5 pt-5 text-base font-semibold sm:px-7">{title}</h2>
      {empty ? (
        <p className="px-5 pb-5 pt-2 text-sm text-muted-foreground sm:px-7">{empty}</p>
      ) : (
        <div className="overflow-x-auto px-2 pb-3 sm:px-4">
          <table className="mt-3 w-full text-left text-sm" style={{ minWidth }}>
            {children}
          </table>
        </div>
      )}
    </section>
  );
}

export function VaultView() {
  const { address, isConnected } = useAccount();
  const { vault, isLoading, error } = useVault(isConnected ? address : undefined);
  const history = useQuery({ queryKey: ["vault-history"], queryFn: () => envioQuery<VaultHistory>(VAULT_HISTORY), enabled: Boolean(envioUrl), refetchInterval: 2_000 });

  if (!isDeployed) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border bg-card p-8 text-center">
        <h1 className="text-2xl font-semibold">Shield is not configured</h1>
        <p className="mt-3 text-muted-foreground">This build has no contract addresses. Set the NEXT_PUBLIC_SHIELD_* variables or run scripts/web-env.sh.</p>
      </div>
    );
  }

  const activeRatePerBlock = (history.data?.Position ?? []).reduce((sum, p) => sum + toNumber(BigInt(p.premiumPerBlock ?? "0"), 18), 0);
  const premiumRate = vault && vault.nav > 0 && activeRatePerBlock > 0 ? (activeRatePerBlock * BLOCKS_PER_DAY * 365) / vault.nav : undefined;
  const indexerMissing = !envioUrl ? "History comes from the Envio indexer. Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to show it." : null;
  const h = history.data;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="grid min-w-0 gap-6">
        <div>
          <h1 className="text-[1.75rem] font-semibold">Provide liquidity</h1>
          <p className="mt-2 max-w-[62ch] text-muted-foreground">
            The vault funds exits in USDC. It earns every covered borrower&rsquo;s premium, block by block, and takes collateral worth
            1% more than it repays at each exit.
          </p>
        </div>
        <section aria-label="Vault readings" className="rounded-xl border bg-card p-5 sm:p-7">
          {error ? (
            <p className="text-sm text-danger" role="alert">
              Could not read the vault from Monad: {error.message.split("\n")[0]}. Check your connection and reload.
            </p>
          ) : isLoading || !vault ? (
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3" aria-busy="true" aria-label="Loading vault">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-7 w-28" />
                </div>
              ))}
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
              <Stat
                size="lg"
                className="col-span-2 sm:col-span-1"
                label={
                  <span className="flex items-center">
                    Vault value
                    <Info>
                      USDC the vault holds, plus collateral it took at exits valued at Aave&rsquo;s oracle, plus premium accrued at the
                      Repricer and not yet swept in. Nothing else counts.
                    </Info>
                  </span>
                }
                value={formatUsd(vault.nav)}
                hint={`${formatUsd(vault.usdcOnHand)} USDC, ${formatUsd(vault.collateralHeld)} collateral, ${formatUsd(vault.premiumPending)} premium to sweep`}
              />
              <Stat
                label={
                  <span className="flex items-center">
                    Premium rate now
                    <Info>
                      What every active cover pays per block right now, times a year of 300 ms blocks, over the vault&rsquo;s value. Variable:
                      it moves with health factors, volatility and how many borrowers are covered. The exit discount comes on top.
                    </Info>
                  </span>
                }
                value={premiumRate === undefined ? "No covers" : `${formatPct(premiumRate)} a year`}
                hint="Variable, before exit discounts"
              />
              <Stat label="Premium earned" value={formatUsd(vault.premiumEarned)} hint="Counts every block" />
              <Stat label="Exits executed" value={vault.exitsExecuted.toLocaleString("en-US")} />
              <Stat label="Average discount captured" value={vault.exitsExecuted ? formatBps(vault.averageDiscountBps) : "None yet"} hint="On vault-funded exits" />
              <Stat label="Share price" value={`${vault.sharePrice.toFixed(6)} USDC`} hint="Per 1 shUSDC" />
            </dl>
          )}
        </section>

        <Table
          title="Exits"
          minWidth="36rem"
          empty={indexerMissing ?? (history.error ? history.error.message : !h ? "Loading exits." : h.Exit.length ? null : "No exits yet. Each exit the vault funds appears here with the penalty it saved the borrower.")}
        >
          <thead>
            <tr className="text-[0.8125rem] text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-normal">Borrower</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Repaid</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Penalty avoided</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Health factor</th>
              <th scope="col" className="px-3 py-2 font-normal">Transaction</th>
            </tr>
          </thead>
          <tbody className="num">
            {h?.Exit.map((e) => (
              <tr key={e.txHash} className="border-t">
                <td className="px-3 py-2.5">{truncateHex(e.borrower)}</td>
                <td className="px-3 py-2.5 text-right">{formatUsd(toNumber(BigInt(e.repaid), 6))}</td>
                <td className="px-3 py-2.5 text-right text-safe">{formatUsd(toNumber(BigInt(e.savedVsAave), 6))}</td>
                <td className="px-3 py-2.5 text-right">
                  {formatHf(toNumber(BigInt(e.healthFactorBefore), 18))} to {formatHf(toNumber(BigInt(e.healthFactorAfter), 18))}
                </td>
                <td className="px-3 py-2.5"><HashLink value={e.txHash} /></td>
              </tr>
            ))}
          </tbody>
        </Table>

        <Table title="Covered positions" minWidth="32rem" empty={indexerMissing ?? (!h ? "Loading positions." : h.Position.length ? null : "No covered positions yet. Borrowers appear here when they opt in.")}>
          <thead>
            <tr className="text-[0.8125rem] text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-normal">Borrower</th>
              <th scope="col" className="px-3 py-2 font-normal">Status</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Trigger</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Premium paid</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Reprices</th>
            </tr>
          </thead>
          <tbody className="num">
            {h?.Position.map((p) => (
              <tr key={p.borrower} className="border-t">
                <td className="px-3 py-2.5"><HashLink value={p.borrower} kind="address" /></td>
                <td className={p.status === "Protected" ? "px-3 py-2.5 text-safe" : "px-3 py-2.5 text-caution"}>{p.status}</td>
                <td className="px-3 py-2.5 text-right">{(p.trigger / 1e4).toFixed(2)}</td>
                <td className="px-3 py-2.5 text-right">{formatUsd(toNumber(BigInt(p.premiumPaid), 18))}</td>
                <td className="px-3 py-2.5 text-right">{p.repriceCount.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </Table>

        <Table title="Vault activity" minWidth="30rem" empty={indexerMissing ?? (!h ? "Loading activity." : h.VaultFlow.length ? null : "No activity yet. Deposits, premiums and exits appear here.")}>
          <thead>
            <tr className="text-[0.8125rem] text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-normal">What</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">USDC</th>
              <th scope="col" className="px-3 py-2 font-normal">When</th>
              <th scope="col" className="px-3 py-2 font-normal">Transaction</th>
            </tr>
          </thead>
          <tbody className="num">
            {h?.VaultFlow.map((f) => (
              <tr key={f.txHash + f.kind + f.blockNumber} className="border-t">
                <td className="px-3 py-2.5">{FLOW_LABEL[f.kind]}</td>
                <td className="px-3 py-2.5 text-right">{formatUsd(toNumber(BigInt(f.assets), 6))}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{timeAgo(Number(f.timestamp))}</td>
                <td className="px-3 py-2.5"><HashLink value={f.txHash} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <aside className="lg:sticky lg:top-6" aria-label="Deposit or withdraw">
        <DepositWithdraw />
      </aside>
    </div>
  );
}
