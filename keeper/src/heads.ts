import { EventEmitter } from "node:events";
import type { Logger } from "./log.js";

/** A block the keeper should act on. On Monad `latest` is the Proposed block. */
export interface Head {
  number: bigint;
  hash?: string;
  /** Proposed, Voted, Finalized or Verified when it came from monadNewHeads. */
  commitState?: string;
  source: "monadNewHeads" | "newHeads" | "poll";
  receivedAt: number;
}

export interface HeadWatcherOptions {
  wsUrl?: string;
  /** Returns the latest block number over HTTP; used when no subscription works. */
  pollBlockNumber: () => Promise<bigint>;
  pollIntervalMs: number;
  logger: Logger;
  /** WebSocket constructor; defaults to the global one (Node 22+). Tests inject a fake. */
  webSocketImpl?: typeof WebSocket;
  /** Consecutive WebSocket failures before switching to polling. */
  maxWsFailures?: number;
  /** While polling, how often to try the WebSocket again. */
  wsRetryMs?: number;
}

type Mode = "monadNewHeads" | "newHeads" | "poll";

/**
 * Emits `head` once per new block number, as early as the node reports it: monadNewHeads with commitState
 * Proposed when available, otherwise standard newHeads, otherwise HTTP polling of `latest`.
 * Reconnects with backoff and falls back to polling after repeated WebSocket failures.
 */
export class HeadWatcher extends EventEmitter {
  private mode: Mode;
  private ws?: WebSocket;
  private pollTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private stopped = false;
  private failures = 0;
  private lastNumber = -1n;

  constructor(private readonly opts: HeadWatcherOptions) {
    super();
    this.mode = opts.wsUrl ? "monadNewHeads" : "poll";
  }

  get currentMode(): Mode {
    return this.mode;
  }

  start(): void {
    this.stopped = false;
    if (this.mode === "poll") this.startPolling();
    else this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = undefined;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private publish(head: Omit<Head, "receivedAt">): void {
    if (head.number <= this.lastNumber) return;
    this.lastNumber = head.number;
    this.emit("head", { ...head, receivedAt: Date.now() } satisfies Head);
  }

  private connect(): void {
    if (this.stopped || !this.opts.wsUrl) return;
    const Impl = this.opts.webSocketImpl ?? globalThis.WebSocket;
    const subscription = this.mode === "newHeads" ? "newHeads" : "monadNewHeads";
    const ws = new Impl(this.opts.wsUrl);
    this.ws = ws;
    let subscribed = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: [subscription] }));
    };
    ws.onmessage = (msg: MessageEvent) => {
      let data: {
        id?: number;
        error?: { code: number; message: string };
        result?: unknown;
        params?: { result?: { number?: string; hash?: string; blockId?: string; commitState?: string } };
      };
      try {
        data = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (data.id === 1) {
        if (data.error) {
          this.opts.logger.warn("heads.subscribe_rejected", { subscription, error: data.error.message });
          ws.close();
          this.onSubscriptionUnsupported();
          return;
        }
        subscribed = true;
        this.failures = 0;
        this.opts.logger.info("heads.subscribed", { subscription });
        return;
      }
      const r = data.params?.result;
      if (!r?.number) return;
      if (subscription === "monadNewHeads" && r.commitState && r.commitState !== "Proposed") return;
      this.publish({
        number: BigInt(r.number),
        hash: r.hash ?? r.blockId,
        commitState: r.commitState,
        source: subscription,
      });
    };
    ws.onerror = () => {
      this.opts.logger.warn("heads.ws_error", { subscription });
    };
    ws.onclose = () => {
      if (this.stopped || this.ws !== ws) return;
      this.ws = undefined;
      if (!subscribed) this.failures += 1;
      const max = this.opts.maxWsFailures ?? 3;
      if (this.failures >= max) {
        this.opts.logger.warn("heads.fallback_to_poll", { failures: this.failures });
        this.mode = "poll";
        this.startPolling();
        this.scheduleWsRetry(subscription);
        return;
      }
      const delay = Math.min(250 * 2 ** this.failures, 5_000);
      this.opts.logger.info("heads.reconnect", { delayMs: delay });
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private onSubscriptionUnsupported(): void {
    if (this.mode === "monadNewHeads") {
      this.mode = "newHeads";
      this.connect();
    } else {
      this.mode = "poll";
      this.startPolling();
    }
  }

  private scheduleWsRetry(subscription: "monadNewHeads" | "newHeads"): void {
    if (!this.opts.wsUrl) return;
    this.retryTimer = setTimeout(() => {
      if (this.stopped || this.mode !== "poll") return;
      this.failures = 0;
      this.mode = subscription;
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
      this.connect();
    }, this.opts.wsRetryMs ?? 30_000);
  }

  private startPolling(): void {
    if (this.stopped || this.pollTimer) return;
    const tick = async () => {
      if (this.stopped || this.mode !== "poll") {
        this.pollTimer = undefined;
        return;
      }
      try {
        const n = await this.opts.pollBlockNumber();
        this.publish({ number: n, source: "poll" });
      } catch (err) {
        this.opts.logger.warn("heads.poll_failed", { error: err });
      }
      this.pollTimer = setTimeout(tick, this.opts.pollIntervalMs);
    };
    this.pollTimer = setTimeout(tick, 0);
  }
}
