import { BaseError, ContractFunctionRevertedError, formatUnits } from "viem";
import { EXIT_STATUS, exitStatusMessage } from "./exit-status";
import { firstLine, formatUsd } from "./format";

export interface ErrorContext {
  symbol?: string;
  priceName?: string;
}

const usdc6 = (v: unknown) => formatUsd(Number(formatUnits(BigInt(String(v ?? 0)), 6)));

/** A decoded custom error, by name, as one sentence that names the fix. */
function explainRevert(name: string, args: readonly unknown[] | undefined, ctx: ErrorContext): string | undefined {
  const a = args ?? [];
  const symbol = ctx.symbol ?? "WETH";
  switch (name) {
    case "PrepayTooLow":
      return "Opt-in needs at least 1 USDC prepaid. Prepay more, then opt in.";
    case "TriggerOutOfRange":
      return "The trigger must be between 1.01 and 2.00.";
    case "MaxDiscountOutOfRange":
      return `The maximum discount must be between ${Number(a[1] ?? 100) / 100}% and 5%.`;
    case "AlreadyActive":
      return "This wallet already has active cover. Opt out first to start a new one.";
    case "NotActive":
      return "This wallet has no active cover. Opt in first.";
    case "AssetNotEnabled":
      return "Shield does not cover this collateral right now. Supply WETH on Aave to be covered.";
    case "InsufficientPrepaid":
      return `Only ${usdc6(a[1])} is withdrawable after the premium owed so far. Lower the amount or use Max.`;
    case "ZeroAmount":
      return "Enter more than 0.";
    case "ERC4626ExceededMaxWithdraw":
    case "ERC4626ExceededMaxRedeem":
      return "That is more than the vault can pay out now: collateral from exits must be sold before it can be withdrawn. Lower the amount or use Max.";
    case "ERC4626ExceededMaxDeposit":
    case "ERC4626ExceededMaxMint":
      return "The vault takes deposits only from accounts on its depositor list; at launch that is the protocol treasury alone.";
    case "NotTopUpAgent":
      return "The Repricer does not accept top-ups from the deposit-address contract yet. The owner must set it as the top-up agent.";
    case "ZeroBorrower":
      return "No borrower address was given for the sweep.";
    case "InsufficientLiquidity":
      return "The vault does not hold enough USDC for this right now.";
    case "ExitBlocked": {
      const status = EXIT_STATUS[Number(a[0] ?? 1)] ?? "NotActive";
      const m = exitStatusMessage(status, { symbol, priceName: ctx.priceName ?? "ETH" });
      return `The exit cannot run: ${m.body.charAt(0).toLowerCase()}${m.body.slice(1)}`;
    }
    case "HealthAtOrBelowOne":
    case "HealthNotImproved":
      return "The exit would not leave the health factor above 1.00 and above where it started, so it reverted. Nothing changed.";
    case "VaultWouldLose":
      return "Funding this exit with a flash loan would cost the vault more than it put in, so it reverted. Nothing changed.";
    case "SwapShortfall":
      return "The collateral sale for the flash loan came in short, so the exit reverted. Nothing changed.";
    case "NoSwapper":
      return "The vault cannot fund this exit alone and no swap route is set for a flash loan, so it reverted.";
    case "ERC20InsufficientAllowance":
      return "The approval is missing or too low. Run the approval step again.";
    case "ERC20InsufficientBalance":
      return "The amount is more than this wallet holds. Lower it and retry.";
    case "SafeERC20FailedOperation":
      return "A token transfer failed. Check the approval and the balance, then retry.";
    case "HealthFactorLowerThanLiquidationThreshold":
      return "Aave refused the collateral transfer because it would leave the health factor below 1.00.";
    case "LtvValidationFailed":
    case "UserHasAssetWithZeroLtv":
      return `Aave refused to move your a${symbol} because the position has LTV-0 collateral enabled. Withdraw or disable it on Aave.`;
    case "ReservePaused":
    case "ReserveFrozen":
      return "Aave has paused or frozen this market, so the transaction cannot run now.";
    case "NotEnoughAvailableUserBalance":
      return "Aave does not hold enough of this balance for the transfer.";
    case "InsufficientUpdateFee":
      return "The Pyth update fee was not covered. Retry without a price update.";
    default:
      return undefined;
  }
}

/** Turns wallet, RPC and contract errors into one sentence that names the fix. */
export function explainError(err: unknown, ctx: ErrorContext = {}): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name) {
        const known = explainRevert(name, revert.data?.args, ctx);
        if (known) return known;
        if (name === "Error" && revert.reason) return explainText(revert.reason);
        return `The contract refused the transaction (${name}).`;
      }
      if (revert.reason) return explainText(revert.reason);
      if (revert.signature) return `The transaction would revert (error ${revert.signature}). Nothing was sent.`;
    }
  }
  const msg = err instanceof BaseError ? err.shortMessage : String((err as Error)?.message ?? err);
  return explainText(msg);
}

/** Wallet and RPC messages, by pattern. Allowance before balance: "transfer amount exceeds allowance" is an allowance. */
function explainText(msg: string): string {
  if (/user rejected|user denied|denied transaction|rejected the request/i.test(msg)) return "You rejected the request in your wallet. Try again when ready.";
  if (/insufficient funds/i.test(msg)) return "Not enough MON for gas. Add MON to this wallet and retry.";
  if (/allowance/i.test(msg)) return "The approval is missing or too low. Run the approval step again.";
  if (/exceeds balance|transfer amount exceeds|insufficient balance/i.test(msg)) return "The amount is more than this wallet holds. Lower it and retry.";
  if (/chain.*does not match|does not match.*chain|chain mismatch|switch.*network|wrong network/i.test(msg)) return "Your wallet is on another network. Switch to Monad and retry.";
  if (/HTTP request failed|fetch failed|Failed to fetch|timed? ?out|took too long/i.test(msg)) return "The Monad RPC did not answer. Check your connection and retry.";
  const line = firstLine(msg);
  if (!line) return "Something went wrong. Retry.";
  return line.length > 160 ? `${line.slice(0, 157).trimEnd()}...` : `${line}.`;
}
