import { describe, expect, it } from "vitest";
import { plan, shouldReprice, type Observation } from "../src/decide.js";

const A = "0x000000000000000000000000000000000000000A";
const B = "0x000000000000000000000000000000000000000b";

function obs(borrower: `0x${string}`, status: Observation["status"]): Observation {
  return { borrower, status, healthFactor: 10n ** 18n, repayAmount: 0n, trigger: 10_400 };
}

describe("decisions", () => {
  it("reprices every block by default", () => {
    const cfg = { repriceEveryNBlocks: 1, repriceWindowBlocks: 0, repriceIdleEveryNBlocks: 200 };
    expect(shouldReprice(100n, 100n, cfg)).toBe(true);
    expect(shouldReprice(101n, 100n, cfg)).toBe(true);
  });

  it("drops to the idle cadence after the window", () => {
    const cfg = { repriceEveryNBlocks: 1, repriceWindowBlocks: 10, repriceIdleEveryNBlocks: 50 };
    expect(shouldReprice(105n, 100n, cfg)).toBe(true);
    expect(shouldReprice(151n, 100n, cfg)).toBe(false);
    expect(shouldReprice(200n, 100n, cfg)).toBe(true);
  });

  it("never reprices when the cadence is 0", () => {
    expect(shouldReprice(100n, 0n, { repriceEveryNBlocks: 0, repriceWindowBlocks: 0, repriceIdleEveryNBlocks: 0 })).toBe(false);
  });

  it("exits only borrowers the Executor reports Ready", () => {
    const p = plan([obs(A, "Ready"), obs(B, "AboveTrigger")], true, new Set());
    expect(p.exits).toEqual([A]);
    expect(p.reprice).toBe(true);
  });

  it("does not exit a borrower whose exit is already in flight", () => {
    expect(plan([obs(A, "Ready")], false, new Set([A])).exits).toEqual([]);
  });

  it("does not exit above the trigger, lapsed cover, missing approval or a stale price", () => {
    const statuses: Observation["status"][] = ["AboveTrigger", "CoverLapsed", "AllowanceTooLow", "PythStale", "NotActive"];
    for (const s of statuses) expect(plan([obs(A, s)], false, new Set()).exits).toEqual([]);
  });

  it("skips repricing when nothing is active", () => {
    expect(plan([obs(A, "NotActive")], true, new Set()).reprice).toBe(false);
  });
});
