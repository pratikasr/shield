import { describe, expect, it } from "vitest";
import { compressToPages, coversPages, mergeAccessLists, pageOf, shieldAccessList, slotKey } from "../src/accessList.js";

const REG = "0x1111111111111111111111111111111111111111";
const REP = "0x2222222222222222222222222222222222222222";

describe("MIP-8 access lists", () => {
  it("maps a slot to its 128-slot page", () => {
    expect(pageOf(0n)).toBe(0n);
    expect(pageOf(127n)).toBe(0n);
    expect(pageOf(128n)).toBe(1n);
    expect(pageOf(slotKey(1000n))).toBe(7n);
  });

  it("keeps one key per page and drops the rest", () => {
    const base = 128n * 99n;
    const list = compressToPages([
      { address: REG, storageKeys: [slotKey(base), slotKey(base + 1n), slotKey(base + 2n), slotKey(base + 200n)] },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.storageKeys).toEqual([slotKey(base), slotKey(base + 200n)]);
  });

  it("merges node and Shield lists without duplicates", () => {
    const merged = mergeAccessLists(
      [{ address: REG, storageKeys: [slotKey(5n)] }],
      [{ address: REG.toLowerCase() as `0x${string}`, storageKeys: [slotKey(5n), slotKey(6n)] }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.storageKeys).toHaveLength(2);
  });

  it("builds the Shield pages from the contracts' slot views", () => {
    const record = 128n * 12345n;
    const vol = 128n * 777n;
    const list = shieldAccessList({ registry: REG, recordSlots: [record], repricer: REP, volSlots: [vol] });
    expect(coversPages(list, REG, [record, record + 1n, record + 2n])).toBe(true);
    expect(coversPages(list, REP, [vol, vol + 100n])).toBe(true);
  });

  it("detects an access list that names the wrong page", () => {
    const record = 128n * 12345n;
    const wrong = [{ address: REG, storageKeys: [slotKey(record + 128n)] }] as const;
    expect(coversPages([...wrong], REG, [record])).toBe(false);
  });
});
