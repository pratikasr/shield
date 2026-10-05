"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TokenPair } from "@/components/data/token";
import { RiskRail } from "@/components/risk/risk-rail";
import { aavePenaltyUsd, shieldExitUsd } from "@/lib/economics";
import { formatUsd } from "@/lib/format";

const RPC = process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://rpc.monad.xyz";
const PYTH = "0x2880aB155794e7179c9eE2e38200202908C17B43";
const ETH_USD = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
/** getPriceUnsafe(bytes32) */
const GET_PRICE = `0x96834ad3${ETH_USD}`;

/** An example loan: 1 WETH supplied against 2,150 USDC, Aave Monad's WETH liquidation threshold of 84%. */
const COLLATERAL = 1;
const DEBT = 2150;
const LT = 0.84;
const BONUS = 1.055;
const TRIGGER = 1.05;
const K = 0.00125;
const SIGMA = 0.8;

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
 * Monad mainnet, so the health factor and the cover's price move as the chain does.
 */
export function HeroShot() {
  const { reading: r, failed } = useMonadReading();
  const trail = useRef<number[]>([]);
  const hf = r ? (COLLATERAL * r.price * LT) / DEBT : Number.NaN;
  const d = Math.max(hf - TRIGGER, 0.01);
  const annual = Number.isFinite(hf) && hf > TRIGGER ? (K * SIGMA * DEBT) / d : 0;
  if (r && trail.current.at(-1) !== hf) trail.current = [...trail.current, hf].slice(-24);
  const penalty = aavePenaltyUsd(DEBT, COLLATERAL * (r?.price ?? 2700), BONUS);
  const exit = shieldExitUsd({ debtUsd: DEBT, trigger: TRIGGER, liquidationThreshold: LT });

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
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-safe-soft px-2.5 py-1 text-[0.75rem] font-medium text-safe">
            <ShieldCheck className="size-3.5" aria-hidden />
            Protected at {TRIGGER.toFixed(2)}
          </span>
        </div>
        <div className="px-5 pb-5 pt-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[0.8125rem] text-muted-foreground">Health factor</p>
              <p className="reading mt-1 text-[2.5rem] font-semibold leading-none">{r ? hf.toFixed(3) : "1.0··"}</p>
            </div>
            <div className="text-right">
              <p className="text-[0.8125rem] text-muted-foreground">ETH, Pyth on Monad</p>
              <p className="reading mt-1 text-lg font-semibold">{r ? formatUsd(r.price) : "..."}</p>
            </div>
          </div>
          <RiskRail className="mt-5" compact healthFactor={Number.isFinite(hf) ? hf : 1.1} trigger={TRIGGER} exitTarget={TRIGGER + 0.06} trail={trail.current} hideLegend />
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t pt-4 text-[0.8125rem]">
            <div>
              <dt className="text-muted-foreground">Cover, a year</dt>
              <dd className="reading mt-0.5 font-semibold text-foreground">{r ? formatUsd(annual) : "..."}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">If liquidated</dt>
              <dd className="reading mt-0.5 font-semibold text-danger">{formatUsd(penalty)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Shield exit</dt>
              <dd className="reading mt-0.5 font-semibold text-safe">{formatUsd(exit.costUsd)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[0.75rem] text-muted-foreground num">
        <span>Example: 1 WETH against {DEBT.toLocaleString("en-US")} USDC, at the live Pyth price</span>
        <span aria-live="off" className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${r && !failed ? "bg-safe" : "bg-muted-foreground"}`} aria-hidden />
          {r ? `Monad block ${r.block.toLocaleString("en-US")}` : failed ? "Monad RPC unreachable, retrying" : "Connecting to Monad"}
        </span>
      </figcaption>
    </figure>
  );
}
