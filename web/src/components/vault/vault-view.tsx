"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import { HashLink } from "@/components/data/hash-link";
import { Info } from "@/components/data/info";
import { Panel, Stat } from "@/components/data/stat";
import { TokenIcon } from "@/components/data/token";
import { useWrongNetwork } from "@/components/shell/network-guard";
import { TxStatus } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTx } from "@/hooks/useTx";
import { useVault, type VaultState } from "@/hooks/useVault";
import { erc20Abi, shieldVaultAbi } from "@/lib/abis";
import { monadMainnet } from "@/lib/chains";
import { VAULT_HISTORY, envioQuery, type ExitRow, type PositionRow, type VaultFlowRow } from "@/lib/envio";
import { aave, envioUrl, isDeployed, shield } from "@/lib/env";
import { BLOCKS_PER_DAY } from "@/lib/economics";
import { formatBps, formatHf, formatPct, formatUsd, timeAgo, toNumber } from "@/lib/format";

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

const th = "px-3 pb-2.5 font-medium first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";
const td = "px-3 py-3 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6";

function AmountField({ id, value, onChange, onMax, maxDisabled }: { id: string; value: string; onChange: (v: string) => void; onMax: () => void; maxDisabled?: boolean }) {
  return (
    <div className="relative">
      <TokenIcon symbol="USDC" size={24} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />
      <Input id={id} inputMode="decimal" className="h-14 pl-12 pr-16 text-lg num" placeholder="0.00" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} />
      <button
        type="button"
        className="absolute right-2.5 top-1/2 h-8 -translate-y-1/2 rounded-md px-2.5 text-[0.8125rem] font-medium text-brand hover:bg-brand-soft disabled:opacity-50"
        onClick={onMax}
        disabled={maxDisabled}
      >
        Max
      </button>
    </div>
  );
}

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
      <div className="panel p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <TokenIcon symbol="USDC" size={32} />
          <div>
            <h2 className="text-lg font-semibold">Deposit USDC</h2>
            <p className="text-[0.8125rem] text-muted-foreground">Receive shUSDC, the vault&rsquo;s share token</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Connect a wallet holding USDC on Monad to deposit or withdraw.</p>
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
  const shares = vault && vault.sharePrice > 0 && v > 0 ? v / vault.sharePrice : 0;
  return (
    <section aria-labelledby="dw-heading" className="panel overflow-hidden">
      <h2 id="dw-heading" className="sr-only">
        Deposit or withdraw
      </h2>
      <dl className="grid grid-cols-2 gap-4 border-b px-5 py-5 sm:px-6">
        <Stat size="sm" label="Your deposit" value={u ? formatUsd(u.assets) : "..."} />
        <Stat size="sm" label="Wallet USDC" value={u ? formatUsd(u.usdcBalance) : "..."} />
      </dl>
      <div className="px-5 py-5 sm:px-6">
        <Tabs defaultValue="deposit" onValueChange={() => setAmount("")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deposit">Deposit</TabsTrigger>
            <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
          </TabsList>
          <TabsContent value="deposit" className="mt-5 space-y-3">
            <Label htmlFor="deposit">Amount, USDC</Label>
            <AmountField id="deposit" value={amount} onChange={setAmount} onMax={() => setAmount(String(u?.usdcBalance ?? 0))} maxDisabled={!u} />
            <div className="flex items-center justify-between text-[0.8125rem] text-muted-foreground num">
              <span>You receive</span>
              <span className="text-foreground">{shares > 0 ? `${shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shUSDC` : "0 shUSDC"}</span>
            </div>
            {u && v > u.usdcBalance && <p className="text-[0.8125rem] text-danger">This wallet holds {formatUsd(u.usdcBalance)}. Lower the amount.</p>}
            {u && u.usdcAllowance < units ? (
              <Button className="h-12 w-full" size="lg" disabled={wrong || busy || units === 0n || v > u.usdcBalance} onClick={() => void run("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.vault!, units], chainId })}>
                Approve USDC
              </Button>
            ) : (
              <Button className="h-12 w-full" size="lg" disabled={wrong || busy || units === 0n || !u || v > u.usdcBalance} onClick={() => void run("Deposit", { address: shield.vault!, abi: shieldVaultAbi, functionName: "deposit", args: [units, address!], chainId })}>
                {busy ? "Check your wallet" : `Deposit ${amount ? formatUsd(v) : ""}`}
              </Button>
            )}
          </TabsContent>
          <TabsContent value="withdraw" className="mt-5 space-y-3">
            <Label htmlFor="withdraw-lp">Amount, USDC</Label>
            <AmountField id="withdraw-lp" value={amount} onChange={setAmount} onMax={() => setAmount((u?.maxWithdraw ?? 0).toFixed(6))} maxDisabled={!u} />
            <p className="text-[0.8125rem] text-muted-foreground">
              Available now: <span className="text-foreground num">{formatUsd(u?.maxWithdraw ?? 0)}</span>. Collateral the vault took at exits counts toward
              its value and is sold back to USDC before it can be withdrawn.
            </p>
            <Button className="h-12 w-full" size="lg" variant="outline" disabled={wrong || busy || units === 0n || !u || v > u.maxWithdraw + 1e-6} onClick={() => void run("Withdrawal", { address: shield.vault!, abi: shieldVaultAbi, functionName: "withdraw", args: [units, address!, address!], chainId })}>
              Withdraw {amount ? formatUsd(v) : ""}
            </Button>
          </TabsContent>
        </Tabs>
        <TxStatus state={tx.state} label={label} className="mt-3" />
      </div>
      <p className="flex items-start gap-2 border-t bg-raised/60 px-5 py-4 text-[0.75rem] text-muted-foreground sm:px-6">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        ERC-4626 vault. It pays out only to fund exits and to withdrawing depositors; premiums and exit discounts accrue to every share.
      </p>
    </section>
  );
}

function Composition({ vault }: { vault: VaultState }) {
  const total = Math.max(vault.nav, 1e-9);
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
      </ul>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-muted-foreground sm:px-6">{children}</p>;
}

export function VaultView() {
  const { address, isConnected } = useAccount();
  const { vault, isLoading, error } = useVault(isConnected ? address : undefined);
  const history = useQuery({ queryKey: ["vault-history"], queryFn: () => envioQuery<VaultHistory>(VAULT_HISTORY), enabled: Boolean(envioUrl), refetchInterval: 2_000 });

  if (!isDeployed) {
    return (
      <div className="panel mx-auto max-w-xl p-8 text-center">
        <h1 className="text-2xl font-semibold">Shield is not configured</h1>
        <p className="mt-3 text-muted-foreground">This build has no contract addresses. Set the NEXT_PUBLIC_SHIELD_* variables or run scripts/web-env.sh.</p>
      </div>
    );
  }

  const activeRatePerBlock = (history.data?.Position ?? []).reduce((sum, p) => sum + toNumber(BigInt(p.premiumPerBlock ?? "0"), 18), 0);
  const premiumRate = vault && vault.nav > 0 && activeRatePerBlock > 0 ? (activeRatePerBlock * BLOCKS_PER_DAY * 365) / vault.nav : undefined;
  const h = history.data;
  const listState = (rows: unknown[] | undefined, empty: string) =>
    !envioUrl ? "History comes from the Envio indexer. Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to show it." : history.error ? history.error.message : !rows ? "Loading." : rows.length ? null : empty;
  const exitsEmpty = listState(h?.Exit, "No exits yet. Each exit the vault funds appears here with the penalty it saved the borrower.");
  const positionsEmpty = listState(h?.Position, "No covered positions yet. Borrowers appear here when they opt in.");
  const flowsEmpty = listState(h?.VaultFlow, "No activity yet. Deposits, premiums and exits appear here.");

  return (
    <div className="grid gap-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
            <TokenIcon symbol="USDC" size={18} />
            Shield vault, USDC
          </p>
          <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.02em]">Earn by funding exits</h1>
          <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
            The vault repays covered borrowers&rsquo; debt at their trigger and takes collateral worth 1% more. It also earns every premium, block by block.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:flex lg:gap-x-10" aria-busy={!vault}>
          <Stat
            label={
              <>
                Vault value
                <Info>
                  USDC the vault holds, plus collateral it took at exits valued at Aave&rsquo;s oracle, plus premium accrued at the Repricer and not yet
                  swept in. Nothing else counts.
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
                  What every active cover pays per block right now, times a year of 300 ms blocks, over the vault&rsquo;s value. Variable: it moves with
                  health factors, volatility and how many borrowers are covered. The exit discount comes on top.
                </Info>
              </>
            }
            value={!vault ? <Skeleton className="h-7 w-24" /> : premiumRate === undefined ? "No covers" : `${formatPct(premiumRate)} a year`}
          />
          <Stat label="Share price" value={vault ? vault.sharePrice.toFixed(4) : <Skeleton className="h-7 w-20" />} hint="USDC per shUSDC" />
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-1">
          <Panel title="Vault overview" labelledBy="overview-heading">
            {error ? (
              <p className="text-sm text-danger" role="alert">
                Could not read the vault from Monad: {error.message.split("\n")[0]}. Check your connection and reload.
              </p>
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
                  <Stat label="Premium earned" value={formatUsd(vault.premiumEarned)} hint="Counts every block" />
                  <Stat label="Exits executed" value={vault.exitsExecuted.toLocaleString("en-US")} hint="Funded by this vault" />
                  <Stat label="Average discount captured" value={vault.exitsExecuted ? formatBps(vault.averageDiscountBps) : "None yet"} hint="On vault-funded exits" />
                </dl>
              </>
            )}
          </Panel>
        </div>

        <aside className="min-w-0 self-start lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="Deposit or withdraw">
          <DepositWithdraw />
        </aside>

        <div className="min-w-0 lg:col-start-1">
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
                {exitsEmpty ? (
                  <Empty>{exitsEmpty}</Empty>
                ) : (
                  <div className="relative overflow-x-auto">
                    <table className="w-full min-w-[38rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b text-[0.75rem] text-muted-foreground">
                          <th scope="col" className={th}>Borrower</th>
                          <th scope="col" className={`${th} text-right`}>Repaid</th>
                          <th scope="col" className={`${th} text-right`}>Penalty avoided</th>
                          <th scope="col" className={`${th} text-right`}>Health factor</th>
                          <th scope="col" className={th}>Transaction</th>
                        </tr>
                      </thead>
                      <tbody className="num">
                        {h?.Exit.map((e) => (
                          <tr key={e.txHash} className="border-b last:border-b-0">
                            <td className={td}><HashLink value={e.borrower} kind="address" /></td>
                            <td className={`${td} text-right`}>{formatUsd(toNumber(BigInt(e.repaid), 6))}</td>
                            <td className={`${td} text-right font-semibold text-safe`}>{formatUsd(toNumber(BigInt(e.savedVsAave), 6))}</td>
                            <td className={`${td} text-right`}>
                              {formatHf(toNumber(BigInt(e.healthFactorBefore), 18))} to {formatHf(toNumber(BigInt(e.healthFactorAfter), 18))}
                            </td>
                            <td className={td}><HashLink value={e.txHash} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="positions" className="mt-4">
                {positionsEmpty ? (
                  <Empty>{positionsEmpty}</Empty>
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
                                {p.status}
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
              </TabsContent>
              <TabsContent value="flows" className="mt-4">
                {flowsEmpty ? (
                  <Empty>{flowsEmpty}</Empty>
                ) : (
                  <div className="relative overflow-x-auto">
                    <table className="w-full min-w-[32rem] text-left text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                      <thead>
                        <tr className="border-b text-[0.75rem] text-muted-foreground">
                          <th scope="col" className={th}>What</th>
                          <th scope="col" className={`${th} text-right`}>USDC</th>
                          <th scope="col" className={th}>When</th>
                          <th scope="col" className={th}>Transaction</th>
                        </tr>
                      </thead>
                      <tbody className="num">
                        {h?.VaultFlow.map((f) => (
                          <tr key={f.txHash + f.kind + f.blockNumber} className="border-b last:border-b-0">
                            <td className={td}>{FLOW_LABEL[f.kind]}</td>
                            <td className={`${td} text-right`}>{formatUsd(toNumber(BigInt(f.assets), 6))}</td>
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
