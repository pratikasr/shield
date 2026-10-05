import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadWatcher, type Head } from "../src/heads.js";
import { createLogger } from "../src/log.js";

/** Minimal stand-in for the global WebSocket that a test can drive. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static behaviour: "accept" | "reject-monad" | "fail" = "accept";
  static chainId = "0x8f";
  onopen?: () => void;
  onmessage?: (m: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
    setTimeout(() => {
      if (FakeSocket.behaviour === "fail") {
        this.onerror?.();
        this.close();
        return;
      }
      this.onopen?.();
    }, 0);
  }

  send(data: string): void {
    this.sent.push(data);
    const req = JSON.parse(data) as { id: number; method: string; params: string[] };
    setTimeout(() => {
      if (req.method === "eth_chainId") {
        this.onmessage?.({ data: JSON.stringify({ id: req.id, result: FakeSocket.chainId }) });
        return;
      }
      if (FakeSocket.behaviour === "reject-monad" && req.params[0] === "monadNewHeads") {
        this.onmessage?.({ data: JSON.stringify({ id: req.id, error: { code: -32602, message: "invalid params" } }) });
        return;
      }
      this.onmessage?.({ data: JSON.stringify({ id: req.id, result: "0xsub" }) });
    }, 0);
  }

  push(number: number, commitState?: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        method: "eth_subscription",
        params: { subscription: "0xsub", result: { number: `0x${number.toString(16)}`, hash: "0xabc", commitState } },
      }),
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

const silent = createLogger("error", () => {});

function watcher(overrides: Partial<ConstructorParameters<typeof HeadWatcher>[0]> = {}) {
  const heads: Head[] = [];
  const w = new HeadWatcher({
    wsUrl: "ws://test",
    pollBlockNumber: async () => 1n,
    pollIntervalMs: 10,
    logger: silent,
    webSocketImpl: FakeSocket as unknown as typeof WebSocket,
    maxWsFailures: 2,
    wsRetryMs: 60_000,
    ...overrides,
  });
  w.on("head", (h: Head) => heads.push(h));
  return { w, heads };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  FakeSocket.instances = [];
  FakeSocket.behaviour = "accept";
  FakeSocket.chainId = "0x8f";
  vi.useRealTimers();
});

describe("HeadWatcher", () => {
  it("subscribes to monadNewHeads and emits only Proposed blocks, once each", async () => {
    const { w, heads } = watcher();
    w.start();
    await tick();
    const ws = FakeSocket.instances[0]!;
    expect(JSON.parse(ws.sent[0]!).params).toEqual(["monadNewHeads"]);
    ws.push(100, "Proposed");
    ws.push(99, "Voted");
    ws.push(100, "Voted");
    ws.push(101, "Proposed");
    ws.push(101, "Proposed");
    expect(heads.map((h) => h.number)).toEqual([100n, 101n]);
    expect(heads[0]!.source).toBe("monadNewHeads");
    expect(heads[0]!.commitState).toBe("Proposed");
    w.stop();
  });

  it("falls back to newHeads when monadNewHeads is rejected", async () => {
    FakeSocket.behaviour = "reject-monad";
    const { w, heads } = watcher();
    w.start();
    await tick(20);
    expect(w.currentMode).toBe("newHeads");
    const ws = FakeSocket.instances.at(-1)!;
    expect(JSON.parse(ws.sent[0]!).params).toEqual(["newHeads"]);
    ws.push(7);
    expect(heads.map((h) => h.number)).toEqual([7n]);
    w.stop();
  });

  it("reconnects after a dropped socket and keeps the block sequence", async () => {
    const { w, heads } = watcher();
    w.start();
    await tick();
    FakeSocket.instances[0]!.push(10, "Proposed");
    FakeSocket.instances[0]!.close();
    await tick(400);
    const second = FakeSocket.instances.at(-1)!;
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
    second.push(10, "Proposed"); // replay after reconnect is ignored
    second.push(11, "Proposed");
    expect(heads.map((h) => h.number)).toEqual([10n, 11n]);
    w.stop();
  });

  it("falls back to HTTP polling after repeated WebSocket failures, and survives poll errors", async () => {
    FakeSocket.behaviour = "fail";
    let n = 50n;
    let calls = 0;
    const { w, heads } = watcher({
      pollBlockNumber: async () => {
        calls += 1;
        if (calls === 2) throw new Error("rpc down");
        n += 1n;
        return n;
      },
    });
    w.start();
    await tick(1_200);
    expect(w.currentMode).toBe("poll");
    expect(heads.length).toBeGreaterThan(2);
    expect(heads.every((h) => h.source === "poll")).toBe(true);
    const numbers = heads.map((h) => h.number);
    expect([...numbers].sort((a, b) => Number(a - b))).toEqual(numbers);
    w.stop();
  });

  it("polls directly when no WebSocket URL is configured", async () => {
    const { w, heads } = watcher({ wsUrl: undefined, pollBlockNumber: async () => 5n });
    w.start();
    await tick(40);
    expect(w.currentMode).toBe("poll");
    expect(heads.map((h) => h.number)).toEqual([5n]);
    w.stop();
  });

  it("bridges to polling and reconnects when the subscription goes quiet (audit M13)", async () => {
    let n = 1_000n;
    const lines: string[] = [];
    const { w, heads } = watcher({
      staleHeadMs: 150,
      pollBlockNumber: async () => (n += 1n),
      logger: createLogger("debug", (l) => lines.push(l)),
    });
    w.start();
    await tick(20);
    FakeSocket.instances[0]!.push(100, "Proposed");
    await tick(400); // the socket stays open but sends nothing
    expect(w.drops).toBe(1);
    expect(heads.length).toBeGreaterThan(1);
    expect(heads.slice(1).every((h) => h.source === "poll")).toBe(true);
    expect(FakeSocket.instances.length).toBe(2); // a fresh socket replaced the quiet one
    expect(lines.map((l) => JSON.parse(l).event)).toContain("heads.stalled");
    // The new subscription delivers again: polling stops.
    FakeSocket.instances[1]!.push(Number(n) + 5, "Proposed");
    const polledBefore = n;
    await tick(100);
    expect(n - polledBefore).toBeLessThanOrEqual(1n);
    expect(heads.at(-1)!.source).toBe("monadNewHeads");
    expect(lines.map((l) => JSON.parse(l).event)).toContain("heads.resumed");
    w.stop();
  });

  it("counts a subscription that closes after it was established as a drop", async () => {
    const { w } = watcher();
    w.start();
    await tick(20);
    FakeSocket.instances[0]!.close();
    expect(w.drops).toBe(1);
    w.stop();
  });

  it("checks the WebSocket's chain id before subscribing and polls instead on a mismatch", async () => {
    FakeSocket.chainId = "0x1";
    const lines: string[] = [];
    const { w, heads } = watcher({
      expectedChainId: 143,
      pollBlockNumber: async () => 9n,
      logger: createLogger("debug", (l) => lines.push(l)),
    });
    w.start();
    await tick(40);
    const ws = FakeSocket.instances[0]!;
    expect(ws.sent.map((d) => JSON.parse(d).method)).toEqual(["eth_chainId"]); // never subscribed
    expect(w.currentMode).toBe("poll");
    expect(heads.map((h) => h.number)).toEqual([9n]);
    expect(lines.map((l) => JSON.parse(l)).find((l) => l.event === "heads.ws_wrong_chain")?.level).toBe("error");
    w.stop();
  });

  it("subscribes after the chain id matches", async () => {
    const { w, heads } = watcher({ expectedChainId: 143 });
    w.start();
    await tick(20);
    const ws = FakeSocket.instances[0]!;
    expect(ws.sent.map((d) => JSON.parse(d).method)).toEqual(["eth_chainId", "eth_subscribe"]);
    ws.push(5, "Proposed");
    expect(heads.map((h) => h.number)).toEqual([5n]);
    w.stop();
  });
});
