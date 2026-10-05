import { describe, expect, it } from "vitest";
import {
  EXIT_STATUS,
  byRisk,
  chunk,
  hermesMightUnblock,
  isRepriceable,
  isStuck,
  plan,
  shouldReprice,
  type Observation,
} from "../src/decide.js";

const A = "0x000000000000000000000000000000000000000A";
const B = "0x000000000000000000000000000000000000000b";
const WAD = 10n ** 18n;

function obs(borrower: `0x${string}`, status: Observation["status"], extra: Partial<Observation> = {}): Observation {
  return {
    borrower,
    status,
    healthFactor: WAD,
    repayAmount: 0n,
    trigger: 10_400,
    flags: 1,
    collateralId: 0,
    prepaid: WAD,
    ...extra,
  };
}

describe("decisions", () => {
  it("reprices every block by default", () => {
    const cfg = { repriceEveryNBlocks: 1, repriceWindowBlocks: 0, repriceIdleEveryNBlocks: 200 };
    expect(shouldReprice(100n, 100n, undefined, cfg)).toBe(true);
    expect(shouldReprice(101n, 100n, 100n, cfg)).toBe(true);
  });

  it("drops to the idle cadence after the window, counted from the last reprice", () => {
    const cfg = { repriceEveryNBlocks: 1, repriceWindowBlocks: 10, repriceIdleEveryNBlocks: 50 };
    expect(shouldReprice(105n, 100n, 104n, cfg)).toBe(true);
    expect(shouldReprice(151n, 100n, 109n, cfg)).toBe(false);
    expect(shouldReprice(159n, 100n, 109n, cfg)).toBe(true);
  });

  it("idle repricing still fires when passes only land on odd blocks (audit low: block % N)", () => {
    const cfg = { repriceEveryNBlocks: 1, repriceWindowBlocks: 600, repriceIdleEveryNBlocks: 200 };
    const start = 110_000_001n;
    let last: bigint | undefined = start + 599n;
    let fired = 0;
    for (let b = start + 601n; b < start + 100_000n; b += 2n) {
      if (shouldReprice(b, start, last, cfg)) {
        fired += 1;
        last = b;
      }
    }
    expect(fired).toBeGreaterThan(400); // about one per 200 blocks over 99,400 blocks
  });

  it("never reprices when the cadence is 0", () => {
    const off = { repriceEveryNBlocks: 0, repriceWindowBlocks: 0, repriceIdleEveryNBlocks: 0 };
    expect(shouldReprice(100n, 0n, undefined, off)).toBe(false);
  });

  it("exits only borrowers the Executor reports Ready", () => {
    const p = plan([obs(A, "Ready"), obs(B, "AboveTrigger")], true);
    expect(p.exits).toEqual([A]);
    expect(p.reprice).toBe(true);
  });

  it("does not exit above the trigger, during the waiting period, lapsed, unapproved or on a stale price", () => {
    const statuses: Observation["status"][] = [
      "AboveTrigger",
      "CoverWarmingUp",
      "CoverLapsed",
      "AllowanceTooLow",
      "PythStale",
      "NotActive",
      "PreviewFailed",
    ];
    for (const s of statuses) expect(plan([obs(A, s)], false).exits).toEqual([]);
  });

  it("knows the twelfth Executor status, CoverWarmingUp (index 11)", () => {
    expect(EXIT_STATUS[11]).toBe("CoverWarmingUp");
    expect(EXIT_STATUS).toHaveLength(12);
  });

  it("skips repricing when nothing is active", () => {
    expect(plan([obs(A, "NotActive")], true).reprice).toBe(false);
  });

  it("reprices only active, unlapsed records with prepaid left and a clean read (audit H4, M4)", () => {
    expect(isRepriceable(obs(A, "AboveTrigger"))).toBe(true);
    expect(isRepriceable(obs(A, "CoverWarmingUp"))).toBe(true);
    expect(isRepriceable(obs(A, "AboveTrigger", { prepaid: 0n }))).toBe(false);
    expect(isRepriceable(obs(A, "AboveTrigger", { flags: 3 }))).toBe(false); // ACTIVE | LAPSED
    expect(isRepriceable(obs(A, "CoverLapsed", { flags: 3, prepaid: 0n }))).toBe(false);
    expect(isRepriceable(obs(A, "PreviewFailed"))).toBe(false);
    expect(isRepriceable(obs(A, "AboveTrigger", { flags: undefined, prepaid: undefined }))).toBe(false);
    expect(plan([obs(A, "CoverLapsed", { flags: 3, prepaid: 0n })], true).reprice).toBe(false);
  });

  it("orders borrowers nearest their trigger first", () => {
    const near = obs(A, "AboveTrigger", { healthFactor: 1_041_000_000_000_000_000n });
    const far = obs(B, "AboveTrigger", { healthFactor: 2n * WAD });
    expect([far, near].sort(byRisk).map((o) => o.borrower)).toEqual([A, B]);
  });

  it("flags a borrower at or under the trigger whose exit is not Ready", () => {
    const under = 1_030_000_000_000_000_000n;
    expect(isStuck(obs(A, "CoverWarmingUp", { healthFactor: under }))).toBe(true);
    expect(isStuck(obs(A, "PythStale", { healthFactor: under }))).toBe(true);
    expect(isStuck(obs(A, "Ready", { healthFactor: under }))).toBe(false);
    expect(isStuck(obs(A, "AboveTrigger", { healthFactor: 2n * WAD }))).toBe(false);
    expect(isStuck(obs(A, "CoverLapsed", { healthFactor: 0n }))).toBe(false); // previewExit reports no HF
    expect(hermesMightUnblock(obs(A, "OracleDeviation", { healthFactor: under }))).toBe(true);
    expect(hermesMightUnblock(obs(A, "CoverWarmingUp", { healthFactor: under }))).toBe(false);
  });

  it("splits a list into chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});
