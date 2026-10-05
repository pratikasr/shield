"use client";

import { Clock3, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TokenPair } from "@/components/data/token";
import { RiskRail } from "@/components/risk/risk-rail";
import { LAUNCH_EXIT, aaveLiquidation, annualPremiumUsd, shieldExit } from "@/lib/economics";
import { formatHf, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const RPC = process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://rpc.monad.xyz";
const PYTH = "0x2880aB155794e7179c9eE2e38200202908C17B43";
const ETH_USD = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
/** getPriceUnsafe(bytes32) */
const GET_PRICE = `0x96834ad3${ETH_USD}`;

/** An example loan against 1 WETH, on Aave V3 Monad's WETH terms (liquidation threshold 84%, bonus 5.5%). */
const COLLATERAL = 1;
const LT = 0.84;
const BONUS = 1.055;
const TRIGGER = 1.05;
const K = 0.00125;
const SIGMA = 0.8;
/** The example starts here: comfortably above the trigger, close enough that a price move shows on the gauge. */
const START_HF = 1.22;

interface Reading {
  block: number;
  price: number;
}

async function read(): Promise<Reading> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_call", params: [{ to: PYTH, data: GET_PRICE }, "latest"] },
    ]),
  });
  const out = (await res.json()) as { id: number; result: string }[];
  const block = parseInt(out.find((r) => r.id === 1)!.result, 16);
  const word = out.find((r) => r.id === 2)!.result.slice(2, 66);
  return { block, price: Number(BigInt(`0x${word}`)) / 1e8 };
}

/** Live block and Pyth ETH price from Monad mainnet, read in the browser every 600 ms while visible. */
export function useMonadReading() {
  const [r, setR] = useState<Reading>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await read();
        if (stop) return;
        setFailed(false);
        setR((prev) => (prev && prev.block === next.block && prev.price === next.price ? prev : next));
      } catch {
        if (!stop) setFailed(true);
      }
      if (!stop) timer = setTimeout(tick, document.visibilityState === "visible" ? 600 : 3000);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);
  return { reading: r, failed };
}

/**
 * The hero's product shot: the app's position view for an example loan, valued at the live Pyth ETH price on
 * Monad mainnet, so the health factor and the cover's price move as the chain does. The debt is sized once, from the
 * first live price, so the example starts near a health factor of 1.22 and then moves only with the market.
 */
export function HeroShot() {
  const { reading: r, failed } = useMonadReading();
  const debtRef = useRef<number | undefined>(undefined);
  if (r && debtRef.current === undefined) debtRef.current = Math.round((COLLATERAL * r.price * LT) / START_HF / 10) * 10;
  const debt = debtRef.current;
  const trail = useRef<number[]>([]);
  const hf = r && debt ? (COLLATERAL * r.price * LT) / debt : Number.NaN;
  if (Number.isFinite(hf) && trail.current.at(-1) !== hf) trail.current = [...trail.current, hf].slice(-24);
  const live = Number.isFinite(hf) && debt !== undefined;
  const annual = live ? annualPremiumUsd({ debtUsd: debt!, healthFactor: hf, trigger: TRIGGER, k: K, sigma: SIGMA, dMin: LAUNCH_EXIT.dMin }) : 0;
  // At a liquidation the health factor is 1.00, so the collateral is worth debt / LT.
  const penalty = live ? aaveLiquidation({ totalDebtUsd: debt!, debtReserveUsd: debt!, collateralUsd: debt! / LT, bonus: BONUS }).penaltyUsd : 0;
  const exit = live ? shieldExit({ totalDebtUsd: debt!, usdcDebtUsd: debt!, trigger: TRIGGER, liquidationThreshold: LT, discountBps: LAUNCH_EXIT.discountBps, hfBuffer: LAUNCH_EXIT.hfBuffer }).costUsd : 0;
  const due = live && hf <= TRIGGER;

  return (
    <figure className="relative">
      <div className="panel overflow-hidden shadow-[var(--shadow-float)]" aria-label="Example position, live on Monad mainnet">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
          <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
            <TokenPair a="ETH" b="USDC" size={22} />
            <span className="truncate">
              WETH / USDC<span className="hidden text-muted-foreground sm:inline"> on Aave V3</span>
            </span>
          </span>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium",
              due ? "bg-caution-soft text-caution" : "bg-safe-soft text-safe",
            )}
          >
            {due ? <Clock3 className="size-3.5" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}
            {due ? "Exit due" : `Protected at ${TRIGGER.toFixed(2)}`}
          </span>
        </div>
        <div className="px-5 pb-5 pt-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[0.8125rem] text-muted-foreground">Health factor</p>
              <p className="reading mt-1 text-[2.5rem] font-semibold leading-none">{live ? formatHf(hf) : "1.2··"}</p>
            </div>
            <div className="text-right">
              <p className="text-[0.8125rem] text-muted-foreground">ETH, Pyth on Monad</p>
              <p className="reading mt-1 text-lg font-semibold">{r ? formatUsd(r.price) : "..."}</p>
            </div>
          </div>
          <RiskRail className="mt-5" compact healthFactor={live ? hf : START_HF} trigger={TRIGGER} exitTarget={TRIGGER + LAUNCH_EXIT.hfBuffer} trail={trail.current} hideLegend />
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t pt-4 text-[0.8125rem]">
            <div>
              <dt className="text-muted-foreground">Cover, a year</dt>
              <dd className="reading mt-0.5 font-semibold text-foreground">{live ? formatUsd(annual) : "..."}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">If liquidated</dt>
              <dd className="reading mt-0.5 font-semibold text-danger">{live ? formatUsd(penalty) : "..."}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Shield exit</dt>
              <dd className="reading mt-0.5 font-semibold text-safe">{live ? formatUsd(exit) : "..."}</dd>
            </div>
          </dl>
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[0.75rem] text-muted-foreground num">
        <span>Example: 1 WETH against {debt ? debt.toLocaleString("en-US") : "..."} USDC, at the live Pyth price</span>
        <span aria-live="off" className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${r && !failed ? "bg-safe" : "bg-muted-foreground"}`} aria-hidden />
          {r && !failed ? `Monad block ${r.block.toLocaleString("en-US")}` : failed ? "Monad RPC unreachable, retrying" : "Connecting to Monad"}
        </span>
      </figcaption>
    </figure>
  );
}
