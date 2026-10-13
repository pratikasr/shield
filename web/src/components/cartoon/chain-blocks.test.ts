import { encodeEventTopics } from "viem";
import { describe, expect, it } from "vitest";
import { executorAbi, repricerAbi } from "@/lib/abis";
import { EXITED_TOPIC, REPRICED_TOPIC } from "./chain-blocks";

describe("chain-blocks topics", () => {
  it("match the contract ABIs", () => {
    expect(REPRICED_TOPIC).toBe(encodeEventTopics({ abi: repricerAbi, eventName: "Repriced" })[0]);
    expect(EXITED_TOPIC).toBe(encodeEventTopics({ abi: executorAbi, eventName: "Exited" })[0]);
  });
});
