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
import { shieldForwarderFactoryAbi } from "./abi/ShieldForwarderFactory.js";
import { compressToPages, mergeAccessLists, shieldAccessList } from "./accessList.js";
import type { KeeperConfig } from "./config.js";
import {
  EXIT_STATUS,
  FLAG_ACTIVE,
  byRisk,
  chunk,
  hermesMightUnblock,
  isRepriceable,
  isStuck,
  plan,
  shouldReprice,
  type Observation,
} from "./decide.js";
import type { Head } from "./heads.js";
import type { Logger } from "./log.js";
import { fetchPythUpdate } from "./pyth.js";
import {
  FeeCapError,
  GasCeilingError,
  InsufficientFundsError,
  TxInFlightError,
  isRevert,
  type Submitter,
  type TxRequest,
  type TxResult,
} from "./submit.js";

/** activeBorrowers page size; one page covers every realistic book, so the list is one round trip. */
const BORROWER_PAGE = 500n;
/** A repriceMany gas limit measured for a batch is reused for this many blocks, then measured again. */
const REMEASURE_EVERY_N_BLOCKS = 20n;
/** An access list built for a batch is reused for this many blocks. */
const ACCESS_LIST_REFRESH_BLOCKS = 200n;
/** A borrower whose reprice reverts on its own is left out of batches for this many blocks. */
const REPRICE_SKIP_BLOCKS = 100n;
/** At most one "at trigger but not Ready" warning per borrower per this many blocks (status changes log at once). */
const STUCK_WARN_EVERY_N_BLOCKS = 200n;
/** A sweep that fails (its estimate reverts, or it reverts on chain) is left out for this many blocks. */
const SWEEP_SKIP_BLOCKS = 100n;
/** A PythStale or OracleDeviation exit is retried with a fresh Hermes update at most this often. */
const HERMES_RETRY_EVERY_N_BLOCKS = 3n;
const LOW_BALANCE_LOG_MS = 60_000;
/** In-memory record of sent transactions, for tests and diagnostics; the log is the durable record. */
const MAX_RESULTS = 500;

const multicall3BalanceAbi = [
  {
    type: "function",
    name: "getEthBalance",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

const pythFeeAbi = [
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
] as const;

interface AssetInfo {
  collateral: Address;
  feedId: Hex;
  volSlot: bigint;
}

interface RecordView {
  trigger: number;
  flags: number;
  collateralId: number;
  prepaid: bigint;
  optedInAt: bigint;
}

export interface Observed {
  observations: Observation[];
  /** The keeper's native balance on proposed state, read in the same multicall. */
  balance?: bigint;
}

/** USDC waiting at a deposit address: a borrower's (premium) or the treasury's (vault). */
interface SweepTarget {
  kind: "premium" | "vault";
  /** The borrower, for a premium sweep. */
  borrower?: Address;
  forwarder: Address;
  amount: bigint;
}

type Outcome = "sent" | "stop" | "failed";
type BatchOutcome = { kind: "sent" | "stop" | "failed" | "reverted" } | { kind: "too_big"; limit: bigint };

/**
 * One pass per proposed block: read every active record's exit status and health factor on proposed state,
 * submit exits that are due, and reprice on the configured cadence.
 *
 * Sequential round trips in a steady-state reprice-only pass (one batch, Hermes off), counted on 5 Oct 2026:
 *   before: activeCount, activeBorrowers, multicall, record (again, per borrower), eth_createAccessList,
 *           eth_estimateGas, eth_getBlockByNumber and eth_maxPriorityFeePerGas (fee data), send: 9
 *   after:  activeBorrowers (one page), multicall (previews, records and the keeper balance), send: 3
 * The collateral id comes from the multicall's record, the access list is cached per batch for 200 blocks, the
 * repriceMany gas limit is measured when the batch changes and again every 20 blocks or after a failure, and fee
 * data is reused for 1.5 s. An exit still measures its gas and builds its access list fresh: 5 round trips
 * (activeBorrowers, multicall, eth_createAccessList, eth_estimateGas, send), plus Hermes and getUpdateFee when a
 * Hermes key is set.
 */
export class Keeper {
  private assets = new Map<number, AssetInfo>();
  private recordSlots = new Map<Address, bigint>();
  private accessLists = new Map<string, { list: AccessList; at: bigint }>();
  private gasLimits = new Map<string, { limit: bigint; at: bigint }>();
  private repriceSkip = new Map<Address, bigint>();
  private stuckWarned = new Map<Address, { status: string; at: bigint }>();
  private hermesTried = new Map<Address, bigint>();
  /** Deposit addresses are fixed per factory (CREATE2), so each is read once. */
  private forwarderOf = new Map<Address, Address>();
  private treasuryForwarder?: Address;
  private sweepAsset?: Address;
  private sweepSkip = new Map<string, bigint>();
  private repriceChunkSize = Number.POSITIVE_INFINITY;
  private lastLowBalanceLog = Number.NEGATIVE_INFINITY;
  private pythAddress?: Address;
  private busy = false;
  private stopping = false;
  private current?: Promise<void>;
  private pendingHead?: Head;
  private startBlock?: bigint;
  private lastRepriceBlock?: bigint;
  private lastSweepBlock?: bigint;
  readonly results: { block: bigint; label: string; hash: Hex; status: string }[] = [];

  constructor(
    private readonly client: PublicClient,
    private readonly submitter: Submitter,
    private readonly cfg: KeeperConfig,
    private readonly logger: Logger,
  ) {}

  /** Called for every new head. Heads that arrive while a pass runs collapse into the newest one. */
  async onHead(head: Head): Promise<void> {
    if (this.stopping) return;
    if (this.busy) {
      this.pendingHead = head;
      return;
    }
    this.busy = true;
    const run = (async () => {
      let next: Head | undefined = head;
      while (next && !this.stopping) {
        this.pendingHead = undefined;
        await this.pass(next);
        next = this.pendingHead;
      }
    })();
    this.current = run;
    try {
      await run;
    } finally {
      this.busy = false;
      this.current = undefined;
    }
  }

  /**
   * Stops taking new heads and starting new sends, then waits for the send in progress (if any) to finish.
   * Resolves true when the keeper is idle, false if `timeoutMs` passed first.
   */
  async stop(timeoutMs = 10_000): Promise<boolean> {
    this.stopping = true;
    const c = this.current;
    if (!c) return true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((r) => (timer = setTimeout(() => r(false), timeoutMs)));
    const done = c.then(
      () => true,
      () => true,
    );
    const idle = await Promise.race([done, timeout]);
    clearTimeout(timer);
    return idle;
  }

  private async pass(head: Head): Promise<void> {
    this.startBlock ??= head.number;
    let observed: Observed;
    try {
      observed = await this.observe();
    } catch (err) {
      this.logger.error("block.read_failed", { block: head.number, error: err });
      return;
    }
    const { observations, balance } = observed;

    // A transaction from an earlier pass may still land: send nothing until it resolves (audit M2).
    let waiting = false;
    if (this.submitter.pending) {
      const state = await this.submitter.resolvePending().catch(() => "inflight" as const);
      waiting = state === "inflight";
    }
    const lowBalance = balance !== undefined && balance < this.cfg.minBalanceForExitWei;
    if (lowBalance) this.logLowBalance(head, balance);
    const repriceDue = !lowBalance && shouldReprice(head.number, this.startBlock, this.lastRepriceBlock, this.cfg);
    const p = plan(observations, repriceDue);
    const hermesRetries = this.cfg.hermesApiKey
      ? observations.filter((o) => hermesMightUnblock(o) && this.hermesDue(head, o.borrower))
      : [];
    this.warnStuck(head, observations);

    this.logger.info("block", {
      block: head.number,
      source: head.source,
      lagMs: Date.now() - head.receivedAt,
      active: observations.length,
      balance,
      positions: observations.map((o) => ({
        borrower: o.borrower,
        hf: formatHf(o.healthFactor),
        trigger: o.trigger / 1e4,
        status: o.status,
      })),
      decision: waiting ? "wait_pending" : p.exits.length ? "exit" : p.reprice ? "reprice" : "hold",
    });
    if (waiting) return;

    // Each exit is isolated: one borrower's failed read or send never stops the next exit or the reprice (M3).
    const exiting = new Set<Address>();
    const toExit = [
      ...observations.filter((o) => p.exits.includes(o.borrower)).map((o) => ({ o, retry: false })),
      ...hermesRetries.map((o) => ({ o, retry: true })),
    ];
    for (const { o, retry } of toExit) {
      if (this.stopping) return;
      exiting.add(o.borrower);
      let outcome: Outcome;
      try {
        outcome = await this.exit(head, o, retry);
      } catch (err) {
        this.logger.warn("exit.failed", { block: head.number, borrower: o.borrower, error: err });
        continue;
      }
      if (outcome === "stop") return;
    }

    if (p.reprice && !this.stopping) {
      const candidates = observations.filter(
        (o) => isRepriceable(o) && !exiting.has(o.borrower) && !this.skipped(head, o.borrower),
      );
      if (candidates.length) {
        try {
          await this.reprice(head, candidates);
        } catch (err) {
          this.logger.warn("reprice.failed", { block: head.number, error: err });
        }
      }
    }

    // Sweeps come last, never in a pass with an exit to make, and never on the balance kept for exits.
    if (toExit.length === 0 && !lowBalance && !this.stopping && !this.submitter.pending && this.sweepDue(head)) {
      try {
        await this.sweep(head, observations);
      } catch (err) {
        this.logger.warn("sweep.read_failed", { block: head.number, error: err });
      }
    }
    this.prune(head, observations);
  }

  /**
   * Reads the active borrowers, then each one's exit preview and record plus the keeper's balance in one
   * multicall, all on proposed state.
   */
  async observe(): Promise<Observed> {
    const borrowers = await this.activeBorrowers();
    if (borrowers.length === 0) return { observations: [] };
    const multicall3 = this.client.chain?.contracts?.multicall3?.address;
    const calls: {
      address: Address;
      abi: typeof executorAbi | typeof positionRegistryAbi | typeof multicall3BalanceAbi;
      functionName: string;
      args: readonly unknown[];
    }[] = borrowers.flatMap((b) => [
      { address: this.cfg.executor, abi: executorAbi, functionName: "previewExit", args: [b] as const },
      { address: this.cfg.registry, abi: positionRegistryAbi, functionName: "record", args: [b] as const },
    ]);
    if (multicall3) {
      calls.push({ address: multicall3, abi: multicall3BalanceAbi, functionName: "getEthBalance", args: [this.submitter.address] });
    }
    const res = (await this.client.multicall({ contracts: calls as never, allowFailure: true, blockTag: "latest" })) as {
      status: "success" | "failure";
      result?: unknown;
    }[];
    const observations = borrowers.map((raw, i): Observation => {
      const borrower = getAddress(raw);
      const preview = res[2 * i];
      const record = res[2 * i + 1];
      const rec = record?.status === "success" ? (record.result as RecordView) : undefined;
      const base = {
        borrower,
        trigger: rec?.trigger ?? 0,
        flags: rec?.flags,
        collateralId: rec?.collateralId,
        prepaid: rec?.prepaid,
        optedInAt: rec?.optedInAt,
      };
      if (preview?.status !== "success") return { ...base, status: "PreviewFailed", healthFactor: 0n, repayAmount: 0n };
      const [status, repayAmount, , healthFactor] = preview.result as readonly [number, bigint, bigint, bigint];
      const name = EXIT_STATUS[status] ?? "PreviewFailed";
      const active = rec ? (rec.flags & FLAG_ACTIVE) !== 0 : true;
      return { ...base, status: active ? name : "NotActive", healthFactor, repayAmount };
    });
    let balance: bigint | undefined;
    const bal = multicall3 ? res[2 * borrowers.length] : undefined;
    if (bal?.status === "success") balance = bal.result as bigint;
    else {
      balance = await this.client
        .getBalance({ address: this.submitter.address, blockTag: "latest" })
        .catch(() => undefined);
    }
    return { observations, balance };
  }

  private async activeBorrowers(): Promise<Address[]> {
    const out: Address[] = [];
    for (let offset = 0n; ; offset += BORROWER_PAGE) {
      const page = (await this.client.readContract({
        address: this.cfg.registry,
        abi: positionRegistryAbi,
        functionName: "activeBorrowers",
        args: [offset, BORROWER_PAGE],
        blockTag: "latest",
      })) as Address[];
      out.push(...page);
      if (BigInt(page.length) < BORROWER_PAGE) return out;
    }
  }

  private async exit(head: Head, o: Observation, hermesRetry: boolean): Promise<Outcome> {
    const asset = o.collateralId !== undefined ? await this.assetFor(o.collateralId) : undefined;
    const update = await fetchPythUpdate(asset ? [asset.feedId] : [], {
      hermesUrl: this.cfg.hermesUrl,
      apiKey: this.cfg.hermesApiKey,
      logger: this.logger,
    });
    if (hermesRetry) {
      this.hermesTried.set(o.borrower, head.number);
      if (update.length === 0) return "failed";
    }
    const value = await this.updateFee(update);
    const data = encodeFunctionData({ abi: executorAbi, functionName: "exit", args: [o.borrower, update] });
    const accessList = await this.accessListFor(this.cfg.executor, data, [o.borrower], asset ? [asset] : [], value);
    const tx: TxRequest = { label: "exit", to: this.cfg.executor, data, value, accessList, maxGas: this.cfg.maxGasExit };
    const r = await this.submit(head, tx, { borrower: o.borrower, status: o.status }, { quietRevert: hermesRetry });
    if (r.result) {
      this.logger.info("exit.done", { block: head.number, borrower: o.borrower, hash: r.result.hash, status: r.result.receipt.status });
    }
    return r.outcome;
  }

  /**
   * repriceMany for the candidates, riskiest first, in chunks that fit under MAX_GAS_REPRICE (audit M6). A chunk
   * whose estimate reverts is split in two until the borrower that reverts is found; that borrower is left out
   * for REPRICE_SKIP_BLOCKS and everyone else is still repriced.
   */
  private async reprice(head: Head, candidates: Observation[]): Promise<void> {
    const ordered = [...candidates].sort(byRisk).map((o) => o.borrower);
    const assets = await this.assetsOf(candidates);
    const update = await fetchPythUpdate(
      assets.map((a) => a.feedId),
      { hermesUrl: this.cfg.hermesUrl, apiKey: this.cfg.hermesApiKey, logger: this.logger },
    );
    const value = await this.updateFee(update);
    const queue = chunk(ordered, Math.min(this.repriceChunkSize, ordered.length));
    let sent = false;
    while (queue.length && !this.stopping) {
      const batch = queue.shift()!;
      const r = await this.repriceBatch(head, batch, update, value, assets);
      if (r.kind === "sent") {
        sent = true;
        continue;
      }
      if (r.kind === "too_big") {
        if (batch.length === 1) {
          this.skip(head, batch[0]!, "gas_ceiling");
          continue;
        }
        const fit = Math.floor((batch.length * Number(this.cfg.maxGasReprice) * 0.9) / Number(r.limit));
        const size = Math.max(1, Math.min(batch.length - 1, fit));
        this.repriceChunkSize = size;
        this.logger.info("reprice.split", { block: head.number, from: batch.length, to: size });
        queue.unshift(...chunk(batch, size));
        continue;
      }
      if (r.kind === "reverted") {
        if (batch.length === 1) {
          this.skip(head, batch[0]!, "reverted");
          continue;
        }
        const mid = Math.ceil(batch.length / 2);
        queue.unshift(batch.slice(0, mid), batch.slice(mid));
        continue;
      }
      break; // in flight, out of funds, fee above cap, or a transport failure: try again next block
    }
    if (sent) this.lastRepriceBlock = head.number;
  }

  private async repriceBatch(
    head: Head,
    batch: Address[],
    update: Hex[],
    value: bigint,
    assets: AssetInfo[],
  ): Promise<BatchOutcome> {
    const data = encodeFunctionData({ abi: repricerAbi, functionName: "repriceMany", args: [batch, update] });
    const key = `${batch.join(",")}|${update.length ? "pyth" : "push"}`;
    const tx: TxRequest = {
      label: "repriceMany",
      to: this.cfg.repricer,
      data,
      value,
      maxGas: this.cfg.maxGasReprice,
      headroom: this.cfg.repriceGasHeadroom,
      maxFeePerGasCap: this.cfg.maxFeePerGasRepriceWei,
    };
    if (this.cfg.dryRun) {
      this.logger.info("tx.dry_run", { block: head.number, label: tx.label, borrowers: batch.length });
      return { kind: "sent" };
    }
    const cachedList = this.accessLists.get(key);
    if (cachedList && head.number - cachedList.at < ACCESS_LIST_REFRESH_BLOCKS) tx.accessList = cachedList.list;
    else {
      tx.accessList = await this.accessListFor(this.cfg.repricer, data, batch, assets, value);
      this.accessLists.set(key, { list: tx.accessList, at: head.number });
    }
    const cachedGas = this.gasLimits.get(key);
    let gas = cachedGas && head.number - cachedGas.at < REMEASURE_EVERY_N_BLOCKS ? cachedGas.limit : undefined;
    if (gas === undefined) {
      try {
        gas = await this.submitter.measureGas(tx);
      } catch (err) {
        if (err instanceof GasCeilingError) {
          this.logger.warn("tx.gas_ceiling", { block: head.number, label: tx.label, borrowers: batch.length, estimate: err.estimate, ceiling: err.ceiling });
          return { kind: "too_big", limit: err.estimate };
        }
        if (isRevert(err)) {
          this.logger.warn("reprice.estimate_reverted", { block: head.number, borrowers: batch.length, error: err });
          return { kind: "reverted" };
        }
        this.logger.warn("tx.failed", { block: head.number, label: tx.label, borrowers: batch.length, error: err });
        return { kind: "failed" };
      }
      this.gasLimits.set(key, { limit: gas, at: head.number });
    }
    const r = await this.submit(head, tx, { borrowers: batch.length }, { gas });
    if (r.outcome !== "sent" || r.result?.receipt.status !== "success") {
      // Measure again (and rebuild the access list) before the next attempt with this batch.
      this.gasLimits.delete(key);
      this.accessLists.delete(key);
    }
    return { kind: r.outcome };
  }

  private sweepDue(head: Head): boolean {
    if (!this.cfg.forwarders || this.cfg.sweepEveryNBlocks === 0) return false;
    return this.lastSweepBlock === undefined || head.number - this.lastSweepBlock >= BigInt(this.cfg.sweepEveryNBlocks);
  }

  /**
   * Moves USDC waiting at deposit addresses into Shield (ADR-039): a borrower's into their prepaid premium with
   * `sweepPremium`, the treasury's into the vault with `sweepVault`. One multicall reads every balance (a second one
   * first, only for deposit addresses not read before). Riskiest borrowers go first and the vault last. Each sweep
   * is isolated like an exit, and one that fails is left out for SWEEP_SKIP_BLOCKS. After each sweep the pass ends
   * when a newer head is waiting, so a sweep holds back the next exit check by at most one send; the next pass
   * sweeps the rest.
   */
  private async sweep(head: Head, observations: Observation[]): Promise<void> {
    const factory = this.cfg.forwarders!;
    this.lastSweepBlock = head.number;
    const borrowers = [...observations].sort(byRisk).map((o) => o.borrower);
    await this.readDepositAddresses(factory, borrowers);
    const targets: Omit<SweepTarget, "amount">[] = [
      ...borrowers.map((b) => ({ kind: "premium" as const, borrower: b, forwarder: this.forwarderOf.get(b)! })),
      { kind: "vault" as const, forwarder: this.treasuryForwarder! },
    ].filter((t) => !this.sweepSkipped(head, sweepKey(t)));
    const res = (await this.client.multicall({
      contracts: targets.map((t) => ({
        address: this.sweepAsset!,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [t.forwarder],
      })),
      allowFailure: true,
      blockTag: "latest",
    })) as { status: "success" | "failure"; result?: unknown }[];
    const waiting: SweepTarget[] = [];
    targets.forEach((t, i) => {
      const r = res[i];
      if (r?.status === "success" && (r.result as bigint) >= this.cfg.sweepMinUnits) waiting.push({ ...t, amount: r.result as bigint });
    });
    if (waiting.length === 0) {
      this.logger.debug("sweep.none", { block: head.number, checked: targets.length });
      return;
    }
    this.logger.info("sweep.due", { block: head.number, checked: targets.length, waiting });
    for (const [i, t] of waiting.entries()) {
      if (this.stopping) return;
      if (i > 0 && this.pendingHead) {
        this.lastSweepBlock = undefined; // due again on the next pass
        this.logger.info("sweep.deferred", { block: head.number, left: waiting.length - i });
        return;
      }
      let outcome: Outcome;
      try {
        outcome = await this.sweepOne(head, factory, t);
      } catch (err) {
        this.logger.warn("sweep.failed", { block: head.number, kind: t.kind, borrower: t.borrower, error: err });
        outcome = "failed";
      }
      if (outcome === "stop") return;
      if (outcome === "failed") {
        this.sweepSkip.set(sweepKey(t), head.number + SWEEP_SKIP_BLOCKS);
        this.logger.warn("sweep.skipped", { block: head.number, kind: t.kind, borrower: t.borrower, untilBlock: head.number + SWEEP_SKIP_BLOCKS });
      }
    }
  }

  private async sweepOne(head: Head, factory: Address, t: SweepTarget): Promise<Outcome> {
    const data =
      t.kind === "premium"
        ? encodeFunctionData({ abi: shieldForwarderFactoryAbi, functionName: "sweepPremium", args: [t.borrower!] })
        : encodeFunctionData({ abi: shieldForwarderFactoryAbi, functionName: "sweepVault" });
    const accessList = await this.accessListFor(factory, data, t.borrower ? [t.borrower] : [], []);
    const tx: TxRequest = {
      label: t.kind === "premium" ? "sweepPremium" : "sweepVault",
      to: factory,
      data,
      accessList,
      maxGas: this.cfg.maxGasSweep,
      maxFeePerGasCap: this.cfg.maxFeePerGasRepriceWei,
    };
    const fields = { kind: t.kind, borrower: t.borrower, forwarder: t.forwarder, amount: t.amount };
    const r = await this.submit(head, tx, fields);
    if (r.result) {
      this.logger.info("sweep.done", { block: head.number, ...fields, hash: r.result.hash, status: r.result.receipt.status });
      if (r.result.receipt.status !== "success") return "failed";
    }
    return r.outcome;
  }

  /** Reads the deposit addresses not read before, the treasury's and the swept token, in one multicall. */
  private async readDepositAddresses(factory: Address, borrowers: Address[]): Promise<void> {
    const missing = borrowers.filter((b) => !this.forwarderOf.has(b));
    const calls: { address: Address; abi: typeof shieldForwarderFactoryAbi; functionName: string; args: readonly unknown[] }[] =
      missing.map((b) => ({ address: factory, abi: shieldForwarderFactoryAbi, functionName: "forwarderFor", args: [b] }));
    const readTreasury = this.treasuryForwarder === undefined;
    const readAsset = this.sweepAsset === undefined;
    if (readTreasury) calls.push({ address: factory, abi: shieldForwarderFactoryAbi, functionName: "treasuryForwarder", args: [] });
    if (readAsset) calls.push({ address: factory, abi: shieldForwarderFactoryAbi, functionName: "asset", args: [] });
    if (calls.length === 0) return;
    const res = (await this.client.multicall({ contracts: calls as never, allowFailure: false, blockTag: "latest" })) as Address[];
    missing.forEach((b, i) => this.forwarderOf.set(b, getAddress(res[i]!)));
    let next = missing.length;
    if (readTreasury) this.treasuryForwarder = getAddress(res[next++]!);
    if (readAsset) this.sweepAsset = getAddress(res[next]!);
  }

  private sweepSkipped(head: Head, key: string): boolean {
    const until = this.sweepSkip.get(key);
    return until !== undefined && head.number < until;
  }

  private async submit(
    head: Head,
    tx: TxRequest,
    fields: Record<string, unknown>,
    opts: { gas?: bigint; quietRevert?: boolean } = {},
  ): Promise<{ outcome: Outcome; result?: TxResult }> {
    if (this.cfg.dryRun) {
      this.logger.info("tx.dry_run", { block: head.number, label: tx.label, ...fields });
      return { outcome: "sent" };
    }
    try {
      const result = await this.submitter.send(tx, opts.gas);
      this.results.push({ block: result.receipt.blockNumber, label: tx.label, hash: result.hash, status: result.receipt.status });
      if (this.results.length > MAX_RESULTS) this.results.splice(0, this.results.length - MAX_RESULTS);
      return { outcome: "sent", result };
    } catch (err) {
      if (err instanceof TxInFlightError) {
        this.logger.warn("tx.in_flight", { block: head.number, label: tx.label, pending: err.hash, ...fields });
        return { outcome: "stop" };
      }
      if (err instanceof InsufficientFundsError) {
        this.logger.error("tx.insufficient_funds", { block: head.number, label: tx.label, ...fields });
        return { outcome: "stop" };
      }
      if (err instanceof FeeCapError) {
        this.logger.info("tx.fee_above_cap", { block: head.number, label: tx.label, maxFeePerGas: err.maxFeePerGas, cap: err.cap });
        return { outcome: "stop" };
      }
      if (err instanceof GasCeilingError) {
        this.logger.error("tx.gas_ceiling", { block: head.number, label: tx.label, estimate: err.estimate, ceiling: err.ceiling, ...fields });
        return { outcome: "failed" };
      }
      const level = opts.quietRevert && isRevert(err) ? "debug" : "warn";
      this.logger[level]("tx.failed", { block: head.number, label: tx.label, ...fields, error: err });
      return { outcome: "failed" };
    }
  }

  /**
   * Access list for a Shield call: the registry record pages and volatility-window pages (from the contracts'
   * own slot views), merged with the node's eth_createAccessList result when available, then reduced to one
   * key per MIP-8 page.
   */
  async accessListFor(to: Address, data: Hex, borrowers: Address[], assets: AssetInfo[], value = 0n): Promise<AccessList> {
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
        value: value || undefined,
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

  /** Collateral, Pyth feed and volatility-window slot for a collateral id; read once and cached. */
  private async assetFor(collateralId: number): Promise<AssetInfo> {
    const cached = this.assets.get(collateralId);
    if (cached) return cached;
    const collateral = (await this.client.readContract({
      address: this.cfg.registry,
      abi: positionRegistryAbi,
      functionName: "assetAt",
      args: [collateralId],
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
    this.assets.set(collateralId, info);
    return info;
  }

  /** The distinct assets of the candidates. A failed asset read only drops that asset's pages and feed. */
  private async assetsOf(obs: Observation[]): Promise<AssetInfo[]> {
    const ids = [...new Set(obs.map((o) => o.collateralId).filter((id): id is number => id !== undefined))];
    const settled = await Promise.allSettled(ids.map((id) => this.assetFor(id)));
    const out: AssetInfo[] = [];
    for (const s of settled) {
      if (s.status === "rejected") {
        this.logger.warn("asset.read_failed", { error: s.reason });
        continue;
      }
      if (!out.some((a) => a.feedId === s.value.feedId)) out.push(s.value);
    }
    return out;
  }

  /** Pyth's fee for a Hermes update, sent as the transaction's value (0 for the empty update). */
  private async updateFee(update: Hex[]): Promise<bigint> {
    if (update.length === 0) return 0n;
    this.pythAddress ??= (await this.client.readContract({
      address: this.cfg.executor,
      abi: executorAbi,
      functionName: "pyth",
    })) as Address;
    return (await this.client.readContract({
      address: this.pythAddress,
      abi: pythFeeAbi,
      functionName: "getUpdateFee",
      args: [update],
    })) as bigint;
  }

  private logLowBalance(head: Head, balance: bigint): void {
    const now = Date.now();
    if (now - this.lastLowBalanceLog < LOW_BALANCE_LOG_MS) return;
    this.lastLowBalanceLog = now;
    this.logger.error("keeper.low_balance", {
      block: head.number,
      balance,
      minBalanceForExitWei: this.cfg.minBalanceForExitWei,
      action: "reprices paused, exits continue; fund the keeper",
    });
  }

  /** Warns when a borrower is at or under the trigger but the Executor reports something other than Ready (M5). */
  private warnStuck(head: Head, observations: Observation[]): void {
    for (const o of observations) {
      if (!isStuck(o)) {
        this.stuckWarned.delete(o.borrower);
        continue;
      }
      const last = this.stuckWarned.get(o.borrower);
      if (last && last.status === o.status && head.number - last.at < STUCK_WARN_EVERY_N_BLOCKS) continue;
      this.stuckWarned.set(o.borrower, { status: o.status, at: head.number });
      this.logger.warn("position.at_trigger_not_ready", {
        block: head.number,
        borrower: o.borrower,
        status: o.status,
        hf: formatHf(o.healthFactor),
        trigger: o.trigger / 1e4,
      });
    }
  }

  private hermesDue(head: Head, borrower: Address): boolean {
    const last = this.hermesTried.get(borrower);
    return last === undefined || head.number - last >= HERMES_RETRY_EVERY_N_BLOCKS;
  }

  private skip(head: Head, borrower: Address, reason: string): void {
    this.repriceSkip.set(borrower, head.number + REPRICE_SKIP_BLOCKS);
    this.logger.warn("reprice.borrower_skipped", { block: head.number, borrower, reason, untilBlock: head.number + REPRICE_SKIP_BLOCKS });
  }

  private skipped(head: Head, borrower: Address): boolean {
    const until = this.repriceSkip.get(borrower);
    return until !== undefined && head.number < until;
  }

  /** Drops cache entries that are stale or belong to borrowers no longer active. */
  private prune(head: Head, observations: Observation[]): void {
    const active = new Set(observations.map((o) => o.borrower));
    for (const [k, v] of this.accessLists) if (head.number - v.at >= ACCESS_LIST_REFRESH_BLOCKS) this.accessLists.delete(k);
    for (const [k, v] of this.gasLimits) if (head.number - v.at >= REMEASURE_EVERY_N_BLOCKS) this.gasLimits.delete(k);
    for (const [b, until] of this.repriceSkip) if (head.number >= until) this.repriceSkip.delete(b);
    for (const [key, until] of this.sweepSkip) if (head.number >= until) this.sweepSkip.delete(key);
    for (const m of [this.stuckWarned, this.hermesTried, this.recordSlots, this.forwarderOf] as Map<Address, unknown>[]) {
      for (const b of m.keys()) if (!active.has(b)) m.delete(b);
    }
  }
}

function sweepKey(t: Pick<SweepTarget, "kind" | "borrower">): string {
  return t.kind === "premium" ? t.borrower! : "vault";
}

export function formatHf(hf: bigint): number | "inf" {
  if (hf > 10n ** 30n) return "inf";
  return Number(hf / 10n ** 14n) / 1e4;
}
