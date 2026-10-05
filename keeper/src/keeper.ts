import {
  encodeFunctionData,
  getAddress,
  type AccessList,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { executorAbi } from "./abi/Executor.js";
import { positionRegistryAbi } from "./abi/PositionRegistry.js";
import { repricerAbi } from "./abi/Repricer.js";
import { compressToPages, mergeAccessLists, shieldAccessList } from "./accessList.js";
import type { KeeperConfig } from "./config.js";
import { EXIT_STATUS, plan, shouldReprice, type Observation } from "./decide.js";
import type { Head } from "./heads.js";
import type { Logger } from "./log.js";
import { fetchPythUpdate } from "./pyth.js";
import { GasCeilingError, type Submitter, type TxResult } from "./submit.js";

const ACTIVE_FLAG = 1;

interface AssetInfo {
  collateral: Address;
  feedId: Hex;
  volSlot: bigint;
}

/**
 * One pass per proposed block: read every active record's exit status and health factor on proposed state,
 * submit exits that are due, and reprice on the configured cadence.
 */
export class Keeper {
  private assets = new Map<number, AssetInfo>();
  private recordSlots = new Map<Address, bigint>();
  private inFlight = new Set<Address>();
  private busy = false;
  private pendingHead?: Head;
  private startBlock?: bigint;
  readonly results: { block: bigint; label: string; hash: Hex; status: string }[] = [];

  constructor(
    private readonly client: PublicClient,
    private readonly submitter: Submitter,
    private readonly cfg: KeeperConfig,
    private readonly logger: Logger,
  ) {}

  /** Called for every new head. Heads that arrive while a pass runs collapse into the newest one. */
  async onHead(head: Head): Promise<void> {
    if (this.busy) {
      this.pendingHead = head;
      return;
    }
    this.busy = true;
    try {
      let next: Head | undefined = head;
      while (next) {
        this.pendingHead = undefined;
        await this.pass(next);
        next = this.pendingHead;
      }
    } finally {
      this.busy = false;
    }
  }

  private async pass(head: Head): Promise<void> {
    this.startBlock ??= head.number;
    let observations: Observation[];
    try {
      observations = await this.observe();
    } catch (err) {
      this.logger.error("block.read_failed", { block: head.number, error: err });
      return;
    }
    const repriceDue = shouldReprice(head.number, this.startBlock, this.cfg);
    const p = plan(observations, repriceDue, this.inFlight);
    this.logger.info("block", {
      block: head.number,
      source: head.source,
      lagMs: Date.now() - head.receivedAt,
      active: observations.length,
      positions: observations.map((o) => ({
        borrower: o.borrower,
        hf: formatHf(o.healthFactor),
        trigger: o.trigger / 1e4,
        status: o.status,
      })),
      decision: p.exits.length ? "exit" : p.reprice ? "reprice" : "hold",
    });

    for (const borrower of p.exits) await this.exit(head, borrower);
    if (p.reprice) {
      const toReprice = observations.filter((o) => o.status !== "NotActive" && !p.exits.includes(o.borrower));
      if (toReprice.length) await this.reprice(head, toReprice.map((o) => o.borrower));
    }
  }

  /** Reads active borrowers, their records and exit previews in two multicalls on proposed state. */
  async observe(): Promise<Observation[]> {
    const count = await this.client.readContract({
      address: this.cfg.registry,
      abi: positionRegistryAbi,
      functionName: "activeCount",
      blockTag: "latest",
    });
    if (count === 0n) return [];
    const borrowers = (await this.client.readContract({
      address: this.cfg.registry,
      abi: positionRegistryAbi,
      functionName: "activeBorrowers",
      args: [0n, count],
      blockTag: "latest",
    })) as Address[];

    const calls = borrowers.flatMap((b) => [
      { address: this.cfg.executor, abi: executorAbi, functionName: "previewExit" as const, args: [b] as const },
      { address: this.cfg.registry, abi: positionRegistryAbi, functionName: "record" as const, args: [b] as const },
    ]);
    const res = await this.client.multicall({ contracts: calls, allowFailure: true, blockTag: "latest" });
    return borrowers.map((borrower, i) => {
      const preview = res[2 * i];
      const record = res[2 * i + 1];
      const rec = record?.status === "success" ? (record.result as { trigger: number; flags: number }) : undefined;
      if (preview?.status !== "success") {
        return { borrower, status: "PreviewFailed", healthFactor: 0n, repayAmount: 0n, trigger: rec?.trigger ?? 0 };
      }
      const [status, repayAmount, , healthFactor] = preview.result as readonly [number, bigint, bigint, bigint];
      const name = EXIT_STATUS[status] ?? "PreviewFailed";
      const active = rec ? (rec.flags & ACTIVE_FLAG) !== 0 : true;
      return {
        borrower: getAddress(borrower),
        status: active ? name : "NotActive",
        healthFactor,
        repayAmount,
        trigger: rec?.trigger ?? 0,
      };
    });
  }

  private async exit(head: Head, borrower: Address): Promise<void> {
    this.inFlight.add(borrower);
    try {
      const asset = await this.assetFor(borrower);
      const update = await fetchPythUpdate(asset ? [asset.feedId] : [], {
        hermesUrl: this.cfg.hermesUrl,
        apiKey: this.cfg.hermesApiKey,
        logger: this.logger,
      });
      const data = encodeFunctionData({ abi: executorAbi, functionName: "exit", args: [borrower, update] });
      const accessList = await this.accessListFor(this.cfg.executor, data, [borrower], asset ? [asset] : []);
      const result = await this.submit(head, "exit", this.cfg.executor, data, accessList, this.cfg.maxGasExit, {
        borrower,
      });
      if (result) this.logger.info("exit.done", { block: head.number, borrower, hash: result.hash, status: result.receipt.status });
    } finally {
      this.inFlight.delete(borrower);
    }
  }

  private async reprice(head: Head, borrowers: Address[]): Promise<void> {
    const assets: AssetInfo[] = [];
    for (const b of borrowers) {
      const a = await this.assetFor(b);
      if (a && !assets.some((x) => x.feedId === a.feedId)) assets.push(a);
    }
    const update = await fetchPythUpdate(
      assets.map((a) => a.feedId),
      { hermesUrl: this.cfg.hermesUrl, apiKey: this.cfg.hermesApiKey, logger: this.logger },
    );
    const data = encodeFunctionData({ abi: repricerAbi, functionName: "repriceMany", args: [borrowers, update] });
    const accessList = await this.accessListFor(this.cfg.repricer, data, borrowers, assets);
    await this.submit(head, "repriceMany", this.cfg.repricer, data, accessList, this.cfg.maxGasReprice, {
      borrowers: borrowers.length,
    }, this.cfg.repriceGasHeadroom);
  }

  private async submit(
    head: Head,
    label: string,
    to: Address,
    data: Hex,
    accessList: AccessList,
    maxGas: bigint,
    fields: Record<string, unknown>,
    headroom?: bigint,
  ): Promise<TxResult | undefined> {
    if (this.cfg.dryRun) {
      this.logger.info("tx.dry_run", { block: head.number, label, ...fields });
      return undefined;
    }
    try {
      const result = await this.submitter.send({ label, to, data, accessList, maxGas, headroom });
      this.results.push({ block: result.receipt.blockNumber, label, hash: result.hash, status: result.receipt.status });
      return result;
    } catch (err) {
      if (err instanceof GasCeilingError) {
        this.logger.error("tx.gas_ceiling", { block: head.number, label, estimate: err.estimate, ceiling: err.ceiling });
      } else {
        this.logger.warn("tx.failed", { block: head.number, label, ...fields, error: err });
      }
      return undefined;
    }
  }

  /**
   * Access list for a Shield call: the registry record pages and volatility-window pages (from the contracts'
   * own slot views), merged with the node's eth_createAccessList result when available, then reduced to one
   * key per MIP-8 page.
   */
  async accessListFor(to: Address, data: Hex, borrowers: Address[], assets: AssetInfo[]): Promise<AccessList> {
    const recordSlots = await Promise.all(borrowers.map((b) => this.recordSlot(b)));
    const own = shieldAccessList({
      registry: this.cfg.registry,
      recordSlots,
      repricer: this.cfg.repricer,
      volSlots: assets.map((a) => a.volSlot),
    });
    let node: AccessList = [];
    try {
      const res = await this.client.createAccessList({
        account: this.submitter.address,
        to,
        data,
        blockTag: "latest",
      });
      node = res.accessList;
    } catch (err) {
      this.logger.debug("accesslist.node_unavailable", { error: err });
    }
    return compressToPages(mergeAccessLists(own, node));
  }

  private async recordSlot(borrower: Address): Promise<bigint> {
    const cached = this.recordSlots.get(borrower);
    if (cached !== undefined) return cached;
    const slot = await this.client.readContract({
      address: this.cfg.registry,
      abi: positionRegistryAbi,
      functionName: "recordSlot",
      args: [borrower],
    });
    this.recordSlots.set(borrower, slot);
    return slot;
  }

  private async assetFor(borrower: Address): Promise<AssetInfo | undefined> {
    const rec = (await this.client.readContract({
      address: this.cfg.registry,
      abi: positionRegistryAbi,
      functionName: "record",
      args: [borrower],
      blockTag: "latest",
    })) as { collateralId: number };
    const cached = this.assets.get(rec.collateralId);
    if (cached) return cached;
    const collateral = (await this.client.readContract({
      address: this.cfg.registry,
      abi: positionRegistryAbi,
      functionName: "assetAt",
      args: [rec.collateralId],
    })) as Address;
    const cfg = (await this.client.readContract({
      address: this.cfg.registry,
      abi: positionRegistryAbi,
      functionName: "assetConfig",
      args: [collateral],
    })) as { pythFeedId: Hex };
    const volSlot = (await this.client.readContract({
      address: this.cfg.repricer,
      abi: repricerAbi,
      functionName: "volSlot",
      args: [cfg.pythFeedId],
    })) as bigint;
    const info = { collateral, feedId: cfg.pythFeedId, volSlot };
    this.assets.set(rec.collateralId, info);
    return info;
  }
}

export function formatHf(hf: bigint): number | "inf" {
  if (hf > 10n ** 30n) return "inf";
  return Number(hf / 10n ** 14n) / 1e4;
}
