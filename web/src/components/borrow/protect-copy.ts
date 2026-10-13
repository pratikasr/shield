import type { ArmState } from "@/lib/cover-status";
import type { ExitStatus } from "@/lib/exit-status";

/**
 * What blocks an exit, in the borrower's words, with the one fix. Every reason computeArm (lib/cover-status.ts) or the
 * Executor's previewExit can give maps to one entry, so the page never says something the contract would not do.
 */

export type BlockReason =
  | "allowance"
  | "emode"
  | "discount"
  | "ltv0"
  | "asset"
  | "debt"
  | "collateral"
  | "oracle"
  | "stale"
  | "unreachable"
  | "unknown";

export type FixKind = "approve" | "raiseDiscount" | "openAave" | "recheck" | "turnOff";

export interface BlockCopy {
  /** One short label, for the sticker strip and nerds. */
  chip: string;
  /** The sentence under the headline: what is wrong. */
  say: string;
  /** The fix, as the alert's title. */
  title: string;
  /** One or two sentences on the fix. */
  text: string;
  fix: FixKind;
  /** The fix button's words. */
  button: string;
}

export interface BlockContext {
  /** "ETH" for WETH: the asset in plain words. */
  asset: string;
  /** Shield's exit discount and the borrower's maximum, in bps. */
  discountBps: number;
  maxDiscountBps: number;
  /** Aave's bonus as a percentage, for example 5.5. */
  aaveBonusPct: number;
  /** The Aave-against-Pyth gap an exit accepts, in bps. */
  maxGapBps: number;
  /** Symbols of LTV-0 collateral switched on. */
  ltv0: string[];
  /** The health factor an exit restores. */
  target: number;
}

/** The reason an armed-looking cover cannot exit, from the arm state; undefined when nothing blocks it. */
export function blockReason(arm: ArmState, status: ExitStatus): BlockReason | undefined {
  if (arm.kind === "notArmed") {
    const failing = arm.checks.find((c) => !c.ok && c.id !== "warm");
    switch (failing?.id) {
      case "allowance":
        return "allowance";
      case "emode":
        return "emode";
      case "discount":
        return "discount";
      case "ltv0":
        return "ltv0";
      case "asset":
        return "asset";
      case "debt":
        return "debt";
      case "collateral":
        return "collateral";
      case "paid":
        return undefined;
      default:
        return "unknown";
    }
  }
  if (arm.kind === "blocked") {
    switch (status) {
      case "AllowanceTooLow":
        return "allowance";
      case "EModeUnsupported":
        return "emode";
      case "DiscountAboveMax":
        return "discount";
      case "PythStale":
        return "stale";
      case "OracleDeviation":
        return "oracle";
      case "TargetUnreachable":
        return "unreachable";
      case "NothingToRepay":
        return "debt";
      case "CoverLapsed":
        return undefined;
      default:
        return "unknown";
    }
  }
  return undefined;
}

/** True when the cover is active but its prepaid balance ran out. */
export function isOutOfFuel(arm: ArmState, status: ExitStatus, lapsed: boolean): boolean {
  if (lapsed) return true;
  if (arm.kind === "notArmed") return arm.checks.find((c) => !c.ok && c.id !== "warm")?.id === "paid";
  return arm.kind === "blocked" && status === "CoverLapsed";
}

const pct = (bps: number) => `${Math.round(bps) / 100}%`;

export function blockCopy(reason: BlockReason, c: BlockContext): BlockCopy {
  switch (reason) {
    case "allowance":
      return {
        chip: "Approval removed",
        say: `The permission that lets Shield take its slice of your ${c.asset} was removed or is too low.`,
        title: "Allow it again",
        text: "One wallet prompt. The contract only uses it in a rescue, for the repaid amount plus the rescue fee.",
        fix: "approve",
        button: "Approve in wallet",
      };
    case "emode":
      return {
        chip: "eMode",
        say: "Your Aave loan is in eMode. Shield can't step in on eMode loans yet.",
        title: "Leave eMode on Aave",
        text: "Switch eMode off in the Aave app. Shield picks your loan back up in the next block.",
        fix: "openAave",
        button: "Open Aave",
      };
    case "discount":
      return {
        chip: "Price above your max",
        say: `Shield's rescue fee, an owner setting, was raised to ${pct(c.discountBps)}. You agreed to at most ${pct(c.maxDiscountBps)}, so Shield won't step in until you agree to the new fee.`,
        title: `Raise your maximum to ${pct(c.discountBps)}`,
        text: `One wallet prompt. Aave's liquidators take ${c.aaveBonusPct.toFixed(1)}%.`,
        fix: "raiseDiscount",
        button: `Raise to ${pct(c.discountBps)}`,
      };
    case "ltv0": {
      const which = c.ltv0.length ? c.ltv0.join(" and ") : "One of your deposits";
      return {
        chip: "Dead collateral",
        say: `${which} counts for nothing as collateral on Aave, and while it is switched on, Aave won't let anyone move your ${c.asset}.`,
        title: "Switch that deposit off as collateral",
        text: `In the Aave app, turn off "Use as collateral" for ${c.ltv0.length ? which : "it"}. Your ${c.asset} stays where it is.`,
        fix: "openAave",
        button: "Open Aave",
      };
    }
    case "oracle":
      return {
        chip: "Prices disagree",
        say: `Pyth's ${c.asset} price and Aave's are more than ${pct(c.maxGapBps)} apart right now, so Shield waits rather than act on a bad price.`,
        title: "Nothing to do but wait",
        text: "Shield checks again every block and steps in as soon as the two prices agree.",
        fix: "recheck",
        button: "Check again",
      };
    case "stale":
      return {
        chip: "No fresh price",
        say: `Shield needs a fresh Pyth ${c.asset} price and doesn't have one yet.`,
        title: "Nothing to do but wait",
        text: `Pyth sends a new price when ${c.asset} moves and at least every hour. Shield steps in when one arrives.`,
        fix: "recheck",
        button: "Check again",
      };
    case "unreachable":
      return {
        chip: "Can't lift the loan",
        say: `Paying back USDC against your ${c.asset} can't lift your loan back to a health factor of ${c.target.toFixed(2)}, so Shield can't step in.`,
        title: `Add ${c.asset} or pay back some USDC`,
        text: "Do it on Aave, then Shield can step in again.",
        fix: "openAave",
        button: "Open Aave",
      };
    case "asset":
      return {
        chip: "Cover paused",
        say: `Shield has paused cover for ${c.asset} loans.`,
        title: "Fuel still burns while Shield is on",
        text: "Turn Shield off to stop paying, and take back your fuel.",
        fix: "turnOff",
        button: "Turn off",
      };
    case "debt":
      return {
        chip: "No USDC loan",
        say: "Your loan has no USDC debt left, so there is nothing for Shield to pay back.",
        title: "Nothing to protect right now",
        text: "Borrow USDC again on Aave, or turn Shield off and take back your fuel.",
        fix: "turnOff",
        button: "Turn off",
      };
    case "collateral":
      return {
        chip: `No ${c.asset}`,
        say: `There is no ${c.asset} left in your Aave loan for Shield to take.`,
        title: `Supply ${c.asset} on Aave`,
        text: "Or turn Shield off and take back your fuel.",
        fix: "openAave",
        button: "Open Aave",
      };
    default:
      return {
        chip: "Blocked",
        say: "Something on Aave stops Shield from stepping in right now.",
        title: "Check your loan on Aave",
        text: "Stats for nerds below shows every number Shield checks.",
        fix: "openAave",
        button: "Open Aave",
      };
  }
}
