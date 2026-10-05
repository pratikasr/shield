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
  /**
   * Watchdog: when the subscription delivers no head for this long, poll over HTTP until it does again and
   * reconnect the WebSocket (default 2,000 ms, about six Monad blocks).
   */
  staleHeadMs?: number;
  /** When set, the WebSocket's eth_chainId must match before subscribing; otherwise the keeper polls over HTTP. */
  expectedChainId?: number;
}

type Mode = "monadNewHeads" | "newHeads" | "poll";

const SUBSCRIBE_ID = 1;
const CHAIN_ID_ID = 2;

/**
 * Emits `head` once per new block number, as early as the node reports it: monadNewHeads with commitState
 * Proposed when available, otherwise standard newHeads, otherwise HTTP polling of `latest`.
 * Reconnects with backoff and falls back to polling after repeated WebSocket failures. A watchdog bridges to
 * polling and reconnects when a subscription goes quiet without closing.
 */
export class HeadWatcher extends EventEmitter {
  private mode: Mode;
  private ws?: WebSocket;
  private pollTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;
  private stopped = false;
  private failures = 0;
  private lastNumber = -1n;
  private lastHeadAt = 0;
  /** Polling while the WebSocket is reconnected after going quiet. */
  private bridging = false;
  /** The WebSocket served another chain; it is not used again. */
  private wsDisabled = false;
  /** Subscriptions lost after they were established (closed or quiet). */
  drops = 0;

  constructor(private readonly opts: HeadWatcherOptions) {
    super();
    this.mode = opts.wsUrl ? "monadNewHeads" : "poll";
  }

  get currentMode(): Mode {
    return this.mode;
  }

  start(): void {
    this.stopped = false;
    this.lastHeadAt = Date.now();
    if (this.mode === "poll") this.startPolling();
    else this.connect();
    const stale = this.opts.staleHeadMs ?? 2_000;
    this.watchdog = setInterval(() => this.checkStale(stale), Math.max(25, Math.min(250, Math.floor(stale / 4))));
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = undefined;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
  }

  private publish(head: Omit<Head, "receivedAt">): void {
    // The watchdog measures the subscription's silence, so only subscription heads (duplicates included) count.
    if (head.source !== "poll") this.lastHeadAt = Date.now();
    if (head.number <= this.lastNumber) return;
    this.lastNumber = head.number;
    this.emit("head", { ...head, receivedAt: Date.now() } satisfies Head);
  }

  private lastReconnectAt = 0;

  private checkStale(staleMs: number): void {
    if (this.stopped || this.mode === "poll") return;
    const now = Date.now();
    const silentMs = now - this.lastHeadAt;
    if (silentMs < staleMs) return;
    if (this.bridging) {
      // Still quiet after a reconnect: keep polling and try the WebSocket again now and then.
      if (now - this.lastReconnectAt >= (this.opts.wsRetryMs ?? 30_000)) this.reconnect();
      return;
    }
    this.drops += 1;
    this.bridging = true;
    this.opts.logger.warn("heads.stalled", { subscription: this.mode, silentMs, drops: this.drops });
    this.startPolling();
    this.reconnect();
  }

  /** Replaces the current socket; the polling bridge keeps heads coming meanwhile. */
  private reconnect(): void {
    this.lastReconnectAt = Date.now();
    const old = this.ws;
    this.ws = undefined;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      old.onerror = null;
      try {
        old.close();
      } catch {
        // already closed
      }
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.connect();
  }

  private endBridge(): void {
    if (!this.bridging) return;
    this.bridging = false;
    this.opts.logger.info("heads.resumed", { subscription: this.mode, drops: this.drops });
  }

  private connect(): void {
    if (this.stopped || !this.opts.wsUrl || this.wsDisabled) return;
    const Impl = this.opts.webSocketImpl ?? globalThis.WebSocket;
    const subscription = this.mode === "newHeads" ? "newHeads" : "monadNewHeads";
    const ws = new Impl(this.opts.wsUrl);
    this.ws = ws;
    let subscribed = false;
    const subscribe = () =>
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: SUBSCRIBE_ID, method: "eth_subscribe", params: [subscription] }));

    ws.onopen = () => {
      if (this.opts.expectedChainId === undefined) subscribe();
      else ws.send(JSON.stringify({ jsonrpc: "2.0", id: CHAIN_ID_ID, method: "eth_chainId", params: [] }));
    };
    ws.onmessage = (msg: MessageEvent) => {
      if (this.ws !== ws) return;
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
      if (data.id === CHAIN_ID_ID) {
        const got = typeof data.result === "string" ? Number(BigInt(data.result)) : undefined;
        if (got !== this.opts.expectedChainId) {
          this.opts.logger.error("heads.ws_wrong_chain", { expected: this.opts.expectedChainId, got: got ?? data.error?.message });
          this.wsDisabled = true;
          this.ws = undefined;
          ws.onclose = null;
          ws.close();
          this.mode = "poll";
          this.bridging = false;
          this.startPolling();
          return;
        }
        subscribe();
        return;
      }
      if (data.id === SUBSCRIBE_ID) {
        if (data.error) {
          this.opts.logger.warn("heads.subscribe_rejected", { subscription, error: data.error.message });
          ws.close();
          this.onSubscriptionUnsupported();
          return;
        }
        subscribed = true;
        this.failures = 0;
        this.lastHeadAt = Date.now();
        this.opts.logger.info("heads.subscribed", { subscription, drops: this.drops });
        return;
      }
      const r = data.params?.result;
      if (!r?.number) return;
      if (subscription === "monadNewHeads" && r.commitState && r.commitState !== "Proposed") return;
      this.endBridge();
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
      if (subscribed) {
        this.drops += 1;
        this.opts.logger.warn("heads.dropped", { subscription, drops: this.drops });
      } else {
        this.failures += 1;
      }
      const max = this.opts.maxWsFailures ?? 3;
      if (this.failures >= max) {
        this.opts.logger.warn("heads.fallback_to_poll", { failures: this.failures });
        this.mode = "poll";
        this.bridging = false;
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
      this.bridging = false;
      this.startPolling();
    }
  }

  private scheduleWsRetry(subscription: "monadNewHeads" | "newHeads"): void {
    if (!this.opts.wsUrl || this.wsDisabled) return;
    this.retryTimer = setTimeout(() => {
      if (this.stopped || this.mode !== "poll") return;
      this.failures = 0;
      this.mode = subscription;
      this.lastHeadAt = Date.now();
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
      this.connect();
    }, this.opts.wsRetryMs ?? 30_000);
  }

  private polling(): boolean {
    return this.mode === "poll" || this.bridging;
  }

  private startPolling(): void {
    if (this.stopped || this.pollTimer) return;
    const tick = async () => {
      if (this.stopped || !this.polling()) {
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
