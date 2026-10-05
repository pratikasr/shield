import {
  BaseError,
  keccak256,
  type AccessList,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { sendRawTransactionSync } from "viem/actions";
import type { Logger } from "./log.js";

export interface TxRequest {
  /** Short name for logs, e.g. "exit" or "repriceMany". */
  label: string;
  /**
   * Gas added on top of the buffered estimate for work the next block may add that the estimate did not see
   * (a new Pyth observation in the Repricer's volatility window).
   */
  headroom?: bigint;
  to: Address;
  data: Hex;
  value?: bigint;
  accessList?: AccessList;
  /** Upper bound for the measured gas limit. */
  maxGas: bigint;
  /** When set, the send is skipped while maxFeePerGas is above it (used for reprices, never for exits). */
  maxFeePerGasCap?: bigint;
}

export interface TxResult {
  hash: Hex;
  receipt: TransactionReceipt;
  gasLimit: bigint;
  mode: "sync" | "async";
  latencyMs: number;
  /** A reverted receipt whose replay ran out of gas at the same limit. */
  outOfGas: boolean;
}

export class GasCeilingError extends Error {
  constructor(
    /** The buffered limit, without any extra buffer from earlier out-of-gas reverts. */
    readonly estimate: bigint,
    readonly ceiling: bigint,
    /** The node's raw estimate. */
    readonly raw: bigint = estimate,
  ) {
    super(`measured gas ${estimate} exceeds ceiling ${ceiling}`);
    this.name = "GasCeilingError";
  }
}

export class FeeCapError extends Error {
  constructor(
    readonly maxFeePerGas: bigint,
    readonly cap: bigint,
  ) {
    super(`maxFeePerGas ${maxFeePerGas} is above the cap ${cap}`);
    this.name = "FeeCapError";
  }
}

/** A transaction from this keeper may still land; nothing else is sent until it resolves (audit M1, M2). */
export class TxInFlightError extends Error {
  constructor(
    readonly hash: Hex,
    readonly label: string,
  ) {
    super(`transaction ${hash} (${label}) may still be pending`);
    this.name = "TxInFlightError";
  }
}

export class InsufficientFundsError extends Error {
  constructor(readonly label: string) {
    super(`keeper balance too low to send ${label}`);
    this.name = "InsufficientFundsError";
  }
}

/** The tx was accepted (it has no receipt yet); the caller records it as pending. */
class AcceptedWithoutReceipt extends Error {
  constructor(readonly mode: "sync" | "async") {
    super("accepted without a receipt");
  }
}

/** Gas limit = estimate x (1 + buffer). Monad charges gas_limit x price, so the buffer stays small. */
export function withBuffer(estimate: bigint, bufferBps: number): bigint {
  return (estimate * BigInt(10_000 + bufferBps) + 9_999n) / 10_000n;
}

function errorChain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let e: unknown = err;
  for (let i = 0; i < 8 && e; i++) {
    out.push(e);
    e = (e as { cause?: unknown }).cause;
  }
  return out;
}

/** Every numeric JSON-RPC code in the error and its causes (viem wraps unknown errors as code -1). */
export function rpcCodes(err: unknown): number[] {
  return errorChain(err)
    .map((e) => (e as { code?: unknown })?.code)
    .filter((c): c is number => typeof c === "number");
}

/** Short messages and details only: viem's full message repeats the request URL, which may hold an API key. */
export function messageOf(err: unknown): string {
  return errorChain(err)
    .map((e) => (e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ""}` : String((e as Error)?.message ?? e)))
    .join(" ")
    .toLowerCase();
}

/** The RPC does not offer eth_sendRawTransactionSync. */
export function isSyncUnsupported(err: unknown): boolean {
  const msg = messageOf(err);
  return (
    rpcCodes(err).includes(-32601) ||
    msg.includes("method not found") ||
    (msg.includes("method") && (msg.includes("does not exist") || msg.includes("not supported")))
  );
}

/** EIP-7966: the node accepted the tx but gave up waiting for its receipt (error code 4); it may still land. */
export function isNodeSyncTimeout(err: unknown): boolean {
  return rpcCodes(err).includes(4);
}

export function isNonceError(err: unknown): boolean {
  const msg = messageOf(err);
  return msg.includes("nonce too low") || msg.includes("nonce too high") || msg.includes("invalid nonce");
}

export function isAlreadyKnown(err: unknown): boolean {
  const msg = messageOf(err);
  return msg.includes("already known") || msg.includes("known transaction") || msg.includes("already imported");
}

export function isUnderpriced(err: unknown): boolean {
  const msg = messageOf(err);
  return msg.includes("underpriced") || msg.includes("fee too low") || msg.includes("less than block base fee");
}

export function isInsufficientFunds(err: unknown): boolean {
  const msg = messageOf(err);
  return msg.includes("insufficient funds") || msg.includes("insufficient balance");
}

export function isOutOfGas(err: unknown): boolean {
  const msg = messageOf(err);
  return /out ?of ?gas|gas required exceeds|outofgas/.test(msg);
}

/** An estimate or call that failed because the transaction reverts, as opposed to a transport failure. */
export function isRevert(err: unknown): boolean {
  if (rpcCodes(err).includes(3)) return true;
  if (errorChain(err).some((e) => (e as Error)?.name === "ExecutionRevertedError" || (e as Error)?.name === "ContractFunctionRevertedError")) {
    return true;
  }
  return messageOf(err).includes("revert");
}

/** A JSON-RPC error that means the node refused the tx outright, so its nonce is still free. */
function isDefiniteRejection(err: unknown): boolean {
  const ambiguous = new Set([-1, 4, 429, -32603, -32005]);
  return rpcCodes(err).some((c) => !ambiguous.has(c));
}

export interface SubmitterOptions {
  gasBufferBps: number;
  syncTimeoutMs: number;
  /** How long to poll for a receipt after a sync timeout or an async send, before moving on (default 4 s). */
  receiptWaitMs?: number;
  /** How long fee data is reused (default 1.5 s, about five blocks). */
  feeCacheMs?: number;
  /** How long an ambiguous send whose hash the node does not know is still treated as pending (default 1.5 s). */
  ambiguousGraceMs?: number;
  /** After this long a known but unmined tx stops blocking new sends (default 60 s). */
  stuckAfterMs?: number;
  /** Client for broadcasts: the configured RPC only, no read fallbacks. Defaults to the read client. */
  sendClient?: PublicClient;
}

interface PendingTx {
  hash: Hex;
  nonce: number;
  label: string;
  to: Address;
  gasLimit: bigint;
  since: number;
  known: boolean;
}

/**
 * Signs and sends keeper transactions. Every transaction gets a measured gas limit, the access list it is
 * given, and goes out through eth_sendRawTransactionSync, which returns the receipt from the proposed block.
 * When the RPC lacks that method it falls back to eth_sendRawTransaction and polls for the receipt.
 *
 * A send that may have reached the node without a clear answer (sync timeout, dropped connection, proxy error)
 * leaves its hash as `pending`. Until that hash is mined or confirmed gone, every send throws TxInFlightError,
 * so the next transaction never reuses its nonce.
 */
export class Submitter {
  private nonce?: number;
  syncSupported = true;
  pending?: PendingTx;
  /** Extra gas buffer per label after an out-of-gas revert ("gas limit too low" recovery). */
  readonly extraBufferBps = new Map<string, number>();
  /** Successes since the last out-of-gas revert, per label; the extra buffer is dropped after 50. */
  private readonly cleanRuns = new Map<string, number>();
  private fees?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; at: number };
  private readonly sendClient: PublicClient;

  constructor(
    private readonly client: PublicClient,
    private readonly account: LocalAccount,
    private readonly chain: Chain,
    private readonly logger: Logger,
    private readonly opts: SubmitterOptions,
  ) {
    this.sendClient = opts.sendClient ?? client;
  }

  get address(): Address {
    return this.account.address;
  }

  async resyncNonce(): Promise<number> {
    this.nonce = await this.client.getTransactionCount({ address: this.account.address, blockTag: "pending" });
    return this.nonce;
  }

  /**
   * Estimates on proposed state with the access list attached, then applies the buffer and the ceiling. The ceiling
   * is checked without the extra buffer that out-of-gas reverts add, and the extra buffer is capped at the
   * ceiling, so a raised buffer never makes the keeper refuse a transaction it would otherwise send.
   */
  async measureGas(tx: TxRequest): Promise<bigint> {
    const estimate = await this.client.estimateGas({
      account: this.account.address,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      accessList: tx.accessList,
      blockTag: "latest",
    });
    const headroom = tx.headroom ?? 0n;
    const base = withBuffer(estimate, this.opts.gasBufferBps) + headroom;
    if (base > tx.maxGas) throw new GasCeilingError(base, tx.maxGas, estimate);
    const extra = this.extraBufferBps.get(tx.label) ?? 0;
    if (extra === 0) return base;
    const raised = withBuffer(estimate, this.opts.gasBufferBps + extra) + headroom;
    return raised > tx.maxGas ? tx.maxGas : raised;
  }

  /** Fee data, reused for a few blocks instead of two extra round trips per send. */
  async feeData(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const ttl = this.opts.feeCacheMs ?? 1_500;
    if (this.fees && Date.now() - this.fees.at < ttl) return this.fees;
    const f = await this.client.estimateFeesPerGas({ chain: this.chain });
    this.fees = { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas, at: Date.now() };
    return this.fees;
  }

  /**
   * Settles the pending transaction, if any: "mined" (nonce moves past it), "inflight" (the node still has it, or
   * it is too early to tell), or "dropped" (gone; the nonce is read again from the chain).
   */
  async resolvePending(): Promise<"none" | "mined" | "inflight" | "dropped"> {
    const p = this.pending;
    if (!p) return "none";
    const receipt = await this.client.getTransactionReceipt({ hash: p.hash }).catch(() => undefined);
    if (receipt) {
      this.pending = undefined;
      this.nonce = Math.max(this.nonce ?? 0, p.nonce + 1);
      this.logger.info("tx.included", {
        label: p.label,
        to: p.to,
        hash: p.hash,
        block: receipt.blockNumber,
        status: receipt.status,
        gasUsed: receipt.gasUsed,
        gasLimit: p.gasLimit,
        latencyMs: Date.now() - p.since,
        late: true,
      });
      return "mined";
    }
    const age = Date.now() - p.since;
    const tx = await this.client.getTransaction({ hash: p.hash }).catch(() => undefined);
    if (tx) {
      p.known = true;
      if (age < (this.opts.stuckAfterMs ?? 60_000)) return "inflight";
      this.logger.error("tx.stuck", { label: p.label, hash: p.hash, nonce: p.nonce, ageMs: age });
    } else if (age < (this.opts.ambiguousGraceMs ?? 1_500)) {
      return "inflight";
    } else {
      this.logger.warn("tx.dropped", { label: p.label, hash: p.hash, nonce: p.nonce });
    }
    this.pending = undefined;
    await this.resyncNonce();
    return "dropped";
  }

  async send(tx: TxRequest, gasOverride?: bigint): Promise<TxResult> {
    if (this.pending && (await this.resolvePending()) === "inflight") {
      throw new TxInFlightError(this.pending!.hash, this.pending!.label);
    }
    const gas = gasOverride ?? (await this.measureGas(tx));
    if (this.nonce === undefined) await this.resyncNonce();
    const fees = await this.feeData();
    if (tx.maxFeePerGasCap !== undefined && fees.maxFeePerGas > tx.maxFeePerGasCap) {
      throw new FeeCapError(fees.maxFeePerGas, tx.maxFeePerGasCap);
    }
    const nonce = this.nonce!;
    const serialized = await this.account.signTransaction({
      chainId: this.chain.id,
      type: "eip1559",
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
      gas,
      nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      accessList: tx.accessList ?? [],
    });
    const hash = keccak256(serialized);
    const started = Date.now();
    let result: { receipt: TransactionReceipt; mode: "sync" | "async" };
    try {
      result = await this.broadcast(serialized, hash);
    } catch (err) {
      throw await this.onSendFailure(err, tx, nonce, hash, gas);
    }
    this.nonce = nonce + 1;
    const latencyMs = Date.now() - started;
    const { receipt } = result;
    let outOfGas = false;
    if (receipt.status === "reverted") {
      // Monad receipts report gasUsed equal to the limit for every transaction, so gasUsed alone cannot tell an
      // out-of-gas revert from any other. Replay the call at the same limit and only count it as out of gas when
      // the replay runs out of gas too.
      const replay = receipt.gasUsed * 100n >= gas * 99n ? await this.replay(tx, gas, receipt.blockNumber) : undefined;
      outOfGas = replay?.outOfGas ?? false;
      if (outOfGas) {
        const next = Math.min(Math.max((this.extraBufferBps.get(tx.label) ?? 0) * 2, 2_000), 10_000);
        this.extraBufferBps.set(tx.label, next);
        this.cleanRuns.set(tx.label, 0);
        this.logger.warn("tx.out_of_gas", { label: tx.label, hash, gasLimit: gas, nextExtraBufferBps: next });
      } else {
        this.logger.warn("tx.reverted", { label: tx.label, hash, gasLimit: gas, reason: replay?.reason });
      }
    } else if (this.extraBufferBps.has(tx.label)) {
      const runs = (this.cleanRuns.get(tx.label) ?? 0) + 1;
      this.cleanRuns.set(tx.label, runs);
      if (runs >= 50) {
        this.extraBufferBps.delete(tx.label);
        this.cleanRuns.delete(tx.label);
      }
    }
    this.logger.info("tx.included", {
      label: tx.label,
      to: tx.to,
      hash: receipt.transactionHash,
      block: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      gasLimit: gas,
      mode: result.mode,
      latencyMs,
    });
    return { hash: receipt.transactionHash, receipt, gasLimit: gas, mode: result.mode, latencyMs, outOfGas };
  }

  /**
   * eth_call of the reverted transaction at its own gas limit, on the state of its block. When the node cannot
   * run a call at that block (no history), it is replayed once on the latest block instead.
   */
  private async replay(tx: TxRequest, gas: bigint, blockNumber: bigint): Promise<{ outOfGas: boolean; reason?: string }> {
    const call = (at: { blockNumber: bigint } | { blockTag: "latest" }) =>
      this.client.call({
        account: this.account.address,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        accessList: tx.accessList,
        gas,
        ...at,
      });
    for (const at of [{ blockNumber }, { blockTag: "latest" as const }]) {
      try {
        await call(at);
        return { outOfGas: false, reason: "replay succeeded (state changed in the block)" };
      } catch (err) {
        if (isOutOfGas(err) || isRevert(err)) return { outOfGas: isOutOfGas(err), reason: messageOf(err).trim().slice(0, 200) };
        if ("blockTag" in at) return { outOfGas: false, reason: `replay failed: ${messageOf(err).trim().slice(0, 160)}` };
      }
    }
    return { outOfGas: false };
  }

  /** Classifies a failed broadcast and returns the error to throw. Never lets the nonce be reused while unsure. */
  private async onSendFailure(err: unknown, tx: TxRequest, nonce: number, hash: Hex, gasLimit: bigint): Promise<Error> {
    const markPending = (known: boolean, why: string) => {
      this.pending = { hash, nonce, label: tx.label, to: tx.to, gasLimit, since: Date.now(), known };
      this.logger.warn("tx.pending", { label: tx.label, hash, nonce, known, why });
      return new TxInFlightError(hash, tx.label);
    };
    if (err instanceof AcceptedWithoutReceipt) return markPending(true, `no receipt yet (${err.mode})`);
    if (isAlreadyKnown(err)) return markPending(true, "already known");
    if (isNonceError(err)) {
      this.logger.warn("tx.nonce_resync", { label: tx.label, error: messageOf(err) });
      await this.resyncNonce().catch(() => (this.nonce = undefined));
      return err as Error;
    }
    if (isUnderpriced(err)) {
      this.fees = undefined;
      this.logger.warn("tx.underpriced", { label: tx.label, error: messageOf(err) });
      await this.resyncNonce().catch(() => (this.nonce = undefined));
      return err as Error;
    }
    if (isInsufficientFunds(err)) {
      await this.resyncNonce().catch(() => (this.nonce = undefined));
      return new InsufficientFundsError(tx.label);
    }
    // Anything else may or may not have reached the node: look the hash up before deciding.
    const known = await this.client
      .getTransaction({ hash })
      .then((t) => !!t)
      .catch(() => false);
    if (known) return markPending(true, messageOf(err).slice(0, 200));
    if (isDefiniteRejection(err)) return err as Error;
    return markPending(false, messageOf(err).slice(0, 200));
  }

  private async broadcast(serialized: Hex, hash: Hex): Promise<{ receipt: TransactionReceipt; mode: "sync" | "async" }> {
    const wait = this.opts.receiptWaitMs ?? 4_000;
    if (this.syncSupported) {
      try {
        const receipt = await sendRawTransactionSync(this.sendClient, {
          serializedTransaction: serialized,
          timeout: this.opts.syncTimeoutMs,
          throwOnReceiptRevert: false,
        });
        return { receipt, mode: "sync" };
      } catch (err) {
        if (isSyncUnsupported(err)) {
          this.syncSupported = false;
          this.logger.warn("tx.sync_unsupported_fallback", { error: messageOf(err) });
        } else if (isNodeSyncTimeout(err)) {
          this.logger.warn("tx.sync_timeout_wait_receipt", { hash, waitMs: wait });
          try {
            const receipt = await this.client.waitForTransactionReceipt({ hash, pollingInterval: 100, timeout: wait });
            return { receipt, mode: "async" };
          } catch {
            throw new AcceptedWithoutReceipt("sync");
          }
        } else {
          throw err;
        }
      }
    }
    await this.sendClient.sendRawTransaction({ serializedTransaction: serialized });
    try {
      const receipt = await this.client.waitForTransactionReceipt({ hash, pollingInterval: 100, timeout: wait });
      return { receipt, mode: "async" };
    } catch {
      throw new AcceptedWithoutReceipt("async");
    }
  }
}
