import { getAddress, type Address, type PublicClient } from "viem";
import { executorAbi } from "./abi/Executor.js";
import { repricerAbi } from "./abi/Repricer.js";
import type { KeeperConfig } from "./config.js";

/**
 * Refuses to start against a wrong or half-written deployment: each Shield address must hold code, and the
 * Executor and Repricer must both point at the configured registry (and the Executor at the configured Repricer).
 */
export async function verifyDeployment(
  client: Pick<PublicClient, "getCode" | "readContract">,
  cfg: Pick<KeeperConfig, "registry" | "repricer" | "executor">,
): Promise<void> {
  const named: [string, Address][] = [
    ["PositionRegistry", cfg.registry],
    ["Repricer", cfg.repricer],
    ["Executor", cfg.executor],
  ];
  for (const [name, address] of named) {
    const code = await client.getCode({ address, blockTag: "latest" });
    if (!code || code === "0x") throw new Error(`no contract code at the ${name} address ${address}: wrong deployment file or chain`);
  }
  const [executorRegistry, repricerRegistry, executorRepricer] = (await Promise.all([
    client.readContract({ address: cfg.executor, abi: executorAbi, functionName: "registry" }),
    client.readContract({ address: cfg.repricer, abi: repricerAbi, functionName: "registry" }),
    client.readContract({ address: cfg.executor, abi: executorAbi, functionName: "repricer" }),
  ])) as Address[];
  if (getAddress(executorRegistry!) !== cfg.registry) {
    throw new Error(`Executor ${cfg.executor} uses registry ${executorRegistry}, not ${cfg.registry}`);
  }
  if (getAddress(repricerRegistry!) !== cfg.registry) {
    throw new Error(`Repricer ${cfg.repricer} uses registry ${repricerRegistry}, not ${cfg.registry}`);
  }
  if (getAddress(executorRepricer!) !== cfg.repricer) {
    throw new Error(`Executor ${cfg.executor} uses Repricer ${executorRepricer}, not ${cfg.repricer}`);
  }
}
