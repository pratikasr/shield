import type { AavePosition, ReserveLine } from "@/hooks/useAavePosition";
import type { ShieldConfig } from "@/hooks/useShieldConfig";
import type { Cover } from "@/hooks/useShieldPosition";
import { collateralName } from "./env";
import { exitStatusMessage, type ExitStatusContext } from "./exit-status";
import { formatClock, formatCountdown, formatDuration } from "./format";

/**
 * Whether a cover is armed: every condition the Executor checks before it would let an exit run, computed in the
 * browser. `previewExit` cannot answer this on its own because above the trigger it returns AboveTrigger before it
 * checks the approval, eMode, the discount ceiling or LTV-0 collateral. "Protected" on screen means armed.
 */

export type FixAction = "approve" | "topup" | "leaveEmode" | "raiseDiscount" | "fixCollateral" | "borrowUsdc" | "supply" | "wait";

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** Shown under a failing check. */
  detail?: string;
  fix?: FixAction;
}

export type ArmKind = "none" | "exited" | "loading" | "warming" | "notArmed" | "due" | "blocked" | "armed";

export interface ArmState {
  kind: ArmKind;
  armed: boolean;
  /** Short status for the page header and the panel heading. */
  title: string;
  /** One or two sentences under the heading. */
  body: string;
  tone: "safe" | "caution" | "danger" | "neutral";
  checks: Check[];
  fix?: FixAction;
  /** When the waiting period ends, in chain unix seconds, and in local clock terms. */
  armsAt?: number;
  armsIn?: number;
  /** Local wall-clock time the cover arms, HH:MM. */
  armsAtClock?: string;
  /** Legend text for the gauge's trigger mark. */
  triggerNote: string;
}

export interface ArmInputs {
  cover: Cover | undefined;
  position: AavePosition | undefined;
  collateral: ReserveLine | undefined;
  config: ShieldConfig | undefined;
  /** Current chain time estimate, unix seconds. */
  chainNow: number | undefined;
  /** Latest block, for the prepaid balance net of accrual. */
  block: bigint | undefined;
}

/** Prepaid balance net of the premium owed since the last reprice, billed at the higher of the stored and live rates. */
export function livePrepaid(cover: Cover, block: bigint | undefined): { prepaidUsd: number; accruedUsd: number; rate: number; blocksSince: number } {
  const rate = Math.max(cover.premiumPerBlockUsd, cover.active ? cover.livePremiumPerBlockUsd : 0);
  const blocksSince = cover.active && block !== undefined ? Math.max(Number(block - cover.lastRepricedBlock), 0) : 0;
  if (!cover.active || cover.lapsed) return { prepaidUsd: cover.prepaidUsd, accruedUsd: cover.premiumPaidUsd, rate, blocksSince };
  const owed = Math.min(rate * blocksSince, cover.prepaidUsd);
  return { prepaidUsd: cover.prepaidUsd - owed, accruedUsd: cover.premiumPaidUsd + owed, rate, blocksSince };
}

/** Before the cover has been read: say nothing about protection yet. */
export const LOADING_ARM: ArmState = { kind: "loading", armed: false, title: "Checking cover", body: "Reading the cover from Monad.", tone: "neutral", checks: [], triggerNote: "Trigger" };

export function computeArm({ cover, position, collateral, config, chainNow, block }: ArmInputs): ArmState {
  const none = (kind: ArmKind, title: string, body: string): ArmState => ({ kind, armed: false, title, body, tone: "neutral", checks: [], triggerNote: "Trigger, not armed" });
  if (!cover || !cover.active) {
    if (cover?.exited) return none("exited", "Exited", "The last cover ended in an exit.");
    return none("none", "Not protected", "No active cover.");
  }
  if (!position || !config || !collateral) return { ...none("loading", "Checking cover", "Reading the cover's conditions from Monad."), tone: "neutral" };

  const name = collateralName(collateral.asset);
  const symbol = collateral.symbol || name.symbol;
  const assetCfg = config.assets.find((a) => a.asset.toLowerCase() === collateral.asset.toLowerCase());
  const allowance = cover.aTokenAllowances[collateral.asset.toLowerCase()] ?? 0n;
  const prepaid = livePrepaid(cover, block);
  const armsAt = cover.optedInAt + config.minCoverSeconds;
  const armsIn = chainNow === undefined ? undefined : armsAt - chainNow;
  const warming = cover.exitStatus === "CoverWarmingUp" || (armsIn !== undefined && armsIn > 0);
  const usdcDebt = position.usdc?.borrowedRaw ?? 0n;
  const ltv0 = position.ltv0Collateral;

  const checks: Check[] = [
    {
      id: "paid",
      label: "Prepaid balance covers the premium",
      ok: !cover.lapsed && prepaid.prepaidUsd > 0,
      detail: "The prepaid balance ran out, so the cover lapsed. Top up to re-arm it.",
      fix: "topup",
    },
    {
      id: "warm",
      label: `Waiting period of ${formatDuration(config.minCoverSeconds)} is over`,
      ok: !warming,
      detail: armsIn !== undefined ? `Cover arms at ${formatClock(Date.now() / 1000 + Math.max(armsIn, 0))}.` : "Cover arms soon.",
      fix: "wait",
    },
    {
      id: "allowance",
      label: `Shield may move your a${symbol} at an exit`,
      ok: allowance >= collateral.suppliedRaw,
      detail: `The approval on a${symbol} is below your balance, so an exit could not take it. Approve it again.`,
      fix: "approve",
    },
    { id: "emode", label: "Position is outside eMode", ok: position.eMode === 0, detail: "Shield covers positions outside eMode only. Leave eMode on Aave.", fix: "leaveEmode" },
    {
      id: "discount",
      label: "Exit discount is within your maximum",
      ok: config.exitDiscountBps <= cover.maxDiscountBps,
      detail: `Shield's exit discount is ${config.exitDiscountBps / 100}% and your maximum is ${cover.maxDiscountBps / 100}%. Raise your maximum discount.`,
      fix: "raiseDiscount",
    },
    {
      id: "ltv0",
      label: "No LTV-0 collateral enabled on Aave",
      ok: ltv0 !== undefined && ltv0.length === 0,
      detail:
        ltv0 === undefined
          ? "Checking your other collateral."
          : `Aave will not move your a${symbol} while ${ltv0.map((r) => r.symbol).join(" and ")} is enabled as collateral with LTV 0. Withdraw it or turn off its collateral use on Aave.`,
      fix: "fixCollateral",
    },
    { id: "asset", label: `${symbol} cover is enabled`, ok: assetCfg?.enabled === true, detail: `Shield has paused cover for ${symbol}.` },
    { id: "debt", label: "There is USDC debt to repay", ok: usdcDebt > 0n, detail: "This position has no USDC debt, so an exit has nothing to repay.", fix: "borrowUsdc" },
    {
      id: "collateral",
      label: `There is ${symbol} to take`,
      ok: collateral.suppliedRaw > 0n,
      detail: `This position has no ${symbol} supplied on Aave, so an exit has nothing to take.`,
      fix: "supply",
    },
  ];

  const ctx: ExitStatusContext = {
    symbol,
    priceName: name.priceName,
    discountBps: config.exitDiscountBps,
    maxDiscountBps: cover.maxDiscountBps,
    maxGapBps: config.maxOracleDeviationBps,
    maxPriceAgeSeconds: config.exitMaxPriceAge,
    target: cover.trigger + config.exitHfBuffer,
  };
  const premiumNote = " The premium keeps accruing until you opt out.";

  // Anything except the waiting period disarms the cover outright.
  const failing = checks.find((c) => !c.ok && c.id !== "warm");
  if (failing?.id === "ltv0" && ltv0 === undefined) {
    return { ...none("loading", "Checking cover", "Reading your other Aave collateral from Monad."), checks, triggerNote: "Trigger" };
  }
  if (failing) {
    const exitsCannotRun = `Exits cannot run: ${failing.detail?.charAt(0).toLowerCase()}${failing.detail?.slice(1)}`;
    return {
      kind: "notArmed",
      armed: false,
      title: `Not armed: ${shortReason(failing.id, symbol)}`,
      body: failing.id === "paid" ? failing.detail! : `${exitsCannotRun}${premiumNote}`,
      tone: failing.id === "allowance" || failing.id === "asset" ? "danger" : "caution",
      checks,
      fix: failing.fix,
      triggerNote: "Trigger, not armed",
    };
  }
  if (warming) {
    const left = Math.max(armsIn ?? 0, 0);
    const clock = armsIn !== undefined ? formatClock(Date.now() / 1000 + left) : undefined;
    return {
      kind: "warming",
      armed: false,
      title: left > 0 ? `Cover arms in ${formatCountdown(left)}` : "Cover arms in a moment",
      body: `${clock ? `Arms at ${clock}. ` : ""}New, restored or raised cover waits ${formatDuration(config.minCoverSeconds)} before an exit can run, so cover cannot be bought at the moment it is needed.`,
      tone: "caution",
      checks,
      fix: "wait",
      armsAt,
      armsIn: left,
      armsAtClock: clock,
      triggerNote: left > 0 ? `Trigger, arms in ${formatCountdown(left)}${clock ? ` (at ${clock})` : ""}` : "Trigger, arming",
    };
  }
  const atTrigger = position.healthFactor <= cover.trigger;
  if (atTrigger || (cover.exitStatus !== "AboveTrigger" && cover.exitStatus !== "Ready")) {
    if (cover.exitStatus === "Ready") {
      const m = exitStatusMessage("Ready", ctx);
      return { kind: "due", armed: true, title: m.title, body: m.body, tone: "caution", checks, triggerNote: "Trigger, exit due" };
    }
    if (cover.exitStatus !== "AboveTrigger") {
      const m = exitStatusMessage(cover.exitStatus, ctx);
      return {
        kind: "blocked",
        armed: false,
        title: `Exit blocked: ${m.title.charAt(0).toLowerCase()}${m.title.slice(1)}`,
        body: m.body,
        tone: cover.exitStatus === "PythStale" || cover.exitStatus === "OracleDeviation" ? "caution" : "danger",
        checks,
        fix: statusFix(cover.exitStatus),
        triggerNote: "Trigger, exit blocked",
      };
    }
  }
  return {
    kind: "armed",
    armed: true,
    title: "Protected",
    body: `Shield exits if your health factor reaches ${cover.trigger.toFixed(2)}.`,
    tone: "safe",
    checks,
    triggerNote: "Trigger",
  };
}

function shortReason(id: string, symbol: string): string {
  switch (id) {
    case "paid":
      return "prepaid balance used up";
    case "allowance":
      return `a${symbol} approval too low`;
    case "emode":
      return "position is in eMode";
    case "discount":
      return "discount above your maximum";
    case "ltv0":
      return "LTV-0 collateral enabled";
    case "asset":
      return `${symbol} cover paused`;
    case "debt":
      return "no USDC debt";
    case "collateral":
      return `no ${symbol} supplied`;
    default:
      return "check the conditions below";
  }
}

function statusFix(status: Cover["exitStatus"]): FixAction | undefined {
  switch (status) {
    case "CoverLapsed":
      return "topup";
    case "AllowanceTooLow":
      return "approve";
    case "EModeUnsupported":
      return "leaveEmode";
    case "DiscountAboveMax":
      return "raiseDiscount";
    default:
      return undefined;
  }
}

/** The header's short status: "Protected at 1.05", "Cover arms in 12:04 (at 15:48)", "Not armed: ...", "Exit due", "Exited". */
export function headerStatus(arm: ArmState, cover: Cover | undefined): string {
  if (arm.kind === "armed" && cover) return `Protected at ${cover.trigger.toFixed(2)}`;
  if (arm.kind === "warming" && arm.armsAtClock) return `${arm.title} (at ${arm.armsAtClock})`;
  return arm.title;
}
