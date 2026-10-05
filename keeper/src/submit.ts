import {
  BaseError,
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
   * (the Repricer's premium transfer to the vault when the pending amount crosses one USDC unit).
   */
  headroom?: bigint;
  to: Address;
  data: Hex;
  value?: bigint;
  accessList?: AccessList;
  /** Upper bound for the measured gas limit. */
  maxGas: bigint;
}

export interface TxResult {
  hash: Hex;
  receipt: TransactionReceipt;
  gasLimit: bigint;
  mode: "sync" | "async";
  latencyMs: number;
}

export class GasCeilingError extends Error {
  constructor(
    readonly estimate: bigint,
    readonly ceiling: bigint,
  ) {
    super(`measured gas ${estimate} exceeds ceiling ${ceiling}`);
  }
}

/** Gas limit = estimate x (1 + buffer). Monad charges gas_limit x price, so the buffer stays small. */
export function withBuffer(estimate: bigint, bufferBps: number): bigint {
  return (estimate * BigInt(10_000 + bufferBps) + 9_999n) / 10_000n;
}

function rpcCode(err: unknown): number | undefined {
  let e: unknown = err;
  for (let i = 0; i < 6 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "number") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

function messageOf(err: unknown): string {
  if (err instanceof BaseError) return `${err.shortMessage} ${err.details ?? ""}`.toLowerCase();
  return String((err as Error)?.message ?? err).toLowerCase();
}

/** The RPC does not offer eth_sendRawTransactionSync. */
export function isSyncUnsupported(err: unknown): boolean {
  const code = rpcCode(err);
  const msg = messageOf(err);
  return code === -32601 || msg.includes("method not found") || msg.includes("does not exist") || msg.includes("not supported");
}

function isNonceError(err: unknown): boolean {
  const msg = messageOf(err);
  return msg.includes("nonce too low") || msg.includes("nonce too high") || msg.includes("invalid nonce");
}

/** The node accepted the request but gave up waiting for inclusion; the tx may still land. */
function isSyncTimeout(err: unknown): boolean {
  const code = rpcCode(err);
  const msg = messageOf(err);
  return code === 4 || msg.includes("timeout") || msg.includes("timed out");
}

/**
 * Signs and sends keeper transactions. Every transaction gets a measured gas limit, the access list it is
 * given, and goes out through eth_sendRawTransactionSync, which returns the receipt from the proposed block.
 * When the RPC lacks that method it falls back to eth_sendRawTransaction and polls for the receipt.
 */
export class Submitter {
  private nonce?: number;
  syncSupported = true;
  /** Extra gas buffer per label after an out-of-gas revert ("gas limit too low" recovery). */
  readonly extraBufferBps = new Map<string, number>();
  /** Successes since the last out-of-gas revert, per label; the extra buffer is dropped after 50. */
  private readonly cleanRuns = new Map<string, number>();

  constructor(
    private readonly client: PublicClient,
    private readonly account: LocalAccount,
    private readonly chain: Chain,
    private readonly logger: Logger,
    private readonly opts: { gasBufferBps: number; syncTimeoutMs: number },
  ) {}

  get address(): Address {
    return this.account.address;
  }

  async resyncNonce(): Promise<number> {
    this.nonce = await this.client.getTransactionCount({ address: this.account.address, blockTag: "pending" });
    return this.nonce;
  }

  /** Estimates on proposed state with the access list attached and applies the buffer and ceiling. */
  async measureGas(tx: TxRequest): Promise<bigint> {
    const estimate = await this.client.estimateGas({
      account: this.account.address,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      accessList: tx.accessList,
      blockTag: "latest",
    });
    const limit =
      withBuffer(estimate, this.opts.gasBufferBps + (this.extraBufferBps.get(tx.label) ?? 0)) + (tx.headroom ?? 0n);
    if (limit > tx.maxGas) throw new GasCeilingError(limit, tx.maxGas);
    return limit;
  }

  async send(tx: TxRequest, gasOverride?: bigint): Promise<TxResult> {
    const gas = gasOverride ?? (await this.measureGas(tx));
    if (this.nonce === undefined) await this.resyncNonce();
    const fees = await this.client.estimateFeesPerGas({ chain: this.chain });
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
    const started = Date.now();
    try {
      const result = await this.broadcast(serialized);
      this.nonce = nonce + 1;
      const latencyMs = Date.now() - started;
      if (result.receipt.status === "reverted" && result.receipt.gasUsed * 100n >= gas * 99n) {
        const next = Math.min(Math.max((this.extraBufferBps.get(tx.label) ?? 0) * 2, 2_000), 10_000);
        this.extraBufferBps.set(tx.label, next);
        this.logger.warn("tx.out_of_gas", { label: tx.label, gasLimit: gas, gasUsed: result.receipt.gasUsed, nextExtraBufferBps: next });
        this.cleanRuns.set(tx.label, 0);
      } else if (result.receipt.status === "success" && this.extraBufferBps.has(tx.label)) {
        const runs = (this.cleanRuns.get(tx.label) ?? 0) + 1;
        this.cleanRuns.set(tx.label, runs);
        if (runs >= 50) {
          this.extraBufferBps.delete(tx.label);
          this.cleanRuns.delete(tx.label);
        }
      }
      this.logger.info("tx.included", {
        label: tx.label,
        hash: result.receipt.transactionHash,
        block: result.receipt.blockNumber,
        status: result.receipt.status,
        gasUsed: result.receipt.gasUsed,
        gasLimit: gas,
        mode: result.mode,
        latencyMs,
      });
      return { hash: result.receipt.transactionHash, receipt: result.receipt, gasLimit: gas, mode: result.mode, latencyMs };
    } catch (err) {
      if (isNonceError(err)) {
        this.logger.warn("tx.nonce_resync", { label: tx.label, error: messageOf(err) });
        await this.resyncNonce();
      }
      throw err;
    }
  }

  private async broadcast(serialized: Hex): Promise<{ receipt: TransactionReceipt; mode: "sync" | "async" }> {
    if (this.syncSupported) {
      try {
        const receipt = await sendRawTransactionSync(this.client, {
          serializedTransaction: serialized,
          timeout: this.opts.syncTimeoutMs,
          throwOnReceiptRevert: false,
        });
        return { receipt, mode: "sync" };
      } catch (err) {
        if (isSyncUnsupported(err)) {
          this.syncSupported = false;
          this.logger.warn("tx.sync_unsupported_fallback", { error: messageOf(err) });
        } else if (isSyncTimeout(err)) {
          this.logger.warn("tx.sync_timeout_wait_receipt", { error: messageOf(err) });
          const { keccak256 } = await import("viem");
          const receipt = await this.client.waitForTransactionReceipt({ hash: keccak256(serialized), pollingInterval: 100 });
          return { receipt, mode: "async" };
        } else {
          throw err;
        }
      }
    }
    const hash = await this.client.sendRawTransaction({ serializedTransaction: serialized });
    const receipt = await this.client.waitForTransactionReceipt({ hash, pollingInterval: 100 });
    return { receipt, mode: "async" };
  }
}
