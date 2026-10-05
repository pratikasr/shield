import { HashLink } from "@/components/data/hash-link";
import { TokenIcon } from "@/components/data/token";
import { REPO } from "@/components/shell/footer";
import { AAVE_MONAD_LIQUIDATION as L } from "@/lib/analytics";
import { formatUsd } from "@/lib/format";

const FACTS_URL = `${REPO}/blob/main/docs/TECH-DECISIONS.md#verified-facts`;
const n = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Aave Monad's one WETH/USDC liquidation, with what the same repayment would have cost through a Shield exit. Every
 * figure is a verified constant (lib/analytics.ts, AAVE_MONAD_LIQUIDATION).
 */
export function LiquidationExample() {
  const max = L.paidAboveDebtUsd;
  return (
    <div>
      <p className="text-[0.9375rem]">
        On {L.date}, in block <span className="num">{L.block.toLocaleString("en-US")}</span>, a liquidator repaid {n(L.repaidUsdc, 2)} USDC of a borrower&rsquo;s
        debt on Aave V3 Monad and took {L.wethTaken} WETH of their collateral.
      </p>
      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 border-y py-4 sm:grid-cols-3">
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Debt repaid</dt>
          <dd className="mt-1 flex items-center gap-2 font-semibold num">
            <TokenIcon symbol="USDC" size={18} />
            {n(L.repaidUsdc, 2)} USDC
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Collateral taken</dt>
          <dd className="mt-1 flex items-center gap-2 font-semibold num">
            <TokenIcon symbol="WETH" size={18} />
            {L.wethTaken} WETH
          </dd>
          <dd className="mt-0.5 text-[0.8125rem] text-muted-foreground num">
            {L.wethToLiquidator} to the liquidator, {L.wethToAaveTreasury} to Aave&rsquo;s treasury
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Worth</dt>
          <dd className="mt-1 font-semibold num">{formatUsd(L.takenUsd)}</dd>
          <dd className="mt-0.5 text-[0.8125rem] text-muted-foreground num">At {formatUsd(L.pythEthUsd)} an ETH</dd>
        </div>
      </dl>

      <div className="mt-5 grid gap-3 text-[0.8125rem]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 sm:grid-cols-[13rem_minmax(0,1fr)_4.5rem] sm:items-center">
          <span className="text-muted-foreground">The borrower paid above the debt</span>
          <span className="font-semibold text-danger num sm:order-last sm:text-right">{formatUsd(L.paidAboveDebtUsd)}</span>
          <span className="col-span-2 h-2.5 rounded-full bg-danger/80 sm:col-span-1" style={{ width: "100%" }} aria-hidden />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 sm:grid-cols-[13rem_minmax(0,1fr)_4.5rem] sm:items-center">
          <span className="text-muted-foreground">A Shield exit at {L.shieldDiscountPct}% would cost</span>
          <span className="font-semibold num sm:order-last sm:text-right">{formatUsd(L.shieldExitUsd)}</span>
          <span className="col-span-2 h-2.5 rounded-full bg-safe sm:col-span-1" style={{ width: `${(L.shieldExitUsd / max) * 100}%` }} aria-hidden />
        </div>
      </div>
      <p className="mt-4 text-sm">
        On the same repayment the borrower would have kept <span className="font-semibold text-safe num">{formatUsd(L.differenceUsd)}</span> more collateral, before
        the premium for cover.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground">
        <span>Transaction</span>
        <HashLink value={L.tx} />
      </div>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
        Source: the Pool&rsquo;s only LiquidationCall log from block 0 to 110,740,416 and its receipt, valued at Pyth&rsquo;s last on-chain ETH/USD update before it
        (block <span className="num">{L.pythBlock.toLocaleString("en-US")}</span>), which sits within 0.2% of the price Aave&rsquo;s {L.bonusPct}% bonus implies.
        Checked 5 Oct 2026;{" "}
        <a href={FACTS_URL} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:text-foreground">
          verified facts
        </a>
        .
      </p>
    </div>
  );
}
