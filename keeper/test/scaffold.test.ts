import { describe, expect, it } from "vitest";
import { describeKeeper } from "../src/index.js";

describe("scaffold", () => {
  it("loads the keeper module", () => {
    expect(describeKeeper()).toBe("shield keeper");
  });
});
