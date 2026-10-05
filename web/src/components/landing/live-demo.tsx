"use client";

import { useEffect, useRef, useState } from "react";
import { RiskRail } from "@/components/risk/risk-rail";
import { Sparkline } from "@/components/data/sparkline";
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
const TRIGGER = 1.05;
const K = 0.00125;
const SIGMA = 0.8;
const BLOCKS_PER_YEAR = 31_536_000 / 0.3;

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

/**
 * The landing page's live instrument: block numbers and the Pyth ETH/USD price read from Monad mainnet in the
 * browser, applied to an example loan so the health factor and the cover's price move as the chain does.
 */
export function LiveDemo() {
  const [r, setR] = useState<Reading>();
  const [failed, setFailed] = useState(false);
  const trail = useRef<number[]>([]);
  const premiums = useRef<number[]>([]);

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
      if (!stop && document.visibilityState === "visible") timer = setTimeout(tick, 600);
      else if (!stop) timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  const hf = r ? (COLLATERAL * r.price * LT) / DEBT : Number.NaN;
  const d = Math.max(hf - TRIGGER, 0.01);
  const annual = Number.isFinite(hf) && hf > TRIGGER ? (K * SIGMA * DEBT) / d : 0;
  const perBlock = annual / BLOCKS_PER_YEAR;

  if (r && trail.current.at(-1) !== hf) {
    trail.current = [...trail.current, hf].slice(-24);
    premiums.current = [...premiums.current, perBlock].slice(-40);
  }

  return (
    <section aria-label="Live example on Monad mainnet" className="rounded-xl border bg-card p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-[0.8125rem] text-muted-foreground">
          An example loan, 1 WETH against {DEBT.toLocaleString("en-US")} USDC, valued at the live Pyth ETH price on Monad
        </p>
        <p className="text-[0.8125rem] text-muted-foreground num" aria-live="off">
          {r ? <>Block {r.block.toLocaleString("en-US")}</> : failed ? "Monad RPC unreachable, retrying" : "Connecting to Monad"}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <div>
          <p className="text-[0.8125rem] text-muted-foreground">Health factor</p>
          <p className="reading mt-0.5 text-[2.25rem] font-semibold leading-none">{r ? hf.toFixed(3) : "1.0__"}</p>
        </div>
        <div>
          <p className="text-[0.8125rem] text-muted-foreground">ETH, Pyth on Monad</p>
          <p className="reading mt-1 text-xl font-semibold">{r ? formatUsd(r.price) : "$0,000.00"}</p>
        </div>
        <div>
          <p className="text-[0.8125rem] text-muted-foreground">Cover, per block</p>
          <p className="reading mt-1 flex items-center gap-2 text-xl font-semibold">
            {r ? formatUsd(perBlock) : "$0.00"}
            <Sparkline values={premiums.current} className="hidden w-16 sm:block" />
          </p>
        </div>
        <div>
          <p className="text-[0.8125rem] text-muted-foreground">Cover, per year</p>
          <p className="reading mt-1 text-xl font-semibold">{r ? formatUsd(annual) : "$0.00"}</p>
        </div>
      </div>

      <RiskRail className="mt-9" healthFactor={Number.isFinite(hf) ? hf : 1.1} trigger={TRIGGER} exitTarget={TRIGGER + 0.06} trail={trail.current} />

      <p className="mt-6 max-w-[68ch] text-[0.8125rem] text-muted-foreground">
        If this health factor reaches {TRIGGER.toFixed(2)}, Shield repays enough debt to bring it back to {(TRIGGER + 0.06).toFixed(2)} and
        takes collateral worth 1.01 times what it repaid. Left alone until 1.00, an Aave liquidator would take a 5.5% bonus instead.
      </p>
    </section>
  );
}
