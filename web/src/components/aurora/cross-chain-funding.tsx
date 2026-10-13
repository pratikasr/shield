"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import type { CrossChainProps } from "@/components/aurora/funding-source";
import { SectionLabel } from "@/components/borrow/cover-shared";
import { AmountHint, AmountInput } from "@/components/data/amount-input";
import { Chip } from "@/components/data/chip";
import { HashLink } from "@/components/data/hash-link";
import { TokenIcon } from "@/components/data/token";
import { SwitchButton } from "@/components/shell/network-guard";
import { TxStatus } from "@/components/tx/tx-status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sweepRequest, useDepositAddress } from "@/hooks/useDepositAddress";
import { useNow, usePageVisible } from "@/hooks/useLiveBlock";
import { useShieldConfig } from "@/hooks/useShieldConfig";
import { useTx } from "@/hooks/useTx";
import { checkAmount } from "@/lib/amount";
import {
  AURORA_DOCS,
  AURORA_SUPPORT,
  AuroraApiError,
  STATUS_POLL_MS,
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
  quotePath,
  sourceAssets,
  sourceChains,
  statusPath,
  tokensPath,
  transferFromQuote,
  transferKey,
  transferStage,
  transferSteps,
  type AuroraTransfer,
  type FundingKind,
  type StageView,
  type StatusReport,
} from "@/lib/aurora";
import { aave, auroraAppKey, explorerUrl } from "@/lib/env";
import { formatClock, formatDuration, formatUsd, toNumber, truncateHex } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Status checks stop this long after the deposit window closed with nothing sent. */
const STOP_AFTER_CLOSE_MS = 10 * 60_000;

function readTransfer(kind: FundingKind, owner: Address, recipient: string): AuroraTransfer | undefined {
  try {
    return parseStoredTransfer(window.localStorage.getItem(transferKey(kind, owner)), recipient, Date.now());
  } catch {
    return undefined;
  }
}

function writeTransfer(kind: FundingKind, owner: Address, t: AuroraTransfer | undefined) {
  try {
    if (t) window.localStorage.setItem(transferKey(kind, owner), JSON.stringify(t));
    else window.localStorage.removeItem(transferKey(kind, owner));
  } catch {
    // Storage unavailable (private mode): the transfer is followed until the page closes.
  }
}

/** A full address, never truncated, so it can be checked character by character, with copy and, on Monad, the explorer. */
function AddressLine({ value, label, onMonad }: { value: string; label: string; onMonad?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (insecure context): the address is selectable text.
    }
  };
  return (
    <div className="flex items-start gap-1">
      <code className="min-w-0 flex-1 break-all rounded-xl border-2 border-ink/30 bg-cloud px-3 py-2 font-mono text-[14px] font-semibold leading-relaxed text-ink">{value}</code>
      <button
        type="button"
        onClick={copy}
        className="hit relative inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={copied ? "Copied" : `Copy ${label}`}
      >
        {copied ? <Check className="size-4 text-safe" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
      {onMonad && (
        <a
          href={`${explorerUrl}/address/${value}`}
          target="_blank"
          rel="noreferrer"
          className="hit relative inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Open the deposit address in the explorer"
        >
          <ExternalLink className="size-4" aria-hidden />
        </a>
      )}
    </div>
  );
}

/** A short address that never wraps, with a copy button: for an address on another chain, where the Monad explorer does not apply. */
function CopyShort({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap num">
      <span title={value}>{truncateHex(value)}</span>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            // Clipboard unavailable: the full address is in the title.
          }
        }}
        className="hit relative inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={copied ? "Copied" : `Copy ${label}`}
      >
        {copied ? <Check className="size-3.5 text-safe" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
    </span>
  );
}

/** The Shield deposit address on Monad, what waits there, and the sweep that moves it in. */
function DepositAddressCard({
  kind,
  address,
  waitingUnits,
  wrongNetwork,
  sweepFor,
  onSwept,
}: {
  kind: FundingKind;
  address?: Address;
  waitingUnits?: bigint;
  wrongNetwork: boolean;
  /** The borrower for a premium sweep; ignored for the vault, whose sweep always credits the registry's treasury. */
  sweepFor: Address;
  onSwept: () => void;
}) {
  const tx = useTx();
  const { config } = useShieldConfig();
  const waiting = waitingUnits ?? 0n;
  const premium = kind === "premium";
  const action = premium ? "Move into premium" : "Move into the vault";
  return (
    <section className="c-panel" aria-labelledby={`${kind}-deposit-heading`}>
      <h3 id={`${kind}-deposit-heading`} className="flex items-center gap-1.5 font-display text-[19px] leading-tight">
        <TokenIcon symbol="MON" size={16} />
        {premium ? "Your deposit address on Monad" : "Treasury deposit address on Monad"}
      </h3>
      <div className="mt-2.5">{address ? <AddressLine value={address} label="deposit address" onMonad /> : <Skeleton className="h-[3.75rem] w-full" />}</div>
      <p className="mt-2.5 text-[14.5px] text-ink-soft">
        {premium
          ? "USDC that reaches this address, sent on Monad or delivered by Aurora Intents from another chain, becomes your prepaid premium."
          : `USDC that reaches this address, sent on Monad or delivered by Aurora Intents from another chain, is deposited into the vault with the shares going to the treasury${config ? `, ${truncateHex(config.treasury)}` : ""}.`}{" "}
        <span className="font-semibold text-ink">Send only USDC on Monad to it directly{auroraAppKey ? "; from another chain, use an Aurora deposit address below" : ""}.</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t-[1.5px] border-dashed border-ink/25 pt-3">
        <div>
          <p className="text-[14.5px] text-ink-soft">Waiting here</p>
          <div className="text-[20px] font-extrabold num" aria-live="polite">
            {waitingUnits === undefined ? <Skeleton className="h-5 w-16" /> : formatUsd(toNumber(waiting, 6))}
          </div>
        </div>
        {wrongNetwork ? (
          <SwitchButton action={premium ? "move it into premium" : "move it into the vault"} size="default" />
        ) : (
          <Button
            size="sm"
            disabled={waiting === 0n || tx.busy}
            onClick={async () => {
              if (await tx.send(premium ? "Premium sweep" : "Vault funding", sweepRequest(kind, sweepFor), { context: premium ? "cover" : "vault" })) onSwept();
            }}
          >
            {tx.busy ? "Check your wallet" : action}
          </Button>
        )}
      </div>
      <p className="mt-2 text-[13.5px] text-ink-soft">
        Shield&rsquo;s keeper also checks deposit addresses and moves what it finds on its own; anyone may run the move, and it only ever credits{" "}
        {premium ? "this borrower" : "the treasury"}.
      </p>
      <TxStatus state={tx.state} className="mt-2" />
    </section>
  );
}

function NotConfigured() {
  return (
    <section className="rounded-2xl border-2 border-dashed border-ink bg-heads-tint p-4 text-[14.5px] text-ink" aria-label="From another chain">
      <p className="font-bold">Cross-chain transfers are not configured on this build</p>
      <p className="mt-1">
        It has no Aurora Intents app key, so it cannot quote a transfer from another chain. Sending USDC on Monad to the deposit address above still works.
      </p>
    </section>
  );
}

/**
 * Follows one transfer at Aurora: every 6 s while the page is visible, longer when Aurora asks (Retry-After). Stops at
 * a final status, and once the deposit window has been closed for a while with nothing sent.
 */
function useAuroraStatus(appKey: string, transfer: AuroraTransfer | undefined) {
  const [report, setReport] = useState<StatusReport>();
  const [error, setError] = useState<string>();
  const visible = usePageVisible();
  const deposit = transfer?.depositAddress;
  const memo = transfer?.depositMemo;
  const close = transfer ? closesAt(transfer) : undefined;
  useEffect(() => {
    setReport(undefined);
    setError(undefined);
  }, [deposit]);
  useEffect(() => {
    if (!deposit || !visible) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = STATUS_POLL_MS;
    const tick = async () => {
      let wait = STATUS_POLL_MS;
      try {
        const r = parseStatus(await auroraFetch(statusPath(appKey, deposit, memo)));
        if (stop) return;
        setReport(r);
        setError(undefined);
        backoff = STATUS_POLL_MS;
        if (isTerminal(r.status)) return;
        if (r.status === "PENDING_DEPOSIT" && close !== undefined && Date.now() > close + STOP_AFTER_CLOSE_MS) return;
      } catch (e) {
        if (stop) return;
        const err = e instanceof AuroraApiError ? e : new AuroraApiError(0, "Aurora's API did not answer.");
        setError(err.message);
        backoff = Math.min(backoff * 2, 60_000);
        wait = err.retryAfter ? err.retryAfter * 1000 + Math.random() * 500 : backoff;
      }
      timer = setTimeout(tick, wait);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [appKey, deposit, memo, close, visible]);
  return { report, error };
}

function StatusStrip({ steps, stage }: { steps: string[]; stage: StageView }) {
  return (
    <ol className="grid gap-2" aria-label="Transfer progress">
      {steps.map((label, i) => {
        const state = i < stage.step || stage.tone === "done" ? "done" : i === stage.step ? stage.tone : "todo";
        return (
          <li key={label} className="flex items-center gap-2.5 text-[0.8125rem]" aria-current={i === stage.step ? "step" : undefined}>
            <span
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
                state === "done" && "border-safe bg-safe text-white dark:text-background",
                state === "progress" && "border-foreground text-foreground",
                state === "action" && "border-foreground bg-foreground text-background",
                state === "caution" && "border-caution bg-caution-soft text-caution",
                state === "danger" && "border-danger bg-danger-soft text-danger",
                state === "todo" && "bg-card",
              )}
              aria-hidden
            >
              {state === "done" ? (
                <Check className="size-3" />
              ) : state === "progress" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : state === "action" ? (
                <span className="size-1.5 rounded-full bg-current" />
              ) : state === "caution" || state === "danger" ? (
                <TriangleAlert className="size-3" />
              ) : null}
            </span>
            <span className={cn(state === "todo" ? "text-muted-foreground" : "text-foreground", i === stage.step && stage.tone !== "done" && "font-medium")}>{label}</span>
            <span className="sr-only">
              {state === "done" ? ": done" : state === "todo" ? ": not yet" : state === "progress" ? ": in progress" : state === "action" ? ": waiting for the move" : ": needs attention"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const TONE_BOX = {
  progress: "bg-sky-2",
  action: "bg-grape-tint",
  done: "bg-chill-tint",
  caution: "bg-heads-tint",
  danger: "bg-lava-tint",
} as const;
const TONE_TITLE = { progress: "text-ink", action: "text-ink", done: "text-ink", caution: "text-ink", danger: "text-ink" } as const;

/** One accepted quote: what to send and where, then Aurora's progress through to USDC on Monad. */
function ActiveTransfer({ appKey, transfer, waitingUnits, onReset }: { appKey: string; transfer: AuroraTransfer; waitingUnits: bigint; onReset: () => void }) {
  const now = useNow(5_000);
  const close = closesAt(transfer);
  const closed = close !== undefined && now > close;
  const closeText = close !== undefined ? formatClock(close / 1000) : undefined;
  const { report, error } = useAuroraStatus(appKey, transfer);
  const stage = transferStage({ transfer, report, expired: closed, waitingUnits, closeText });
  const send = `${formatExact(BigInt(transfer.amountIn), transfer.decimals)} ${transfer.symbol}`;
  const awaitingDeposit = !report || ((report.status === "PENDING_DEPOSIT" || report.status === "INCOMPLETE_DEPOSIT") && !closed);
  const delivery = report?.destinationTxs[0];
  const origin = report?.originTxs[0];
  const steps = transferSteps(transfer.kind, transfer.chainName);
  const where = transfer.kind === "premium" ? "then into your premium" : "then into the vault";

  return (
    <section className="overflow-hidden rounded-2xl border-[2.5px] border-ink bg-cloud" aria-label="Transfer from another chain">
      <div className="border-b-2 border-ink bg-sky-2 px-4 py-3">
        <p className="font-display text-[19px] leading-tight">
          {awaitingDeposit ? `Send exactly ${send} on ${transfer.chainName}` : `${send} from ${transfer.chainName}`}
        </p>
        <p className="mt-0.5 text-[0.8125rem] text-muted-foreground num">
          Arrives as about {formatDown(BigInt(transfer.amountOut), 6)} USDC on Monad, at least {formatDown(BigInt(transfer.minAmountOut), 6)}
          {transfer.timeEstimate ? `, about ${formatDuration(transfer.timeEstimate)} after the deposit confirms` : ""}, at your deposit address, {where}.
        </p>
      </div>

      {awaitingDeposit && (
        <div className="grid gap-3 border-b-2 border-ink px-4 py-4">
          <dl className="grid grid-cols-2 gap-3 text-[0.8125rem]">
            <div>
              <dt className="text-muted-foreground">Sending from chain</dt>
              <dd className="mt-0.5 font-medium">{transfer.chainName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Supported asset</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                <TokenIcon symbol={transfer.symbol} size={16} />
                {transfer.symbol} only
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Amount to send</dt>
              <dd className="mt-0.5 text-[22px] font-extrabold num">{send}</dd>
            </div>
            <div className="col-span-2">
              <dt className="mb-1 text-muted-foreground">Aurora deposit address on {transfer.chainName}</dt>
              <dd>
                <AddressLine value={transfer.depositAddress} label={`Aurora deposit address on ${transfer.chainName}`} />
                {transfer.depositMemo && <p className="mt-1.5 text-muted-foreground">Memo, required: <code className="font-mono text-foreground">{transfer.depositMemo}</code></p>}
              </dd>
            </div>
          </dl>
          <div className="rounded-xl border-2 border-ink bg-heads-tint p-3 text-[14.5px]" role="note">
            <p className="font-bold">Transfer requirements</p>
            <p className="mt-0.5">
              Send only {transfer.symbol} from {transfer.chainName} to this address, exactly {send}
              {closeText ? `, before ${closeText}` : ""}. Another token or another network may be lost. Less than {send} is refunded after that time; more is
              delivered and the excess refunded. Refunds go to <span className="whitespace-nowrap">{truncateHex(transfer.refundTo)}</span>, this wallet&rsquo;s address on{" "}
              {transfer.chainName}.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 px-4 py-4">
        <StatusStrip steps={steps} stage={stage} />
        <div className={cn("rounded-xl border-2 border-ink p-3 text-[14.5px]", TONE_BOX[stage.tone])} role={stage.tone === "danger" ? "alert" : "status"} aria-live="polite">
          <p className={cn("font-bold", TONE_TITLE[stage.tone])}>{stage.title}</p>
          <p className="mt-0.5 text-muted-foreground">{stage.body}</p>
        </div>
        {!awaitingDeposit && (
          <dl className="grid gap-1.5 text-[0.8125rem]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted-foreground">Deposit address on {transfer.chainName}</dt>
              <dd>
                <CopyShort value={transfer.depositAddress} label={`Aurora deposit address on ${transfer.chainName}`} />
              </dd>
            </div>
            {origin && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-muted-foreground">Your deposit on {transfer.chainName}</dt>
                <dd>
                  {origin.explorerUrl ? (
                    <a href={origin.explorerUrl} target="_blank" rel="noreferrer" className="rounded-sm underline decoration-border underline-offset-4 num hover:decoration-foreground">
                      {truncateHex(origin.hash)}
                      <span className="sr-only"> (opens the {transfer.chainName} explorer)</span>
                    </a>
                  ) : (
                    <CopyShort value={origin.hash} label={`transaction hash on ${transfer.chainName}`} />
                  )}
                </dd>
              </div>
            )}
            {delivery && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-muted-foreground">Delivery on Monad</dt>
                <dd>
                  <HashLink value={delivery.hash} />
                </dd>
              </div>
            )}
          </dl>
        )}
        {error && !isTerminal(report?.status) && (
          <p className="text-[0.8125rem] text-caution" role="status">
            {error.replace(/\.$/, "")}. This page keeps checking.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          <Button size="sm" variant="white" onClick={onReset}>
            {isTerminal(report?.status) || stage.final ? "Start a new transfer" : "Use a different amount or chain"}
          </Button>
          {report?.status === "FAILED" && (
            <a href={AURORA_SUPPORT} target="_blank" rel="noreferrer" className="c-link inline-flex min-h-11 items-center text-[14.5px]">
              Report it to Aurora support
            </a>
          )}
        </div>
        {awaitingDeposit && (
          <p className="text-[0.75rem] text-muted-foreground">
            A new transfer only stops this page following this one. A deposit made to this address before it closes still arrives at your deposit address on Monad.
          </p>
        )}
      </div>
    </section>
  );
}

/** Choose a source chain, asset and amount; Aurora quotes it and returns a deposit address on that chain. */
function AuroraFlow({
  appKey,
  kind,
  owner,
  recipient,
  refundTo,
  waitingUnits,
}: {
  appKey: string;
  kind: FundingKind;
  owner: Address;
  recipient?: Address;
  refundTo: Address;
  waitingUnits: bigint;
}) {
  const tokens = useQuery({
    queryKey: ["aurora-tokens", appKey],
    queryFn: async () => parseTokens(await auroraFetch(tokensPath(appKey))),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const assets = useMemo(() => sourceAssets(tokens.data ?? []), [tokens.data]);
  const chains = useMemo(() => sourceChains(assets), [assets]);
  const destination = useMemo(() => (tokens.data ? monadUsdc(tokens.data, aave.usdc) : undefined), [tokens.data]);

  const [chainCode, setChainCode] = useState("base");
  const [symbol, setSymbol] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string>();
  const [transfer, setTransfer] = useState<AuroraTransfer>();

  // A transfer this browser was following for this deposit address picks up where it left off.
  useEffect(() => {
    if (recipient) setTransfer(readTransfer(kind, owner, recipient));
  }, [kind, owner, recipient]);

  const chain = chains.find((c) => c.code === chainCode) ?? chains[0];
  const asset = chain?.assets.find((a) => a.symbol === symbol) ?? chain?.assets[0];
  const check = checkAmount(amount, { decimals: asset?.decimals ?? 6, symbol: asset?.symbol ?? "USDC" });

  const reset = useCallback(() => {
    writeTransfer(kind, owner, undefined);
    setTransfer(undefined);
    setQuoteError(undefined);
  }, [kind, owner]);

  const quote = async () => {
    if (!asset || !destination || !recipient || !check.ok) return;
    setQuoting(true);
    setQuoteError(undefined);
    try {
      const body = buildQuoteRequest({ origin: asset, destinationAssetId: destination.assetId, amountUnits: check.units, recipient, refundTo, nowMs: Date.now() });
      const json = await auroraFetch(quotePath(appKey), { method: "POST", body: JSON.stringify(body) });
      const t = transferFromQuote(json, { kind, origin: asset, recipient, refundTo, nowMs: Date.now() });
      writeTransfer(kind, owner, t);
      setTransfer(t);
    } catch (e) {
      setQuoteError(e instanceof AuroraApiError ? e.message : "Aurora's quote could not be read. Retry.");
    } finally {
      setQuoting(false);
    }
  };

  if (transfer) return <ActiveTransfer appKey={appKey} transfer={transfer} waitingUnits={waitingUnits} onReset={reset} />;

  const header = (
    <div>
      <h3 id={`${kind}-aurora-heading`} className="font-display text-[19px] leading-tight">
        Send from another chain
      </h3>
      <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
        Aurora Intents, powered by NEAR Intents, takes a stablecoin on the chain you choose and delivers USDC to the deposit address above.
      </p>
    </div>
  );

  if (tokens.isPending) {
    return (
      <section className="grid gap-3" aria-busy="true" aria-label="Loading Aurora's supported chains">
        {header}
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-12 w-full" />
      </section>
    );
  }
  if (tokens.error || !chain || !asset) {
    return (
      <section className="grid gap-3">
        {header}
        <div role="alert" className="text-[0.8125rem] text-danger">
          {tokens.error instanceof AuroraApiError ? tokens.error.message : "Aurora listed no stablecoins on the chains Shield offers."}
          <Button size="sm" variant="white" className="mt-2 flex" onClick={() => void tokens.refetch()}>
            Retry
          </Button>
        </div>
      </section>
    );
  }
  if (!destination) {
    return (
      <section className="grid gap-3">
        {header}
        <p className="text-[0.8125rem] text-caution" role="status">
          Aurora does not list Shield&rsquo;s USDC on Monad right now, so it cannot deliver here. Sending USDC on Monad to the deposit address above still works.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4" aria-labelledby={`${kind}-aurora-heading`}>
      {header}
      <div className="grid gap-2">
        <SectionLabel htmlFor={`${kind}-source-chain`}>Sending from chain</SectionLabel>
        <div className="relative">
          <select
            id={`${kind}-source-chain`}
            value={chain.code}
            onChange={(e) => {
              setChainCode(e.target.value);
              setQuoteError(undefined);
            }}
            className="c-field appearance-none pr-9 text-[16px]"
          >
            {chains.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        </div>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium" id={`${kind}-asset-label`}>
          Asset <span className="font-normal text-muted-foreground">({chain.assets.length} supported on {chain.name})</span>
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${kind}-asset-label`}>
          {chain.assets.map((a) => (
            <Chip key={a.assetId} active={a.assetId === asset.assetId} onClick={() => setSymbol(a.symbol)}>
              <span className="inline-flex items-center gap-1.5">
                <TokenIcon symbol={a.symbol} size={14} />
                {a.symbol}
              </span>
            </Chip>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <SectionLabel htmlFor={`${kind}-source-amount`}>
          Amount, {asset.symbol} on {chain.name}
        </SectionLabel>
        <AmountInput
          id={`${kind}-source-amount`}
          value={amount}
          onChange={(v) => {
            setAmount(v);
            setQuoteError(undefined);
          }}
          check={check}
          hintId={`${kind}-source-amount-help`}
          symbol={asset.symbol}
          placeholder="25.00"
        />
        <AmountHint id={`${kind}-source-amount-help`} check={check}>
          Aurora quotes what arrives on Monad, after its fees, before you send anything.
        </AmountHint>
      </div>
      <Button size="big" disabled={!check.ok || !recipient} loading={quoting} loadingText="Asking Aurora for a quote" onClick={() => void quote()}>
        {`Get a deposit address on ${chain.name}`}
      </Button>
      {quoteError && (
        <p className="text-[0.8125rem] text-danger" role="alert">
          {quoteError}
        </p>
      )}
      <p className="text-[0.75rem] text-muted-foreground">
        Refunds, if any, go to <span className="whitespace-nowrap">{truncateHex(refundTo)}</span>, this wallet&rsquo;s address on {chain.name}.{" "}
        <a href={AURORA_DOCS} target="_blank" rel="noreferrer" className="font-medium text-brand underline-offset-4 hover:underline">
          About Aurora Intents
        </a>
      </p>
    </section>
  );
}

/** "From another chain": the Shield deposit address on Monad, then Aurora's flow from the chain the USDC is on. Loaded lazily. */
export default function CrossChainFunding({ kind, owner, refundTo, wrongNetwork, onSwept }: CrossChainProps) {
  const dep = useDepositAddress(kind, kind === "premium" ? owner : undefined);
  const swept = useCallback(() => {
    void dep.refetch();
    onSwept?.();
  }, [dep, onSwept]);
  return (
    <div className="grid gap-5">
      <DepositAddressCard kind={kind} address={dep.address} waitingUnits={dep.waitingUnits} wrongNetwork={wrongNetwork} sweepFor={owner} onSwept={swept} />
      {dep.error && (
        <p className="text-[0.8125rem] text-danger" role="alert">
          Could not read the deposit address from Monad. Check your connection and retry.
        </p>
      )}
      {auroraAppKey ? (
        <AuroraFlow appKey={auroraAppKey} kind={kind} owner={owner} recipient={dep.address} refundTo={refundTo} waitingUnits={dep.waitingUnits ?? 0n} />
      ) : (
        <NotConfigured />
      )}
    </div>
  );
}
