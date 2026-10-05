import { describe, expect, it } from "vitest";
import {
  AAVE_MONAD_LIQUIDATION,
  DAY,
  HOUR,
  MIN_ALL_TIME_DAYS,
  applyHead,
  applyPolledBlock,
  axisUsd,
  blockGaps,
  earningsSeries,
  exitLanding,
  formatTvl,
  hourFrom,
  latestTxHashes,
  median,
  niceTicks,
  parseHead,
  periodTotals,
  protocolCut,
  ratePerYear,
  repriceCost,
  stateLatency,
  sumBuckets,
  totalsUsd,
  usdHeadline,
  type BucketRow,
  type StreamBlock,
} from "./analytics";

/** 5 Oct 2026 11:47:00 UTC, the fork's chain time when these fixtures were read. */
const NOW = 1_791_200_820;
const THIS_HOUR = 1_791_198_000;
const TODAY = 1_791_158_400;

function bucket(period: string, start: number, over: Partial<BucketRow> = {}): BucketRow {
  return {
    period,
    start: String(start),
    premiumCharged: "0",
    premiumToVault: "0",
    premiumToProtocol: "0",
    protocolPaid: "0",
    exitDiscount: "0",
    exits: 0,
    debtRepaid: "0",
    savedVsAave: "0",
    reprices: 0,
    optIns: 0,
    deposited: "0",
    withdrawn: "0",
    ...over,
  };
}

/** The fork rehearsal's real bucket: 73 reprices, one exit, one deposit (indexer, 5 Oct 2026). */
const forkHour = {
  premiumCharged: "7611825983102",
  premiumToVault: "6850643384837",
  premiumToProtocol: "761182598265",
  exitDiscount: "263655",
  exits: 1,
  debtRepaid: "26365511",
  savedVsAave: "1186447",
  reprices: 73,
  optIns: 1,
  deposited: "50000000",
};

describe("earnings totals", () => {
  it("sums bigint money fields and counts, and reads a bad field as zero", () => {
    const t = sumBuckets([bucket("hour", 0, forkHour), bucket("hour", HOUR, { premiumCharged: "1000", reprices: 2 }), bucket("hour", 2 * HOUR, { premiumCharged: "oops" })]);
    expect(t.premiumCharged).toBe(7_611_825_984_102n);
    expect(t.reprices).toBe(75);
    expect(t.exits).toBe(1);
  });

  it("converts to dollars with the right decimals; LP earnings are vault premiums plus exit discounts", () => {
    const u = totalsUsd(sumBuckets([bucket("all", 0, forkHour)]));
    expect(u.premiumToProtocol).toBeCloseTo(7.61182598265e-7, 18);
    expect(u.exitDiscount).toBeCloseTo(0.263655, 9);
    expect(u.lpEarnings).toBeCloseTo(0.263655 + 6.850643384837e-6, 12);
    expect(u.savedVsAave).toBeCloseTo(1.186447, 9);
    expect(u.debtRepaid).toBeCloseTo(26.365511, 9);
  });

  it("takes hour buckets for 24 hours and 7 days, day buckets for 30 days, and the all row for all time", () => {
    const data = {
      all: [bucket("all", 0, { reprices: 1000 })],
      hours: [bucket("hour", THIS_HOUR - 30 * HOUR, { reprices: 5 }), bucket("hour", THIS_HOUR - 23 * HOUR, { reprices: 3 }), bucket("hour", THIS_HOUR, { reprices: 2 })],
      days: [bucket("day", TODAY - 40 * DAY, { reprices: 100 }), bucket("day", TODAY - 29 * DAY, { reprices: 7 }), bucket("day", TODAY, { reprices: 11 })],
    };
    expect(periodTotals(data, "24h", NOW).reprices).toBe(5);
    expect(periodTotals(data, "7d", NOW).reprices).toBe(10);
    expect(periodTotals(data, "30d", NOW).reprices).toBe(18);
    expect(periodTotals(data, "all", NOW).reprices).toBe(1000);
    expect(periodTotals({ all: [], hours: [], days: [] }, "all", NOW).reprices).toBe(0);
  });

  it("asks for the hour buckets of the last 7 days, moving once an hour", () => {
    expect(hourFrom(NOW)).toBe(String(THIS_HOUR - 167 * HOUR));
    expect(hourFrom(NOW + 60)).toBe(hourFrom(NOW));
  });
});

describe("chart series", () => {
  const data = {
    hours: [bucket("hour", THIS_HOUR - 2 * HOUR, { premiumToVault: "2000000000000000000" }), bucket("hour", THIS_HOUR, forkHour)],
    days: [bucket("day", TODAY, forkHour)],
  };

  it("gives one bar per hour for 24 hours and 7 days, oldest first, with empty hours as zero", () => {
    const day = earningsSeries(data, "24h", NOW);
    expect(day.unit).toBe("hour");
    expect(day.bars).toHaveLength(24);
    expect(day.bars[23]!.start).toBe(THIS_HOUR);
    expect(day.bars[23]!.values[2]).toBeCloseTo(0.263655, 9);
    expect(day.bars[21]!.values[0]).toBe(2);
    expect(day.bars[22]!.values).toEqual([0, 0, 0]);
    expect(earningsSeries(data, "7d", NOW).bars).toHaveLength(168);
  });

  it("gives daily bars for 30 days, and at least a week of days for all time", () => {
    const month = earningsSeries(data, "30d", NOW);
    expect(month.unit).toBe("day");
    expect(month.bars).toHaveLength(30);
    expect(month.bars[29]!.start).toBe(TODAY);
    const all = earningsSeries(data, "all", NOW);
    expect(all.bars).toHaveLength(MIN_ALL_TIME_DAYS);
    expect(all.bars[MIN_ALL_TIME_DAYS - 1]!.values[1]).toBeCloseTo(7.61182598265e-7, 18);
    const longer = earningsSeries({ hours: [], days: [bucket("day", TODAY - 20 * DAY), bucket("day", TODAY)] }, "all", NOW);
    expect(longer.bars).toHaveLength(21);
    expect(longer.bars[0]!.start).toBe(TODAY - 20 * DAY);
  });
});

describe("axis and figures", () => {
  it("picks a 1, 2 or 5 step for any size, sub-cent included", () => {
    expect(niceTicks(0.263655)).toEqual({ ticks: [0, 0.1, 0.2, 0.3], top: 0.3, step: 0.1 });
    const tiny = niceTicks(6.9e-6);
    expect(tiny.step).toBeCloseTo(2e-6, 15);
    expect(tiny.top).toBeCloseTo(8e-6, 15);
    expect(niceTicks(1234).ticks).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(4).ticks).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(0)).toEqual({ ticks: [0, 1], top: 1, step: 1 });
  });

  it("labels axis ticks with the decimals the step needs", () => {
    expect(axisUsd(0, 0.1)).toBe("$0");
    expect(axisUsd(0.2, 0.1)).toBe("$0.20");
    expect(axisUsd(0.000004, 0.000002)).toBe("$0.000004");
    expect(axisUsd(0.05, 0.05)).toBe("$0.05");
    expect(axisUsd(1000, 500)).toBe("$1,000");
    expect(axisUsd(200_000, 100_000)).toBe("$200K");
  });

  it("never puts a sub-cent figure in a headline", () => {
    expect(usdHeadline(7.6e-7)).toEqual({ text: "<$0.01", exact: "$0.00000076" });
    expect(usdHeadline(0)).toEqual({ text: "$0.00" });
    expect(usdHeadline(12.5)).toEqual({ text: "$12.50" });
  });

  it("splits a charge exactly as the Repricer does and prices a cover by the year", () => {
    expect(protocolCut(304_473_045_090n, 1000)).toBe(30_447_304_509n);
    expect(protocolCut(9n, 1000)).toBe(0n);
    // 1e-9 USDC a block over a year of 300 ms blocks.
    expect(ratePerYear("1000000000")).toBeCloseTo(0.10512, 6);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeUndefined();
    expect(formatTvl(324.0e6)).toBe("$324.0M");
    expect(formatTvl(8.5e6)).toBe("$8.5M");
  });

  it("keeps the worked example's arithmetic consistent", () => {
    const l = AAVE_MONAD_LIQUIDATION;
    const x = l.exact;
    const round = (v: number, d: number) => Number(v.toFixed(d));
    expect(x.wethToLiquidator + x.wethToAaveTreasury).toBeCloseTo(x.wethTaken, 15);
    expect([round(x.repaidUsdc, 2), round(x.wethTaken, 4), round(x.wethToLiquidator, 4), round(x.wethToAaveTreasury, 4)]).toEqual([
      l.repaidUsdc,
      l.wethTaken,
      l.wethToLiquidator,
      l.wethToAaveTreasury,
    ]);
    const taken = x.wethTaken * l.pythEthUsd;
    const shield = x.repaidUsdc * (l.shieldDiscountPct / 100);
    expect(round(taken, 2)).toBe(l.takenUsd);
    expect(round(taken - x.repaidUsdc, 2)).toBe(l.paidAboveDebtUsd);
    expect(round(shield, 2)).toBe(l.shieldExitUsd);
    expect(round(taken - x.repaidUsdc - shield, 2)).toBe(l.differenceUsd);
  });
});

describe("exits and keeper cost", () => {
  it("measures how far below the trigger an exit started", () => {
    const e = exitLanding({ trigger: 10600, healthFactorBefore: "1052879834080492320" });
    expect(e.trigger).toBe(1.06);
    expect(e.hf).toBeCloseTo(1.05288, 5);
    expect(e.belowBy).toBeCloseTo(0.00712, 5);
  });

  it("averages gas and MON per reprice over receipts, counting a batch as several reprices", () => {
    const c = repriceCost([
      { gasUsed: 200_000n, effectiveGasPrice: 102_000_000_000n, reprices: 1 },
      { gasUsed: 400_000n, effectiveGasPrice: 102_000_000_000n, reprices: 3 },
      { gasUsed: 900_000n, effectiveGasPrice: 102_000_000_000n, reprices: 0 },
    ])!;
    expect(c.txs).toBe(2);
    expect(c.reprices).toBe(4);
    expect(c.gasPerReprice).toBe(150_000);
    expect(c.monPerReprice).toBeCloseTo(0.0153, 6);
    expect(c.gasPriceGwei).toBeCloseTo(102, 6);
    expect(repriceCost([])).toBeUndefined();
  });

  it("lists distinct transactions newest first", () => {
    expect(latestTxHashes([{ txHash: "0xA" }, { txHash: "0xa" }, { txHash: "0xb" }, { txHash: "0xc" }], 2)).toEqual(["0xa", "0xb"]);
  });
});

describe("live block stream", () => {
  const msg = (n: number, commitState: string, blockId = `0x${n}`) => parseHead({ number: `0x${n.toString(16)}`, blockId, commitState, timestamp: "0x6ac38e47" })!;

  it("reads a monadNewHeads result and rejects anything else", () => {
    // A real message from wss://rpc.monad.xyz, 5 Oct 2026, trimmed.
    const real = parseHead({
      number: "0x699d1f9",
      blockId: "0x9d92811daea2a7a289fad208795308eaf898dfda82209fdf78ad255ac774790f",
      commitState: "Finalized",
      timestamp: "0x6ac38e47",
      hash: "0xe8eb81465fa423662be42856a53ace8263d0ca369affcd624274dbe4e2241f89",
    });
    expect(real).toEqual({ number: 110744057, blockId: "0x9d92811daea2a7a289fad208795308eaf898dfda82209fdf78ad255ac774790f", commitState: "Finalized", timestamp: 1791200839 });
    expect(parseHead({ number: "0x1", commitState: "Pending" })).toBeNull();
    expect(parseHead(null)).toBeNull();
    expect(parseHead("0x1")).toBeNull();
  });

  it("moves a block forward through the commit states, never back, newest first", () => {
    let s: StreamBlock[] = [];
    s = applyHead(s, msg(100, "Proposed"), 1000);
    s = applyHead(s, msg(101, "Proposed"), 1300);
    s = applyHead(s, msg(100, "Voted"), 1310);
    s = applyHead(s, msg(100, "Finalized"), 1600);
    s = applyHead(s, msg(100, "Voted"), 1700);
    expect(s.map((b) => b.number)).toEqual([101, 100]);
    expect(s[1]!.state).toBe("Finalized");
    expect(s[1]!.at).toEqual({ Proposed: 1000, Voted: 1310, Finalized: 1600 });
    expect(blockGaps(s)).toEqual([300, undefined]);
    expect(stateLatency(s, "Finalized")).toEqual([600]);
  });

  it("replaces a block that was only proposed when another proposal at that height moves on", () => {
    let s = applyHead([], msg(100, "Proposed", "0xaa"), 1000);
    s = applyHead(s, msg(100, "Proposed", "0xbb"), 1010);
    expect(s[0]!.blockId).toBe("0xaa");
    s = applyHead(s, msg(100, "Voted", "0xbb"), 1300);
    expect(s[0]).toMatchObject({ blockId: "0xbb", state: "Voted", seenAt: 1000 });
  });

  it("keeps the newest blocks only, and ignores late messages for blocks already dropped", () => {
    let s: StreamBlock[] = [];
    for (let n = 1; n <= 12; n++) s = applyHead(s, msg(n, "Proposed"), n * 300);
    expect(s).toHaveLength(10);
    expect(s[9]!.number).toBe(3);
    const same = applyHead(s, msg(1, "Verified"), 9999);
    expect(same).toBe(s);
  });

  it("adds polled blocks on a fork without commit states, and measures gaps only between neighbours", () => {
    let s: StreamBlock[] = [];
    s = applyPolledBlock(s, 50, 0);
    s = applyPolledBlock(s, 51, 310);
    s = applyPolledBlock(s, 51, 400);
    s = applyPolledBlock(s, 53, 900);
    expect(s.map((b) => [b.number, b.state])).toEqual([
      [53, null],
      [51, null],
      [50, null],
    ]);
    expect(blockGaps(s)).toEqual([undefined, 310, undefined]);
  });
});
