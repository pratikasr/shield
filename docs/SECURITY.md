# Shield security notes

What Shield trusts, what it defends against, and how every medium and high static-analysis finding was resolved. Shield has had no external audit; it is hackathon code. Treat it accordingly.

## Trust model

| Party | Trusted for | Not trusted for |
| --- | --- | --- |
| Aave V3 Pool and its oracle | Health factor, prices, repay, aToken transfers, flash loans | Nothing extra: Shield adds no assumptions beyond Aave's own. Aave governance can still block exits (for example by setting a collateral's LTV to 0 or freezing WETH), and premium keeps accruing while it does |
| Pyth (on-chain push feeds, optional Hermes update) | Volatility for the premium; a sanity bound on Aave's price at exit | Deciding whether an exit is allowed: only Aave's HF decides (ADR-006) |
| Owner (Ownable2Step, not upgradeable) | Parameters within fixed bounds: exit discount (at most 5%, and never above a borrower's own maximum), exit buffer, d_min, each asset's k (at most 0.0125, ten times launch) and fallback volatility (10% to 500%), Pyth feed id, block time (100 to 2,000 ms), waiting period (up to 7 days), slippage (at most 10%) and oracle bounds, the swap adapter, the unwinder, the protocol share of premiums (at most 20%) and the treasury that receives it | Direct transfers of borrower or LP funds: no owner function moves aTokens, USDC or prepaid balances. Within the bounds above the owner can raise premiums (up to ten times the launch k), can move up to 20% of each future premium from liquidity providers to the treasury (never premium already charged, never the exit discount, and never more than the borrower is billed) and can pause exits (for example a discount above borrowers' maximum or a 7-day waiting period); the swap adapter the owner chooses decides how well seized collateral sells, within the slippage bound, and every sale is checked by the USDC actually received |
| Keeper | Liveness: calling reprice and exit on time | Correctness: `exit` and `reprice` are permissionless and every condition is checked on chain |
| Unwinder (the keeper's address) | Choosing when to sell seized collateral | Price: a sale must return at least Aave's price less the slippage bound (3% by default), measured by balance |
| Swap adapter (owner-set) | Executing swaps | Price and payment: the Executor and the vault measure what they actually receive; a swap that reports a fill without paying makes the call revert |
| Borrower | Their own approvals and prepayment | |

## What the contracts enforce

- **An exit only helps the borrower's position.** `Executor.exit` reverts unless HF after the exit is above 1.0 and above HF before it (`HealthNotImproved`, `HealthAtOrBelowOne`). Tested by `testFuzz_exit_neverLeavesHfAtOrBelowOne` and the `ExitInvariantTest` handler on a mainnet fork.
- **An exit only happens when it is due, paid for and not bought at the last moment.**
  - The record must be active and not lapsed, including after the final premium settlement (`test_L2_exitRefusedWhenSettlementLapsesCover`).
  - Cover must have been held for `minCoverSeconds` (15 minutes at launch) since opt-in, since a top-up that restored a lapsed cover, or since a trigger raise (`test_H1_exitRefusedDuringWaitingPeriod`, `test_H1_dustRestoreAtTheMomentOfNeed_isRefused`).
  - Aave's HF must be at or below the trigger, the borrower must not be in eMode, and the current exit discount must not exceed the borrower's ceiling.
  - A Pyth price no older than `exitMaxPriceAge` (1 hour), with a confidence interval inside the deviation bound, must agree with Aave's price within `maxOracleDeviationBps` (2%).
- **The aToken allowance is used once, after the repay.** `_repayAndSeize` repays first, then moves exactly the computed collateral (the repaid value plus the borrower's accepted discount) to the vault or the Executor; it is reachable only from `exit` (vault funding) and from `executeOperation` (flash loan) behind `nonReentrant`.
- **The flash-loan callback cannot be driven from outside.** `executeOperation` requires `msg.sender == POOL`, `initiator == this` and a transient in-flight flag set by `exit` (`test_executeOperation_rejectsDirectCall`, `test_executeOperation_rejectsForeignInitiator`).
- **Swaps are trusted by balance, not by return value.** The flash path checks that the USDC it needed arrived (`SwapShortfall`) and re-supplies whatever collateral is left; the vault's unwind checks the USDC it received against the oracle floor and re-supplies unsold collateral (`test_F1_*`).
- **LPs never lose on a flash-assisted exit at oracle prices.** A flash-funded exit reverts unless the collateral and USDC the vault keeps are worth at least what the vault paid (`VaultWouldLose`, `test_F2_*`).
- **Exit gains cannot be sniped.** An exit's gain reaches the share price linearly over six hours, so a deposit, exit and redeem in one transaction earns nothing of it (`test_F3_*`).
- **Re-entrancy.** `exit`, `reprice`, `repriceMany`, `settleForExit`, `settleForOptOut`, `topUp`, `withdrawUnused`, `sweep` and `unwind` use OpenZeppelin `ReentrancyGuardTransient`; a swapper that calls back into `exit` reverts (`test_reentrancy_throughSwapperIsBlocked`).
- **Money is conserved.** The Repricer holds exactly the prepaid balances plus premium not yet swept, and every unit charged reaches the vault or, for the protocol share, the treasury; the treasury never receives more than the share of what was charged (`AccountingInvariantTest`, `testFuzz_protocolShare_conservesEveryCharge`). A change of share applies only to later charges (`test_protocolShare_changeAppliesOnlyToLaterCharges`). The treasury is paid by its own `sweepProtocol`, never inside the vault's sweep, so a treasury that cannot receive USDC cannot block withdrawals or exits (`test_protocolShare_failingTreasuryNeverBlocksTheVault`).
- **The premium cannot be dodged.**
  - Each interval is billed at the higher of the rate stored at the previous reprice and the live rate, so a reprice from a momentarily improved position discounts nothing (`test_reprice_selfRepriceFromImprovedState_doesNotDiscount`).
  - A position at or below its trigger pays the floor rate, the highest, never zero (`test_reprice_atOrBelowTrigger_paysTheFloorRate`).
  - Opting out settles the blocks since the last reprice (`test_optOut_settlesFirst`).
  - A restored cover restarts the accrual clock, so unprotected blocks are never billed.
- **The volatility window cannot be bricked.** Each squared return is capped at a 100% move and prices are stored at a fixed 8-decimal scale, so a bad print or a change of Pyth exponent neither saturates nor distorts the window (`test_volWindow_*`).
- **Dust cannot crowd the keeper.** Opting in needs a 1 USDC prepaid balance.
- **The vault values only what it holds.** NAV is idle USDC, seized aTokens at Aave's oracle and premium accrued at the Repricer, less exit gains still unlocking. A 6-decimal virtual share offset makes a first-depositor inflation attack uneconomic (`test_inflationAttack_uneconomic`). Withdrawals are capped by liquid USDC.
- **Parameters are bounded.**
  - Trigger 1.01 to 2.00.
  - Exit discount 0.01% to 5%.
  - Buffer 0.01 to 0.50.
  - d_min 0.001 to 0.2.
  - k at most 0.0125; fallback volatility 10% to 500%.
  - Waiting period at most 7 days.
  - Slippage at most 10%; deviation 0.01% to 20%.
  - Price age 10 s to 1 day.
  - Block time 100 ms to 2 s.
  - Protocol share of premiums at most 20%, always with a non-zero treasury (`test_setProtocolShare_boundsAndEvent`).

## Known limits

- **The keeper is best effort.** If nobody calls `exit` before Aave's liquidators act below 1.00, the borrower is liquidated as usual. Shield's trigger sits above 1.00 for this reason, and anyone may call `exit`.
- **A sharp price jump can cross the trigger and Aave's liquidation line in one block.** The web app asks for an acknowledgement for triggers at 1.02 or below.
- **The flash-loan path fits small exits only.** It sells seized collateral through one Uniswap V3 WETH/USDC pool (about 2.25 WETH deep on 5 Oct 2026) within the slippage bound, and must leave the vault whole. Larger exits need vault liquidity, or they revert and the position stays as it was. There is no cbBTC/USDC pool, which is why cbBTC is disabled.
- **LPs carry the price risk of seized collateral until it is unwound.** It is valued at Aave's oracle with no haircut. LPs who withdraw idle USDC first leave the remaining LPs holding that collateral and its price risk, and selling it can cost more than the 1% discount when liquidity is thin.
- **Premium that accrues before the first LP deposit has no claimant.** The runbook seeds the vault before any opt-in.
- **Pyth push feeds.** Hermes needs an API key since 26 Aug 2026. Without one the contracts rely on Pyth's push feeds, which refresh on a 0.02% move or every hour, so the 2% oracle check can compare against a price up to an hour old.
- **Sigma is a short-horizon measure.** At keeper cadence the 200-sample window spans minutes, so a single sharp candle moves the premium a lot until it leaves the window.

## Audit, 5 Oct 2026

An internal audit by six parallel reviewers (contracts security, contracts correctness, keeper, indexer and scripts, web code, live QA, claims) found the issues fixed above, among others. Every finding, its status and its regression test are in [AUDIT.md](AUDIT.md). It was not an external audit.

## Static analysis

Run on 5 Oct 2026 against `contracts/src` with Slither 0.11.6 (`slither . --filter-paths "lib/|test/|script/" --exclude-informational --exclude-optimization`) and Aderyn 0.6.8 (`aderyn . --src src`).

| Run | Slither high | Slither medium | Aderyn high |
| --- | --- | --- | --- |
| Before fixes | 5 | 22 | 3 |
| After fixes | 5 (all justified below) | 16 (all justified below) | 2 (both justified below) |
| After the audit fixes (rerun the same day) | 8 (all justified below) | 18 (all justified below) | 2 (both justified below) |
| After the protocol share (ADR-037, rerun the same day) | 8 (all justified below) | 19 (all justified below; the new one is `divide-before-multiply` in `Repricer.sweepProtocol`) | 2 (the same two, both justified below) |

Slither still lists `pyth-unchecked-confidence` after the fix because both checks run on a local copy of the `try ... returns (price)` value, which its detector does not follow. The checks are at `Executor._checkPyth` (confidence against the deviation bound) and `Repricer._sample` (confidence under 1% of price), each with a regression test.

### Fixed

| Tool, finding | Where | Fix |
| --- | --- | --- |
| Slither `pyth-unchecked-confidence` (medium) | `Executor._checkPyth` | An exit is refused (`OracleDeviation`) when Pyth's confidence interval is wider than the deviation bound; regression test `test_exit_revertsOnWidePythConfidence` |
| Slither `pyth-unchecked-confidence` (medium) | `Repricer._sample` | Observations with confidence wider than 1% of price are skipped; regression test `test_sample_skipsLowConfidencePrice` |
| Slither `uninitialized-local` (medium, 6) | Repricer, Executor | Zero initialisation made explicit |
| Aderyn H-3 unsafe casting | `Repricer._charge`, `topUp`, `withdrawUnused` | OpenZeppelin `SafeCast` on every downcast written to the registry |

### Justified

| Tool, finding | Where | Why it is safe |
| --- | --- | --- |
| Slither `arbitrary-send-erc20` (high) | `Executor._repayAndSeize` | The `from` is the borrower, who opted in and approved the Executor for exactly this. The call is reachable only inside `exit` after every condition above has passed and after the borrower's debt was repaid in the same transaction; the recipient is the vault or the Executor itself. |
| Slither `reentrancy-balance` (high, 4) | `Executor.exit` | The "stale" value is the borrower's HF before the exit, read on purpose so the post-exit check can compare against it. `exit` is `nonReentrant`, and the external calls go to Aave, the vault and the owner-set swapper, none of which can reach a Shield state change without hitting the guard (tested with a re-entering swapper). |
| Slither `reentrancy-balance` (high, 3 added by the audit fixes) | `Executor._sellForShortfall`, `ShieldVault.unwind`, `Executor.exit` | Intentional: since the audit (F1) both swap paths read the balance before and after the adapter's swap and trust only the difference. Both run inside `nonReentrant` functions (`exit`, `unwind`), and an adapter that re-enters reverts (`test_reentrancy_throughSwapperIsBlocked`). |
| Slither `unused-return` (medium, 2 added by the audit fixes) | `swapper.swapExactIn` in `unwind`, `swapper.swapExactOut` in `_sellForShortfall` | Intentional: the adapter's returned amount is not trusted (F1); the amounts come from balance differences (`test_F1_*`). |
| Slither `divide-before-multiply` (medium) | `Repricer.sweep`, `Repricer.sweepProtocol` | Intentional: the amount is floored to whole USDC units and the remainder kept in 18-decimal units for the next sweep. Nothing is lost (`invariant_conservation`). |
| Slither `incorrect-equality` (medium, 5) | `exit`, `_charge`, `_repayAndSeize`, `_plan`, `totalAssets` | Each compares values the contract computed itself (a funding split, a capped balance, Aave's returned repay amount, zero guards), not balances an attacker can nudge to block a code path. A donation to the vault only raises `totalAssets`. |
| Slither `pyth-unchecked-publishtime` (medium, 2) | `_checkPyth`, `_sample` | `_checkPyth` does check it (`publishTime + exitMaxPriceAge < block.timestamp` returns `PythStale`); Slither does not recognise the form. `_sample` only records a price whose publish time is newer than the window's newest, so a stale price adds no observation. |
| Slither `unused-return` (medium, 6) | `getUserAccountData` destructuring; `ShieldVault._sweepPremium` | Only the fields used (debt, HF) are read from Aave's tuple; the sweep's returned amount is already emitted by the Repricer and counted through `notifyPremium`. |
| Aderyn H-1 "ETH transferred without address checks" | `Repricer.reprice`, `repriceMany`, `Executor.exit` | The only ETH sent is the refund of the caller's own excess `msg.value` over the Pyth update fee, to `msg.sender`. |
| Aderyn H-2 "state change after external call" | `Executor` and `Repricer` constructors | Constructor reads of the Aave addresses provider and the asset's decimals; a contract under construction cannot be re-entered. |
| Slither `calls-loop` (low), Aderyn L-2 | `repriceMany`, `totalAssets` | Loops over the caller's own borrower list (a long list only costs the caller) and the owner's short asset list (two assets at launch). |
| Aderyn L-1 centralisation | Owner setters | Every owner parameter is bounded (see the trust model); no owner function transfers funds; ownership transfer is two-step. The owner's real powers are listed in the trust model. |
| Slither `timestamp` (low) | `_checkPyth` | Comparing Pyth's publish time with the block time is the point of the staleness check; a few seconds of validator skew does not matter against a one-hour bound. |
| Slither `missing-zero-check` (low), Aderyn L-6 | `setUnwinder` | Setting the unwinder to zero disables unwinding by anyone but the owner, which is a valid choice. |
