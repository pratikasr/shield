"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount } from "wagmi";
import { FundingSource } from "@/components/aurora/funding-source";
import { useSentLock } from "@/components/borrow/cover-shared";
import { Card } from "@/components/cartoon/card";
import { CartoonIcon } from "@/components/cartoon/icons";
import { AmountHint, AmountInput } from "@/components/data/amount-input";
import { SwitchButton, useWrongNetwork } from "@/components/shell/network-guard";
import { TxStatus } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { useTx } from "@/hooks/useTx";
import type { VaultState } from "@/hooks/useVault";
import { erc20Abi, shieldVaultAbi } from "@/lib/abis";
import { amountText, checkAmount, unitsUsd } from "@/lib/amount";
import { aave, shield } from "@/lib/env";
import { formatDuration, formatUsd, truncateHex } from "@/lib/format";
import { cn } from "@/lib/utils";

type VaultUser = NonNullable<VaultState["user"]>;

/** Preset amounts for the treasury, in whole USDC. */
const PRESETS = [1_000, 5_000, 10_000];

const usdWhole = (v: number) => `$${v.toLocaleString("en-US")}`;

/** Amount chips as a radio group: picking one fills the field, typing clears the pick. */
function AmountChips({ value, options, onPick, label }: { value: string; options: { units: bigint; text: string }[]; onPick: (units: bigint) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = value !== "" && value === amountText(o.units);
        return (
          <Button key={o.text} type="button" size="small" variant={on ? "primary" : "white"} role="radio" aria-checked={on} onClick={() => onPick(o.units)}>
            {o.text}
          </Button>
        );
      })}
    </div>
  );
}

function AddForm({ u, vault, refetch }: { u: VaultUser; vault: VaultState; refetch: () => Promise<unknown> }) {
  const { address } = useAccount();
  const wrong = useWrongNetwork();
  const tx = useTx();
  const lock = useSentLock();
  const [amount, setAmount] = useState("");
  const check = checkAmount(amount, { balance: u.usdcBalance });
  const needsApproval = check.units > 0n && u.usdcAllowance < check.units;
  const approveKey = `approve:${check.units}`;
  const shares = vault.sharePrice > 0 && check.units > 0n ? Number(formatUnits(check.units, 6)) / vault.sharePrice : 0;
  const amt = check.units > 0n ? unitsUsd(check.units) : "";
  return (
    <div className="grid gap-3.5">
      <AmountChips label="Amount to add" value={amount} options={PRESETS.map((p) => ({ units: parseUnits(String(p), 6), text: usdWhole(p) }))} onPick={(v) => setAmount(amountText(v))} />
      <label htmlFor="vault-add" className="text-[15px] font-semibold">
        Or type an amount
      </label>
      <AmountInput
        id="vault-add"
        size="lg"
        value={amount}
        onChange={setAmount}
        onMax={() => setAmount(amountText(u.usdcBalance))}
        maxDisabled={u.usdcBalance === 0n}
        check={check}
        hintId="vault-add-help"
      />
      <AmountHint id="vault-add-help" check={check} className="text-[14.5px]">
        In this wallet: <span className="tnum">{unitsUsd(u.usdcBalance)}</span> USDC.
        {shares > 0 && <> You get <span className="tnum">{shares.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> vault shares.</>}
      </AmountHint>
      {wrong ? (
        <SwitchButton action="add to the vault" className="c-btn-big" />
      ) : needsApproval ? (
        <Button
          size="big"
          disabled={!check.ok || lock.isHeld(approveKey)}
          loading={tx.busy}
          loadingText="Check your wallet"
          onClick={async () => {
            const r = await tx.send("USDC approval", { address: aave.usdc, abi: erc20Abi, functionName: "approve", args: [shield.vault!, check.units] }, { context: "vault" });
            if (r) {
              lock.hold(approveKey);
              await refetch();
            }
          }}
        >
          Allow {amt} of USDC
        </Button>
      ) : (
        <Button
          size="big"
          disabled={!check.ok}
          loading={tx.busy}
          loadingText="Check your wallet"
          onClick={async () => {
            const r = await tx.send("Deposit", { address: shield.vault!, abi: shieldVaultAbi, functionName: "deposit", args: [check.units, address!] }, { context: "vault" });
            if (r) {
              await refetch();
              setAmount("");
            }
          }}
        >
          {amount.trim() === "" ? "Pick an amount" : `Add ${amt} to the vault`}
        </Button>
      )}
      <p className="m-0 text-[15px] text-ink-soft">
        {needsApproval ? "Two wallet prompts: allow USDC, then add it." : "One wallet prompt."} Shares are priced at what the vault holds now.
      </p>
      <TxStatus state={tx.state} />
    </div>
  );
}

function TakeOutForm({ u, vault, refetch, collateral }: { u: VaultUser; vault: VaultState; refetch: () => Promise<unknown>; collateral: string }) {
  const { address } = useAccount();
  const wrong = useWrongNetwork();
  const tx = useTx();
  const [amount, setAmount] = useState("");
  // "All of it" redeems the exact share count, so no dust of shares is left behind.
  const [allShares, setAllShares] = useState<bigint>();
  const check = checkAmount(amount, {
    available: u.maxWithdraw,
    availableMessage: (a) => `Only ${unitsUsd(a)} can come out right now. The rest is ${collateral} from rescues, which can come out once it's swapped back to USDC.`,
  });
  const options = [
    ...PRESETS.filter((p) => parseUnits(String(p), 6) < u.maxWithdraw).map((p) => ({ units: parseUnits(String(p), 6), text: usdWhole(p) })),
    ...(u.maxWithdraw > 0n ? [{ units: u.maxWithdraw, text: `All of it, ${unitsUsd(u.maxWithdraw)}` }] : []),
  ];
  const amt = check.units > 0n ? unitsUsd(check.units) : "";
  const pick = (v: bigint) => {
    setAmount(amountText(v));
    setAllShares(v === u.maxWithdraw ? u.maxRedeem : undefined);
  };
  if (u.maxWithdraw === 0n)
    return (
      <p className="m-0 text-ink-soft">
        Nothing can come out right now: the vault&rsquo;s USDC is all in use. The rest is {collateral} from rescues, which can come out once it&rsquo;s
        swapped back to USDC.
      </p>
    );
  return (
    <div className="grid gap-3.5">
      {options.length > 0 && <AmountChips label="Amount to take out" value={amount} options={options} onPick={pick} />}
      <label htmlFor="vault-take" className="text-[15px] font-semibold">
        Or type an amount
      </label>
      <AmountInput
        id="vault-take"
        size="lg"
        value={amount}
        onChange={(v) => {
          setAmount(v);
          setAllShares(undefined);
        }}
        onMax={() => pick(u.maxWithdraw)}
        check={check}
        hintId="vault-take-help"
      />
      <AmountHint id="vault-take-help" check={check} className="text-[14.5px]">
        Can come out now: <span className="tnum">{unitsUsd(u.maxWithdraw)}</span>.
        {vault.collateralHeld >= 0.01 && (
          <>
            {" "}
            The {collateral} from rescues (<span className="tnum">{formatUsd(vault.collateralHeld)}</span>) comes out once it&rsquo;s swapped back to USDC.
          </>
        )}
      </AmountHint>
      {wrong ? (
        <SwitchButton action="take money out" className="c-btn-big" />
      ) : (
        <Button
          size="big"
          variant="white"
          disabled={!check.ok}
          loading={tx.busy}
          loadingText="Check your wallet"
          onClick={async () => {
            const req =
              allShares !== undefined && allShares > 0n
                ? { address: shield.vault!, abi: shieldVaultAbi, functionName: "redeem", args: [allShares, address!, address!] }
                : { address: shield.vault!, abi: shieldVaultAbi, functionName: "withdraw", args: [check.units, address!, address!] };
            if (await tx.send("Withdrawal", req, { context: "vault" })) {
              await refetch();
              setAmount("");
              setAllShares(undefined);
            }
          }}
        >
          {amount.trim() === "" ? "Pick an amount" : `Take ${amt} out of the vault`}
        </Button>
      )}
      <p className="m-0 text-[15px] text-ink-soft">
        One wallet prompt. Gains from a recent rescue reach the vault&rsquo;s share price over {formatDuration(vault.profitUnlockSeconds)}.
      </p>
      <TxStatus state={tx.state} />
    </div>
  );
}

/** Deposits are closed to this wallet: why, in the design's words. */
function Closed({ children }: { children?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-4 max-sm:grid-cols-[52px_minmax(0,1fr)]">
      <div className="grid size-16 place-items-center rounded-2xl border-[2.5px] border-ink bg-sky-2 max-sm:size-[52px]" aria-hidden>
        <CartoonIcon name="lock" size={36} />
      </div>
      <div className="min-w-0">
        <h2 className="c-h3 mb-1.5">Deposits are closed</h2>
        <p className="m-0">
          Only Shield&rsquo;s treasury can add money for now. That way the protocol, not the public, carries the risk while Shield is new.
        </p>
        {children}
      </div>
    </div>
  );
}

/**
 * The vault's money panel. The treasury (on the vault's depositor list) adds money, from Monad or from another chain,
 * and takes it out. Anyone else holding shares can take theirs out. Everyone else sees why deposits are closed.
 */
export function VaultMoney({
  vault,
  refetch,
  treasury,
  collateral,
}: {
  vault?: VaultState;
  refetch: () => Promise<unknown>;
  treasury?: Address;
  collateral: string;
}) {
  const { address, isConnected } = useAccount();
  const wrong = useWrongNetwork();
  const [tab, setTab] = useState<"add" | "take">("add");
  const u = vault?.user;

  if (!isConnected)
    return (
      <Card>
        <Closed>
          <p className="m-0 mt-3 text-[15px] text-ink-soft">Outside deposits are planned for later. Already hold vault shares? Connect that wallet to take them out.</p>
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <Button className="mt-4" size="small" variant="white" onClick={openConnectModal}>
                Connect wallet
              </Button>
            )}
          </ConnectButton.Custom>
        </Closed>
      </Card>
    );

  if (!vault || !u)
    return (
      <Card aria-label="Reading your wallet">
        <div className="grid gap-3" aria-busy="true">
          <div className="h-7 w-48 animate-pulse rounded-lg bg-sky-2" />
          <div className="h-11 w-full animate-pulse rounded-xl bg-sky-2" />
          <div className="h-16 w-full animate-pulse rounded-xl bg-sky-2" />
        </div>
      </Card>
    );

  // Undefined means the vault has no allowlist to read (an older deployment): deposits are open, as before.
  const allowed = u.depositAllowed !== false;
  const holds = u.shares > 0n;

  if (!allowed)
    return (
      <Card>
        <Closed>
          {holds ? (
            <p className="m-0 mt-3 text-[15px] text-ink-soft">
              This wallet holds vault shares worth <span className="tnum font-semibold text-ink">{formatUsd(u.assets)}</span>. Anyone holding shares can
              take them out.
            </p>
          ) : (
            <p className="m-0 mt-3 text-[15px] text-ink-soft">Outside deposits are planned for later. This wallet holds no vault shares, so there is nothing to take out.</p>
          )}
        </Closed>
        {holds && (
          <div className="mt-5 border-t-2 border-dashed border-ink/20 pt-5">
            <h3 className="c-h3 mb-3 text-[23px]">Take your money out</h3>
            <TakeOutForm u={u} vault={vault} refetch={refetch} collateral={collateral} />
          </div>
        )}
      </Card>
    );

  const isTreasury = Boolean(treasury && address && treasury.toLowerCase() === address.toLowerCase());
  return (
    <Card>
      <h2 className="c-h3 mb-1.5">Treasury controls</h2>
      <p className="m-0 mb-3.5 text-[15px] text-ink-soft">
        {isTreasury ? "Connected as the treasury wallet, " : "This wallet is on the vault's depositor list, "}
        <span className="whitespace-nowrap tnum">{truncateHex(address ?? "")}</span>. It holds shares worth <span className="tnum">{formatUsd(u.assets)}</span>.
      </p>
      <div className="c-seg mb-4" role="radiogroup" aria-label="What to do">
        {(["add", "take"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            data-tab={t}
            aria-checked={tab === t}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                const next = t === "add" ? "take" : "add";
                setTab(next);
                (e.currentTarget.parentElement?.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
              }
            }}
            tabIndex={tab === t ? 0 : -1}
          >
            <span className="c-ring-dot" aria-hidden />
            {t === "add" ? "Add" : "Take out"}
          </button>
        ))}
      </div>
      <div className={cn(tab !== "add" && "hidden")}>
        {address && (
          <FundingSource kind="vault" owner={address} refundTo={address} wrongNetwork={wrong} onSwept={() => void refetch()}>
            <AddForm u={u} vault={vault} refetch={refetch} />
          </FundingSource>
        )}
      </div>
      {tab === "take" && <TakeOutForm u={u} vault={vault} refetch={refetch} collateral={collateral} />}
    </Card>
  );
}
