import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadWatcher, type Head } from "../src/heads.js";
import { createLogger } from "../src/log.js";

/** Minimal stand-in for the global WebSocket that a test can drive. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static behaviour: "accept" | "reject-monad" | "fail" = "accept";
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
    const req = JSON.parse(data) as { id: number; params: string[] };
    setTimeout(() => {
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
});
