"use client";

import { useState } from "react";
import { maxUint256, parseAbi, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { busyText } from "@/components/borrow/fuel";
import { TxLine } from "@/components/borrow/protect-frame";
import { Card, CartoonButton, ChoiceCards } from "@/components/cartoon";
import { SwitchButton, useWrongNetwork } from "@/components/shell/network-guard";
import { latestTx } from "@/components/tx/tx-status";
import { useTx } from "@/hooks/useTx";
import { positionRegistryAbi } from "@/lib/abis";
import { appChain } from "@/lib/chains";
import { aave, shield } from "@/lib/env";
import { formatHf, formatUsd } from "@/lib/format";
import { borrowForTarget, TEST_LOAN_ID, testLoanEnabled } from "@/lib/test-loan";

/**
 * Testnet staging only (ADR-040). Aave's own app does not list the Aave V3 market Shield deployed on Monad testnet, so
 * this card opens and moves a test loan from the connected wallet: deposit its test WETH into Aave, then borrow test
 * USDC down to a chosen health factor. Borrowing below the cover's line is the demo's way to make Shield step in.
 * Shown only when lib/test-loan.ts says so.
 */

const poolAbi = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);
const oracleAbi = parseAbi(["function getAssetPrice(address asset) view returns (uint256)"]);
const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const FLAG_ACTIVE = 1;

const TARGETS = [
  { value: "12000", name: "1.20" },
  { value: "11000", name: "1.10" },
  { value: "10500", name: "1.05" },
] as const;

const tokens = (raw: bigint, decimals: number, digits: number) =>
  (Number(raw) / 10 ** decimals).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const base = (raw: bigint) => formatUsd(Number(raw) / 1e8);

export function TestLoanCard({ hidden = false }: { hidden?: boolean }) {
  const { address, isConnected } = useAccount();
  const wrongNetwork = useWrongNetwork();
  const supplyTx = useTx();
  const borrowTx = useTx();
  const [target, setTarget] = useState<string>("11000");
  // From a successful send until the fresh reads land, so a second click never reuses the old amount.
  const [settling, setSettling] = useState(false);
  const user = address as Address | undefined;
  const reads = useReadContracts({
    contracts: user
      ? [
          { chainId: appChain.id, address: aave.weth, abi: tokenAbi, functionName: "balanceOf", args: [user] },
          { chainId: appChain.id, address: aave.weth, abi: tokenAbi, functionName: "allowance", args: [user, aave.pool] },
          { chainId: appChain.id, address: aave.pool, abi: poolAbi, functionName: "getUserAccountData", args: [user] },
          { chainId: appChain.id, address: aave.oracle, abi: oracleAbi, functionName: "getAssetPrice", args: [aave.usdc] },
        ]
      : [],
    query: { enabled: Boolean(user) && testLoanEnabled && !hidden, refetchInterval: 3_000 },
  });
  const rec = useReadContract({
    chainId: appChain.id,
    address: shield.registry,
    abi: positionRegistryAbi,
    functionName: "record",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user && shield.registry) && testLoanEnabled && !hidden, refetchInterval: 3_000 },
  });
  if (!testLoanEnabled || hidden || !isConnected || !user) return null;

  const [bal, allowance, account, price] = reads.data ?? [];
  const failed = reads.isError || [bal, account, price].some((r) => r?.status === "failure");
  const loaded = !failed && bal?.status === "success" && account?.status === "success" && price?.status === "success";
  const wethRaw = bal?.status === "success" ? (bal.result as bigint) : 0n;
  const allowed = allowance?.status === "success" ? (allowance.result as bigint) : 0n;
  const [collateralBase = 0n, debtBase = 0n, , ltBps = 0n, , hfWad = 0n] = account?.status === "success" ? (account.result as readonly bigint[]) : [];
  const usdcPrice = price?.status === "success" ? (price.result as bigint) : 0n;
  const record = rec.data;
  const line = record && (record.flags & FLAG_ACTIVE) !== 0 ? record.trigger / 1e4 : undefined;
  const hasCollateral = collateralBase > 0n;
  const borrowUnits = borrowForTarget(collateralBase, debtBase, ltBps, usdcPrice, BigInt(target));
  const targetName = TARGETS.find((t) => t.value === target)?.name ?? "";
  const busy = supplyTx.busy || borrowTx.busy || settling;
  const settle = async () => {
    setSettling(true);
    try {
      await reads.refetch();
    } finally {
      setSettling(false);
    }
  };

  const deposit = async () => {
    if (wethRaw === 0n) return;
    if (allowed < wethRaw) {
      const ok = await supplyTx.send("WETH approval", { address: aave.weth, abi: tokenAbi, functionName: "approve", args: [aave.pool, maxUint256] });
      if (!ok) return;
    }
    if (await supplyTx.send("Deposit", { address: aave.pool, abi: poolAbi, functionName: "supply", args: [aave.weth, wethRaw, user, 0] })) await settle();
  };
  const borrow = async () => {
    if (await borrowTx.send("Borrow", { address: aave.pool, abi: poolAbi, functionName: "borrow", args: [aave.usdc, borrowUnits, 2n, 0, user] })) await settle();
  };
  const last = latestTx(supplyTx.state, borrowTx.state);

  return (
    <Card as="section" id={TEST_LOAN_ID} className="mt-8 grid scroll-mt-24 gap-4" aria-labelledby="test-loan-title">
      <div>
        <h2 id="test-loan-title" className="m-0 font-display text-[22px] leading-tight">
          Test loan
        </h2>
        <p className="c-small c-muted m-0 mt-1">
          Testnet only. Aave&rsquo;s own app doesn&rsquo;t list this test market, so open and move your test loan here. Test WETH and USDC are worth nothing.
        </p>
      </div>

      {failed ? (
        <div className="grid gap-2">
          <p className="m-0 text-[15px]">Can&rsquo;t read your wallet or the test market right now.</p>
          <CartoonButton variant="white" onClick={() => void reads.refetch()}>
            Try again
          </CartoonButton>
        </div>
      ) : !loaded ? (
        <p className="m-0 text-[15px]">Reading your wallet and the test market.</p>
      ) : (
        <>
          <div className="grid gap-2">
            <p className="m-0 text-[15px]">
              {wethRaw > 0n ? (
                <>
                  Your wallet holds <b className="num">{tokens(wethRaw, 18, 4)} test WETH</b>.
                </>
              ) : hasCollateral ? (
                "No test WETH left in this wallet."
              ) : (
                <>
                  No test WETH in this wallet yet. The Shield team mints it: send them this address, <span className="num break-all">{user}</span>.
                </>
              )}
              {hasCollateral && (
                <>
                  {" "}
                  In Aave: <b className="num">{base(collateralBase)}</b> deposited, <b className="num">{base(debtBase)}</b> borrowed
                  {debtBase > 0n && (
                    <>
                      , health factor <b className="num">{formatHf(Number(hfWad) / 1e18)}</b>
                    </>
                  )}
                  .
                </>
              )}
            </p>
            {wethRaw > 0n &&
              (wrongNetwork ? (
                <SwitchButton action="use the test loan" size="big" className="w-full whitespace-normal" />
              ) : (
                <CartoonButton
                  variant="white"
                  size="big"
                  className="whitespace-normal"
                  disabled={busy && !supplyTx.busy}
                  loading={supplyTx.busy}
                  loadingText={busyText(supplyTx.state.phase)}
                  onClick={() => void deposit()}
                >
                  {`Deposit ${tokens(wethRaw, 18, 4)} test WETH into Aave`}
                </CartoonButton>
              ))}
          </div>

          {hasCollateral && (
            <div className="grid gap-3">
              <p id="test-loan-target" className="m-0 text-[15px] font-semibold">
                Borrow test USDC until the health factor is
              </p>
              <ChoiceCards variant="pills" labelledBy="test-loan-target" value={target} onChange={(v) => setTarget(v)} options={TARGETS.map((t) => ({ value: t.value, name: t.name }))} />
              {wrongNetwork ? (
                <SwitchButton action="borrow" size="big" className="w-full whitespace-normal" />
              ) : (
                <CartoonButton
                  size="big"
                  className="whitespace-normal"
                  disabled={borrowUnits === 0n || (busy && !borrowTx.busy)}
                  loading={borrowTx.busy}
                  loadingText={busyText(borrowTx.state.phase)}
                  onClick={() => void borrow()}
                >
                  {borrowUnits > 0n ? `Borrow ${tokens(borrowUnits, 6, 2)} test USDC (health factor ${targetName})` : `Already at or below ${targetName}`}
                </CartoonButton>
              )}
              <p className="c-small c-muted m-0">
                {line !== undefined
                  ? `Your Shield line is a health factor of ${line.toFixed(2)}. Once Shield has armed, borrowing below it makes Shield step in within a few blocks.`
                  : "Turn Shield on above first. Once it has armed, borrowing below your line makes it step in within a few blocks."}
              </p>
            </div>
          )}
        </>
      )}
      <TxLine state={last} done={last.label} />
    </Card>
  );
}
