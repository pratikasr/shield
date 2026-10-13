import { describe, expect, it } from "vitest";
import {
  AAVE_MONAD_LIQUIDATION,
  DAY,
  HOUR,
  applyHead,
  applyPolledBlock,
  averageBlockMs,
  pushWindow,
  exitLanding,
  formatTvl,
  hourFrom,
  latestTxHashes,
  median,
  parseHead,
  periodTotals,
  protocolCut,
  ratePerYear,
  repriceCost,
  sumBuckets,
  totalsUsd,
  usdHeadline,
  type BucketRow,
  type StreamBlock,
  agoInWords,
  collateralWords,
  historyStatus,
  incomeProgression,
  rescueItems,
  shareInWords,
  sinceLaunch,
  statsScoreboard,
  vaultScoreboard,
  type AnalyticsExitRow,
  type AnalyticsPositionRow,
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

  it("converts to dollars with the right decimals; vault income is vault premiums plus exit discounts, total income adds the treasury's share", () => {
    const u = totalsUsd(sumBuckets([bucket("all", 0, forkHour)]));
    expect(u.premiumToProtocol).toBeCloseTo(7.61182598265e-7, 18);
    expect(u.exitDiscount).toBeCloseTo(0.263655, 9);
    expect(u.vaultIncome).toBeCloseTo(0.263655 + 6.850643384837e-6, 12);
    expect(u.totalIncome).toBeCloseTo(0.263655 + 6.850643384837e-6 + 7.61182598265e-7, 12);
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

describe("figures", () => {
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

  it("averages block time over a window, so two blocks delivered in one tick do not read as 0 ms", () => {
    const pts = [
      { n: 100, t: 0 },
      { n: 101, t: 610 },
      { n: 102, t: 610 },
      { n: 103, t: 900 },
      { n: 105, t: 1500 },
      { n: 106, t: 1830 },
    ];
    expect(averageBlockMs(pts)).toBe(305);
    expect(averageBlockMs(pts.slice(0, 3))).toBeUndefined();
    expect(averageBlockMs([{ n: 1, t: 5 }])).toBeUndefined();
    let w: number[] = [];
    for (let i = 0; i < 70; i++) w = pushWindow(w, i);
    expect(w).toHaveLength(64);
    expect(w[0]).toBe(6);
  });

  it("adds polled blocks on a fork without commit states, once each, newest first", () => {
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
  });
});

describe("page shaping", () => {
  const exit: AnalyticsExitRow = {
    borrower: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    collateral: "0xee8c0e9f1bffb4eb878d8f15f368a02a35481242",
    repaid: "26365511",
    seized: "0",
    savedVsAave: "1186447",
    healthFactorBefore: "1059000000000000000",
    healthFactorAfter: "1120000000000000000",
    flashLoanAmount: "0",
    blockNumber: "113044400",
    timestamp: String(NOW - 2 * HOUR - 5),
    txHash: "0xabc",
    trigger: 10600,
    discountBps: 100,
  };
  const position = (status: AnalyticsPositionRow["status"], optedInAt: number): AnalyticsPositionRow => ({
    borrower: "0x1",
    collateral: "0x2",
    status,
    trigger: 10600,
    healthFactor: "0",
    premiumPerBlock: "0",
    premiumPaid: "0",
    repriceCount: 0,
    optedInAt: String(optedInAt),
  });
  const data = {
    all: [bucket("all", 0, forkHour)],
    hours: [bucket("hour", THIS_HOUR, forkHour)],
    days: [bucket("day", TODAY, forkHour)],
    Exit: [exit],
    Position: [position("Unprotected", NOW - 30), position("Protected", NOW - 40 * 60)],
    launch: [{ timestamp: String(NOW - 6 * DAY - 100) }],
  };

  it("says times in plain words", () => {
    expect(agoInWords(NOW - 5, NOW)).toBe("just now");
    expect(agoInWords(NOW + 30, NOW)).toBe("just now");
    expect(agoInWords(NOW - 61, NOW)).toBe("1 minute ago");
    expect(agoInWords(NOW - 40 * 60, NOW)).toBe("40 minutes ago");
    expect(agoInWords(NOW - 2 * HOUR, NOW)).toBe("2 hours ago");
    expect(agoInWords(NOW - DAY, NOW)).toBe("1 day ago");
    expect(agoInWords(NOW - 90 * DAY, NOW)).toBe("3 months ago");
    expect(agoInWords(0, NOW)).toBeUndefined();
    expect(sinceLaunch(NOW - 6 * DAY, NOW)).toBe("Since launch, 6 days ago");
    expect(sinceLaunch(undefined, NOW)).toBe("Since launch");
  });

  it("puts shares and collateral into words", () => {
    expect(shareInWords(1000)).toBe("a tenth");
    expect(shareInWords(1500)).toBe("15%");
    expect(collateralWords(["ETH"])).toBe("ETH");
    expect(collateralWords(["ETH", "BTC", "ETH"])).toBe("ETH and BTC");
    expect(collateralWords([])).toBe("ETH");
  });

  it("tells an unconfigured, loading, down and answering indexer apart", () => {
    expect(historyStatus(false, false, false)).toBe("off");
    expect(historyStatus(true, false, false)).toBe("loading");
    expect(historyStatus(true, false, true)).toBe("down");
    expect(historyStatus(true, true, true)).toBe("ok");
  });

  it("fills the Stats scoreboard from the indexer and the chain", () => {
    const s = statsScoreboard({ history: "ok", data, exitsOnChain: 1, protectedNow: 1, outOfFuel: 1, now: NOW });
    expect(s.rescues).toMatchObject({ state: "value", text: "1", when: "The last one 2 hours ago" });
    expect(s.saved).toMatchObject({ state: "value", text: "$1.19", when: "Less than Aave's liquidators would have taken" });
    expect(s.protectedNow).toMatchObject({ state: "value", text: "1", when: "The newest one 40 minutes ago" });
    // Premium to the vault and the treasury, plus the exit discount: 6.85e-6 + 7.6e-7 + 0.263655.
    expect(s.income).toMatchObject({ state: "value", text: "$0.26", when: "Vault $0.26, treasury $0.00000076. Since launch, 6 days ago" });
  });

  it("never shows a zero as a fact when the indexer is down: on-chain figures stay, the rest is unknown", () => {
    const s = statsScoreboard({ history: "down", exitsOnChain: 2, protectedNow: 0, outOfFuel: 1, now: NOW });
    expect(s.rescues).toMatchObject({ state: "value", text: "2", when: "Counted live on Monad" });
    expect(s.saved.state).toBe("unknown");
    expect(s.income.state).toBe("unknown");
    expect(s.protectedNow).toMatchObject({ state: "value", text: "0", when: "1 more out of fuel" });
    expect(statsScoreboard({ history: "loading", now: NOW }).saved.state).toBe("loading");
    const behind = statsScoreboard({ history: "ok", data: { ...data, all: [bucket("all", 0)], Exit: [] }, exitsOnChain: 2, now: NOW });
    expect(behind.saved).toMatchObject({ text: "$0.00", when: "Less than Aave's liquidators would have taken. History is still counting the newest rescue" });
    expect(statsScoreboard({ history: "off", now: NOW }).rescues.state).toBe("unknown");
  });

  it("fills the vault's three numbers from the contract, with times from the indexer", () => {
    const v = { gross: 5011.87, idle: 4985.24, collateralHeld: 26.63, exitsExecuted: 1, premiumEarned: 0.0000069, exitGains: 0.263655 };
    const s = vaultScoreboard({ vault: v, lastExitSec: NOW - 2 * HOUR, launchSec: NOW - 6 * DAY, collateral: "ETH", now: NOW });
    expect(s.balance).toMatchObject({ text: "$5,011.87", when: "$4,985.24 in USDC and $26.63 in ETH from rescues" });
    expect(s.rescues).toMatchObject({ text: "1", when: "The last one 2 hours ago" });
    expect(s.earned).toMatchObject({ text: "$0.26", when: "Since launch, 6 days ago" });
    const fresh = vaultScoreboard({ vault: { ...v, collateralHeld: 0, exitsExecuted: 0, exitGains: 0 }, collateral: "ETH", now: NOW });
    expect(fresh.balance).toMatchObject({ when: "All of it in USDC right now" });
    expect(fresh.rescues).toMatchObject({ text: "0", when: "None yet" });
    expect(fresh.earned).toMatchObject({ text: "<$0.01", exact: "$0.0000069", when: "Since launch" });
    expect(vaultScoreboard({ unreachable: true, collateral: "ETH", now: NOW }).balance.state).toBe("unknown");
    expect(vaultScoreboard({ collateral: "ETH", now: NOW }).earned.state).toBe("loading");
  });

  it("gives income as a progression over four windows and exits as plain numbers", () => {
    const p = incomeProgression(data, NOW);
    expect(p.map((x) => x.label)).toEqual(["Last 24 hours", "Last 7 days", "Last 30 days", "Since launch"]);
    expect(p.every((x) => Math.abs(x.value - 0.2636626) < 1e-6)).toBe(true);
    const [r] = rescueItems([exit], NOW);
    expect(r).toMatchObject({ repaidUsd: 26.365511, savedUsd: 1.186447, when: "2 hours ago", block: 113044400 });
    expect(r!.tookUsd).toBeCloseTo(26.62916611, 6);
  });
});
