import { describe, expect, it, vi } from "vitest";
import {
  AuroraApiError,
  auroraErrorMessage,
  auroraFetch,
  buildQuoteRequest,
  closesAt,
  formatDown,
  formatExact,
  isTerminal,
  monadUsdc,
  parseStatus,
  parseStoredTransfer,
  parseTokens,
  sourceAssets,
  sourceChains,
  statusPath,
  transferFromQuote,
  transferKey,
  transferStage,
  type AuroraTransfer,
  type SourceAsset,
} from "./aurora";

const USDC_MONAD = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const BORROWER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const FORWARDER = "0x4e924FA1617162Fc250152De0eE7a40e0319Db69";

/** Entries copied from GET /tokens on 13 Oct 2026, plus a non-EVM and a malformed one. */
const TOKENS = {
  asset_stats: [],
  tokens: [
    { assetId: "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx", decimals: 6, blockchain: "monad", symbol: "USDC", price: 1, contractAddress: "0x754704bc059f8c67012fed69bc8a327a5aafb603" },
    { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, blockchain: "base", symbol: "USDC", price: 1, contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
    { assetId: "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near", decimals: 6, blockchain: "arb", symbol: "USDT0", price: 1, contractAddress: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9" },
    { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, blockchain: "arb", symbol: "USDC", price: 1, contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
    { assetId: "nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r", decimals: 18, blockchain: "bsc", symbol: "USDC", price: 1, contractAddress: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" },
    { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, blockchain: "sol", symbol: "USDC", price: 1, contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    { assetId: "nep141:eth.omft.near", decimals: 18, blockchain: "eth", symbol: "ETH", price: 2000, contractAddress: null },
    { assetId: 42, blockchain: "eth", symbol: "BAD" },
  ],
};

const base: SourceAsset = {
  chain: "base",
  chainName: "Base",
  symbol: "USDC",
  assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  decimals: 6,
  contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const transfer: AuroraTransfer = {
  v: 1,
  kind: "premium",
  depositAddress: "0x1111111111111111111111111111111111111111",
  chain: "base",
  chainName: "Base",
  symbol: "USDC",
  decimals: 6,
  amountIn: "25000000",
  amountOut: "24990000",
  minAmountOut: "24870000",
  deadline: "2026-10-13T12:00:00.000Z",
  recipient: FORWARDER,
  refundTo: BORROWER,
  createdAt: 0,
};

describe("token list", () => {
  it("reads the current { tokens } shape and a bare array, dropping malformed entries", () => {
    expect(parseTokens(TOKENS)).toHaveLength(7);
    expect(parseTokens(TOKENS.tokens)).toHaveLength(7);
    expect(parseTokens({ message: "nope" })).toEqual([]);
    expect(parseTokens(null)).toEqual([]);
  });

  it("offers stablecoins on EVM chains only, in chain order with USDC first, keeping each token's decimals", () => {
    const assets = sourceAssets(parseTokens(TOKENS));
    expect(assets.map((a) => `${a.chain}:${a.symbol}:${a.decimals}`)).toEqual(["base:USDC:6", "arb:USDC:6", "arb:USDT0:6", "bsc:USDC:18"]);
    expect(assets[0]!.contract).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    const chains = sourceChains(assets);
    expect(chains.map((c) => [c.name, c.assets.length])).toEqual([
      ["Base", 1],
      ["Arbitrum", 2],
      ["BNB Chain", 1],
    ]);
  });

  it("finds USDC on Monad by Shield's USDC contract, whatever its case", () => {
    expect(monadUsdc(parseTokens(TOKENS), USDC_MONAD)?.assetId).toBe("nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx");
    expect(monadUsdc(parseTokens(TOKENS), "0x0000000000000000000000000000000000000001")).toBeUndefined();
  });
});

describe("quote request", () => {
  it("asks for an exact input of the source asset, delivered to the deposit address on Monad, refunded on the source chain", () => {
    const now = Date.parse("2026-10-13T10:00:00.000Z");
    const body = buildQuoteRequest({
      origin: base,
      destinationAssetId: "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx",
      amountUnits: 25_000_000n,
      recipient: FORWARDER.toLowerCase() as `0x${string}`,
      refundTo: BORROWER,
      nowMs: now,
    });
    expect(body).toEqual({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: 50,
      originAsset: base.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx",
      amount: "25000000",
      recipient: FORWARDER,
      recipientType: "DESTINATION_CHAIN",
      refundTo: BORROWER,
      refundType: "ORIGIN_CHAIN",
      deadline: "2026-10-13T11:00:00.000Z",
    });
    expect(buildQuoteRequest({ origin: base, destinationAssetId: "x", amountUnits: 1n, recipient: FORWARDER, refundTo: BORROWER, nowMs: now, dry: true, deadlineMinutes: 5, slippageBps: 10 })).toMatchObject({
      dry: true,
      slippageTolerance: 10,
      deadline: "2026-10-13T10:05:00.000Z",
    });
  });

  it("refuses a zero amount", () => {
    expect(() => buildQuoteRequest({ origin: base, destinationAssetId: "x", amountUnits: 0n, recipient: FORWARDER, refundTo: BORROWER, nowMs: 0 })).toThrow();
  });

  it("turns a quote answer into a transfer, and refuses one without a deposit address", () => {
    const answer = {
      quote: { depositAddress: "0xdead00000000000000000000000000000000beef", amountIn: "25000000", amountOut: "24990000", minAmountOut: "24870000", deadline: "2026-10-13T11:00:00.000Z", timeEstimate: 20 },
    };
    const t = transferFromQuote(answer, { kind: "premium", origin: base, recipient: FORWARDER, refundTo: BORROWER, nowMs: 5 });
    expect(t).toMatchObject({ depositAddress: "0xdead00000000000000000000000000000000beef", chainName: "Base", amountIn: "25000000", minAmountOut: "24870000", timeEstimate: 20, createdAt: 5 });
    expect(() =>
      transferFromQuote({ ...answer, quoteRequest: { recipient: BORROWER } }, { kind: "premium", origin: base, recipient: FORWARDER, refundTo: BORROWER, nowMs: 0 }),
    ).toThrow(/different recipient/);
    expect(transferFromQuote({ ...answer, quoteRequest: { recipient: FORWARDER.toLowerCase() } }, { kind: "premium", origin: base, recipient: FORWARDER, refundTo: BORROWER, nowMs: 0 }).recipient).toBe(FORWARDER);
    expect(() => transferFromQuote({ quote: { amountIn: "1", amountOut: "1" } }, { kind: "premium", origin: base, recipient: FORWARDER, refundTo: BORROWER, nowMs: 0 })).toThrow(AuroraApiError);
  });
});

describe("stored transfer", () => {
  it("round-trips, and is ignored when malformed, a day old or for another deposit address", () => {
    const raw = JSON.stringify(transfer);
    const now = transfer.createdAt + 60_000;
    expect(parseStoredTransfer(raw, FORWARDER.toLowerCase(), now)).toEqual(transfer);
    expect(parseStoredTransfer(raw, undefined, now)).toEqual(transfer);
    expect(parseStoredTransfer(raw, BORROWER, now)).toBeUndefined();
    expect(parseStoredTransfer(raw, FORWARDER, transfer.createdAt + 25 * 3600_000)).toBeUndefined();
    expect(parseStoredTransfer("{not json", FORWARDER, now)).toBeUndefined();
    expect(parseStoredTransfer(JSON.stringify({ ...transfer, amountIn: "1.5" }), FORWARDER, now)).toBeUndefined();
    expect(parseStoredTransfer(null, FORWARDER, now)).toBeUndefined();
    expect(transferKey("vault", "0xAbC")).toBe("shield:aurora:vault:0xabc");
  });

  it("closes at Aurora's inactive time when given, else at the deadline", () => {
    expect(closesAt({ deadline: "2026-10-13T12:00:00.000Z" })).toBe(Date.parse("2026-10-13T12:00:00.000Z"));
    expect(closesAt({ deadline: "2026-10-13T12:00:00.000Z", timeWhenInactive: "2026-10-13T11:30:00.000Z" })).toBe(Date.parse("2026-10-13T11:30:00.000Z"));
    expect(closesAt({})).toBeUndefined();
  });
});

describe("status", () => {
  it("reads the status answer, with hashes as objects or strings", () => {
    const r = parseStatus({
      status: "SUCCESS",
      swapDetails: {
        amountOut: "24990000",
        destinationChainTxHashes: [{ hash: "0xabc", explorerUrl: "https://monadvision.com/tx/0xabc" }],
        originChainTxHashes: ["0xdef"],
      },
    });
    expect(r.status).toBe("SUCCESS");
    expect(r.destinationTxs).toEqual([{ hash: "0xabc", explorerUrl: "https://monadvision.com/tx/0xabc" }]);
    expect(r.originTxs).toEqual([{ hash: "0xdef" }]);
    expect(parseStatus({ status: "SUCCESS", swapDetails: { originChainTxHashes: [{ hash: "0x1", explorerUrl: "javascript:alert(1)" }] } }).originTxs).toEqual([{ hash: "0x1", explorerUrl: undefined }]);
    expect(parseStatus({ status: "SOMETHING_NEW" })).toMatchObject({ status: "UNKNOWN", raw: "SOMETHING_NEW" });
    expect(parseStatus(undefined).status).toBe("UNKNOWN");
    expect(isTerminal("SUCCESS") && isTerminal("REFUNDED") && isTerminal("FAILED")).toBe(true);
    expect(isTerminal("PROCESSING") || isTerminal(undefined)).toBe(false);
  });

  const stage = (status: string | undefined, extra: { expired?: boolean; waiting?: bigint; swapDetails?: Record<string, unknown> } = {}) =>
    transferStage({
      transfer,
      report: status === undefined ? undefined : parseStatus({ status, swapDetails: extra.swapDetails }),
      expired: extra.expired ?? false,
      waitingUnits: extra.waiting ?? 0n,
      closeText: "13:00",
    });

  it("walks the strip from waiting to delivered", () => {
    expect(stage(undefined)).toMatchObject({ step: 0, tone: "progress", final: false });
    expect(stage("PENDING_DEPOSIT")).toMatchObject({ step: 0, tone: "progress", title: "Waiting for 25.00 USDC on Base", final: false });
    expect(stage("PENDING_DEPOSIT").body).toContain("before 13:00");
    expect(stage("KNOWN_DEPOSIT_TX")).toMatchObject({ step: 1, tone: "progress" });
    expect(stage("PROCESSING")).toMatchObject({ step: 2, tone: "progress" });
  });

  it("after delivery, asks for the sweep while USDC waits at the deposit address, then reports it moved in", () => {
    const waiting = stage("SUCCESS", { waiting: 24_990_000n, swapDetails: { amountOut: "24990000" } });
    expect(waiting).toMatchObject({ step: 4, tone: "action", title: "Delivered 24.99 USDC on Monad", final: true });
    expect(waiting.body).toContain("keeper");
    expect(stage("SUCCESS", { waiting: 0n })).toMatchObject({ step: 5, tone: "done", title: "24.99 USDC is in your prepaid premium" });
    const vault = transferStage({ transfer: { ...transfer, kind: "vault" }, report: parseStatus({ status: "SUCCESS" }), expired: false, waitingUnits: 0n });
    expect(vault.title).toBe("24.99 USDC is in the vault, for the treasury");
  });

  it("says what happened and what to do on an expired quote, a short deposit, a refund and a failure", () => {
    const expired = stage("PENDING_DEPOSIT", { expired: true });
    expect(expired).toMatchObject({ tone: "caution", final: true });
    expect(expired.body).toContain("Do not send to it now");
    const short = stage("INCOMPLETE_DEPOSIT", { swapDetails: { depositedAmountFormatted: "20" } });
    expect(short).toMatchObject({ step: 1, tone: "caution", final: false });
    expect(short.body).toContain("Aurora received 20 USDC, short of 25.00 USDC");
    const refunded = stage("REFUNDED", { swapDetails: { refundedAmountFormatted: "24.98", refundReason: "Price moved." } });
    expect(refunded).toMatchObject({ tone: "caution", final: true, title: "Refunded on Base" });
    expect(refunded.body).toBe("Aurora returned 24.98 USDC to 0x3C44…\u206093BC on Base (Price moved). Nothing reached Monad. Get a new deposit address to try again.");
    const failed = stage("FAILED");
    expect(failed).toMatchObject({ tone: "danger", final: true });
    expect(failed.body).toContain("Aurora support");
    expect(stage("SOMETHING_NEW").title).toBe("Aurora reports SOMETHING_NEW");
  });
});

describe("API errors", () => {
  it("names the fix for each failure", () => {
    expect(auroraErrorMessage(404, { message: "Application key not found" })).toContain("app key");
    expect(auroraErrorMessage(429, {}, 7)).toBe("Aurora is limiting requests from this site. Retry in 7 seconds.");
    expect(auroraErrorMessage(400, { message: "Amount is too low for bridge, try at least 1000000." })).toBe("Aurora could not quote this: Amount is too low for bridge, try at least 1000000.");
    expect(auroraErrorMessage(400, null)).toContain("Change it and retry");
    expect(auroraErrorMessage(503, {})).toContain("Retry in a moment");
  });

  it("returns JSON on success and throws with Retry-After on a 429", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ status: "PROCESSING" }), { status: 200 }));
    await expect(auroraFetch(statusPath("key", "0xabc"), {}, ok as unknown as typeof fetch)).resolves.toEqual({ status: "PROCESSING" });
    expect((ok.mock.calls[0] as unknown[])[0]).toBe("https://intents-api.aurora.dev/api/status/key?depositAddress=0xabc");
    const limited = vi.fn(async () => new Response(JSON.stringify({ message: "Rate limit exceeded" }), { status: 429, headers: { "Retry-After": "7" } }));
    const err = await auroraFetch("/x", {}, limited as unknown as typeof fetch).catch((e) => e);
    expect(err).toBeInstanceOf(AuroraApiError);
    expect(err).toMatchObject({ status: 429, retryAfter: 7 });
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(auroraFetch("/x", {}, down as unknown as typeof fetch)).rejects.toMatchObject({ status: 0 });
  });
});

describe("exact amounts", () => {
  it("never rounds, groups thousands and keeps two decimals", () => {
    expect(formatExact(25_000_000n, 6)).toBe("25.00");
    expect(formatExact(1_234_567_891n, 6)).toBe("1,234.567891");
    expect(formatExact(10n ** 18n + 1n, 18)).toBe("1.000000000000000001");
    expect(formatExact(500_000n, 6)).toBe("0.50");
    expect(formatExact(0n, 6)).toBe("0.00");
  });

  it("rounds down to two decimals for an expected or least amount", () => {
    expect(formatDown(24_867_537n, 6)).toBe("24.86");
    expect(formatDown(24_999_999n, 6)).toBe("24.99");
    expect(formatDown(1_234_000_000n, 6)).toBe("1,234.00");
    expect(formatDown(10n ** 18n - 1n, 18)).toBe("0.99");
  });
});
