import { describe, expect, it } from "vitest";
import { BLOCKS_PER_DAY } from "@/lib/economics";
import { defaultPreset, dropTo, validPresets, fuelOptions, fuelSegments, lastsFor, priceAtHf, safetyOf, triggerPresets, usdUnits, usdWhole } from "./protect-model";

describe("triggerPresets", () => {
  it("spreads Early, Balanced and Last call across the room above Aave's line", () => {
    // The design's sample loan: health factor 1.0699.
    expect(triggerPresets(1.0699).map((p) => [p.name, p.trigger])).toEqual([
      ["Early", 1.06],
      ["Balanced", 1.04],
      ["Last call", 1.02],
    ]);
  });

  it("never offers a trigger at or above today's health factor or below the floor", () => {
    for (const hf of [1.021, 1.03, 1.05, 1.12, 1.4, 2, 5]) {
      for (const p of validPresets(triggerPresets(hf))) {
        expect(p.trigger).toBeLessThan(hf);
        expect(p.trigger).toBeGreaterThanOrEqual(1.02);
        expect(p.trigger).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("disables presets too close to today or to Aave, drops collisions, and offers none when there is no room", () => {
    const tight = triggerPresets(1.03);
    expect(new Set(tight.map((p) => p.trigger)).size).toBe(tight.length);
    expect(tight.find((p) => p.id === "early")?.disabled).toBe("above");
    expect(tight.find((p) => p.id === "last")?.disabled).toBe("floor");
    expect(validPresets(tight).length).toBeGreaterThan(0);
    expect(validPresets(triggerPresets(1.015))).toEqual([]);
    expect(triggerPresets(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("caps a very safe loan's triggers at 1.50", () => {
    const p = triggerPresets(4);
    expect(p[0]!.trigger).toBe(1.5);
    expect(p.at(-1)!.trigger).toBeGreaterThan(1.02);
  });

  it("defaults to Balanced", () => {
    expect(defaultPreset(triggerPresets(1.0699))?.id).toBe("balanced");
    expect(defaultPreset([])).toBeUndefined();
  });
});

describe("prices", () => {
  const position = { healthFactor: 1.0699, debtUsd: 106.61 };
  const weth = { priceUsd: 2716, supplied: 0.05, liquidationThreshold: 0.84 };
  it("finds the price at a health factor for a single-collateral loan", () => {
    // price x LT x supplied / debt = HF, so the price scales with the health factor.
    expect(priceAtHf(position, weth, 1)).toBeCloseTo(2716 - (0.0699 * 106.61) / (0.05 * 0.84), 6);
    expect(dropTo(2716, priceAtHf(position, weth, 1))).toBeGreaterThan(0.06);
  });
  it("says safe, careful or danger from the drop to Aave's line", () => {
    expect(safetyOf(0.2)).toBe("safe");
    expect(safetyOf(0.065)).toBe("careful");
    expect(safetyOf(0.02)).toBe("danger");
  });
  it("prints headline dollars without cents above $100", () => {
    expect(usdWhole(2639.6)).toBe("$2,640");
    expect(usdWhole(26.26)).toBe("$26.26");
  });
});

describe("fuelOptions", () => {
  const perBlockFor = (yearly: number) => yearly / 365 / BLOCKS_PER_DAY;
  it("offers 1 month, 3 months and 1 year when a month costs more than the minimum", () => {
    const o = fuelOptions({ perBlockUsd: perBlockFor(36.5), minUnits: 1_000_000n });
    expect(o.map((x) => x.label)).toEqual(["1 month", "3 months", "1 year"]);
    expect(o[0]!.units).toBe(3_000_000n);
    expect(usdUnits(o[2]!.units)).toBe("$36.00");
  });
  it("turns the first card into the minimum on a small loan, and never repeats a price", () => {
    const o = fuelOptions({ perBlockUsd: perBlockFor(3.55), minUnits: 1_000_000n });
    expect(o[0]!.label).toBe("Minimum");
    expect(o[0]!.units).toBe(1_000_000n);
    expect(o.map((x) => x.label)).toEqual(["Minimum", "6 months", "1 year"]);
    expect(new Set(o.map((x) => x.units)).size).toBe(o.length);
  });
  it("keeps fuel that is already there", () => {
    const o = fuelOptions({ perBlockUsd: perBlockFor(12), minUnits: 0n, prepaidUsd: 5, funded: true });
    expect(o[0]!.id).toBe("keep");
    expect(o[0]!.units).toBe(0n);
    expect(o[0]!.days).toBeCloseTo((5 / 12) * 365, 3);
  });
  it("words runways in days, months and years", () => {
    expect(lastsFor(5.2)).toBe("about 5 days");
    expect(lastsFor(92)).toBe("about 3 months");
    expect(lastsFor(370)).toBe("about 1 year");
    expect(lastsFor(0.5)).toBe("about 12 hours");
  });
  it("fills the fuel bar a segment per 36.5 days", () => {
    expect(fuelSegments(0)).toBe(0);
    expect(fuelSegments(3)).toBe(1);
    expect(fuelSegments(365)).toBe(10);
    expect(fuelSegments(Number.POSITIVE_INFINITY)).toBe(10);
  });
});
