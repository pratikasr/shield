import { describe, expect, it } from "vitest";
import { CHART_REPRICE_LIMIT, buildHfSeries, type BorrowerChart, type ChartExitRow, type ChartRepriceRow } from "./envio";

const wad = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;

function reprice(block: number, t: number, hf: number, chargedUsd: number): ChartRepriceRow {
  return { blockNumber: String(block), logIndex: 0, timestamp: String(t), healthFactor: wad(hf).toString(), charged: wad(chargedUsd).toString() };
}

function exit(block: number, t: number, before: number, after: number): ChartExitRow {
  return {
    blockNumber: String(block),
    timestamp: String(t),
    healthFactorBefore: wad(before).toString(),
    healthFactorAfter: wad(after).toString(),
    trigger: 10_500,
    savedVsAave: "1186447",
    txHash: `0x${block.toString(16).padStart(64, "0")}`,
  };
}

/** Three reprices (newest first, as the query returns them) after $4 paid on an earlier cover; $10 paid in all. */
const data: BorrowerChart = {
  Reprice: [reprice(103, 1003, 1.05, 3), reprice(102, 1002, 1.06, 2), reprice(101, 1001, 1.07, 1)],
  Exit: [exit(103, 1003, 1.05, 1.12), exit(50, 500, 1.04, 1.1)],
  Position: [{ premiumPaid: wad(10).toString(), repriceCount: 3, optedInAt: "900" }],
};

describe("health-factor chart series", () => {
  it("orders readings oldest first and counts the premium back from the indexer's total", () => {
    const { points, truncated } = buildHfSeries(data);
    expect(truncated).toBe(false);
    expect(points.map((p) => [p.kind, p.block])).toEqual([
      ["exitBefore", 50],
      ["exit", 50],
      ["reprice", 101],
      ["reprice", 102],
      ["reprice", 103],
      ["exit", 103],
    ]);
    const reprices = points.filter((p) => p.kind === "reprice");
    expect(reprices.map((p) => p.cum)).toEqual([5, 7, 10]);
    expect(reprices.map((p) => p.charged)).toEqual([1, 2, 3]);
  });

  it("uses the exit transaction's own reprice as the reading before an exit, and the exit's reading after it", () => {
    const { points } = buildHfSeries(data);
    const at103 = points.filter((p) => p.block === 103);
    expect(at103.map((p) => [p.kind, p.hf])).toEqual([
      ["reprice", 1.05],
      ["exit", 1.12],
    ]);
  });

  it("marks a gap of more than five minutes as dashed, and appends the live reading", () => {
    const { points } = buildHfSeries(data, { hf: 1.119, t: 1010 });
    expect(points.find((p) => p.block === 101)!.gapBefore).toBe(true);
    expect(points.find((p) => p.block === 102)!.gapBefore).toBe(false);
    const live = points.at(-1)!;
    expect(live.kind).toBe("live");
    expect(live.hf).toBe(1.119);
    expect(live.gapBefore).toBe(false);
  });

  it("skips readings with no debt and a live reading older than the last one", () => {
    const noDebt: BorrowerChart = { ...data, Reprice: [{ ...reprice(104, 1004, 1, 0), healthFactor: (2n ** 255n).toString() }, ...data.Reprice] };
    expect(buildHfSeries(noDebt).points.some((p) => p.block === 104)).toBe(false);
    expect(buildHfSeries(data, { hf: 1.2, t: 999 }).points.some((p) => p.kind === "live")).toBe(false);
  });

  it("drops exits older than the loaded window when the list was cut at the limit", () => {
    const many = Array.from({ length: CHART_REPRICE_LIMIT }, (_, i) => reprice(2000 - i, 20_000 - i, 1.1, 0.01));
    const cut: BorrowerChart = { Reprice: many, Exit: [exit(50, 500, 1.04, 1.1)], Position: [{ premiumPaid: wad(100).toString(), repriceCount: 900, optedInAt: "900" }] };
    const { points, truncated, droppedExits } = buildHfSeries(cut);
    expect(truncated).toBe(true);
    expect(droppedExits).toBe(1);
    expect(points.some((p) => p.kind === "exit")).toBe(false);
    expect(points.at(-1)!.cum).toBeCloseTo(100, 9);
  });
});
