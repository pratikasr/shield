# Shield security notes

What Shield trusts, what it defends against, and how every medium and high static-analysis finding was resolved. Shield is unaudited hackathon code; treat it accordingly.

## Trust model

| Party | Trusted for | Not trusted for |
| --- | --- | --- |
| Aave V3 Pool and its oracle | Health factor, prices, repay, aToken transfers, flash loans | Nothing extra: Shield adds no assumptions beyond Aave's own |
| Pyth (on-chain push feeds, optional Hermes update) | Volatility for the premium; a sanity bound on Aave's price at exit | Deciding whether an exit is allowed: only Aave's HF decides (ADR-006) |
| Owner (Ownable2Step) | Parameters: exit discount (at most 5%), exit buffer, d_min, assets and their k, block time, swapper, slippage and deviation bounds, unwinder | Moving borrower or LP funds: no owner path does |
| Keeper | Liveness: calling reprice and exit on time | Correctness: `exit` and `reprice` are permissionless and every condition is checked on chain |
| Swapper (owner-set) | Executing swaps within the bounds the caller sets | Price: every swap is bounded by Aave's oracle and the slippage setting, and capped at the collateral seized |
| Borrower | Their own approvals and prepayment | |

## What the contracts enforce

- **An exit only helps the borrower's position.** `Executor.exit` reverts unless HF after the exit is above 1.0 and above HF before it (`HealthNotImproved`, `HealthAtOrBelowOne`). Tested by `testFuzz_exit_neverLeavesHfAtOrBelowOne` and the `ExitInvariantTest` handler on a mainnet fork.
- **An exit only happens when it is due and paid for.** The record must be active and not lapsed; Aave's HF must be at or below the trigger; the borrower must not be in eMode; the current exit discount must not exceed the borrower's ceiling; a fresh Pyth price (within `exitMaxPriceAge`) with a confidence interval inside the deviation bound must agree with Aave's price within `maxOracleDeviationBps`.
- **The aToken allowance is used once, after the repay.** `_repayAndSeize` repays first, then moves exactly the computed collateral to the vault or the Executor; it is reachable only from `exit` (vault funding) and from `executeOperation` (flash loan) behind `nonReentrant`.
- **The flash-loan callback cannot be driven from outside.** `executeOperation` requires `msg.sender == POOL`, `initiator == this` and a transient in-flight flag set by `exit` (`test_executeOperation_rejectsDirectCall`, `test_executeOperation_rejectsForeignInitiator`).
- **Re-entrancy.** `exit`, `reprice`, `repriceMany`, `settleForExit`, `topUp`, `withdrawUnused`, `sweep` and `unwind` use OpenZeppelin `ReentrancyGuardTransient`; a swapper that calls back into `exit` reverts (`test_reentrancy_throughSwapperIsBlocked`).
- **Money is conserved.** The Repricer holds exactly the prepaid balances plus premium not yet swept, and every unit charged reaches the vault (`AccountingInvariantTest`, 5,120 random calls).
- **The vault values only what it holds.** NAV is idle USDC, seized aTokens at Aave's oracle and premium accrued at the Repricer. A 6-decimal virtual share offset makes a first-depositor inflation attack uneconomic (`test_inflationAttack_uneconomic`). Withdrawals are capped by liquid USDC.
- **Premium cannot be over-charged by choosing when to reprice.** Accrual uses the rate stored at the previous reprice for every block since; nobody can pick a past rate. A restored cover restarts the accrual clock, so unprotected blocks are never billed.
- **Parameters are bounded.** Trigger 1.01 to 2.00; exit discount 0.01% to 5%; buffer 0.01 to 0.50; d_min 0.001 to 0.2; slippage at most 10%; deviation 0.01% to 20%; price age 10 s to 1 day; block time 100 ms to 15 s.

## Known limits

- The keeper is best effort. If nobody calls `exit` before Aave's liquidators act below 1.00, the borrower is liquidated as usual; Shield's trigger sits above 1.00 for this reason.
- A sharp price jump can cross the trigger and Aave's liquidation line in one block. The web app asks for an acknowledgement for triggers at 1.02 or below.
- The flash-loan path sells seized collateral on Uniswap V3 Monad, whose WETH/USDC pool is thin (2.2 WETH on 5 Oct 2026). Slippage up to `maxSwapSlippageBps` (3%) comes out of the LPs' discount, and a market that cannot fill within the bound makes the exit revert.
- Seized collateral is valued at Aave's oracle until it is unwound; LPs carry its price risk in between.
- Hermes needs an API key since 26 Aug 2026; without one the contracts rely on Pyth's push feeds, which refresh on a 0.02% move or every hour.

## Static analysis

Run on 5 Oct 2026 against `contracts/src` with Slither 0.11.6 (`slither . --filter-paths "lib/|test/|script/" --exclude-informational --exclude-optimization`) and Aderyn 0.6.8 (`aderyn . --src src`). Results after the fixes below are in [TEST-REPORT.md](TEST-REPORT.md).

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
| Slither `divide-before-multiply` (medium) | `Repricer.sweep` | Intentional: the amount is floored to whole USDC units and the remainder kept in 18-decimal units for the next sweep. Nothing is lost (`invariant_conservation`). |
| Slither `incorrect-equality` (medium, 5) | `exit`, `_charge`, `_repayAndSeize`, `_plan`, `totalAssets` | Each compares values the contract computed itself (a funding split, a capped balance, Aave's returned repay amount, zero guards), not balances an attacker can nudge to block a code path. A donation to the vault only raises `totalAssets`. |
| Slither `pyth-unchecked-publishtime` (medium, 2) | `_checkPyth`, `_sample` | `_checkPyth` does check it (`publishTime + exitMaxPriceAge < block.timestamp` returns `PythStale`); Slither does not recognise the form. `_sample` only records a price whose publish time is newer than the window's newest, so a stale price adds no observation. |
| Slither `unused-return` (medium, 6) | `getUserAccountData` destructuring; `ShieldVault._sweepPremium` | Only the fields used (debt, HF) are read from Aave's tuple; the sweep's returned amount is already emitted by the Repricer and counted through `notifyPremium`. |
| Aderyn H-1 "ETH transferred without address checks" | `Repricer.reprice`, `repriceMany`, `Executor.exit` | The only ETH sent is the refund of the caller's own excess `msg.value` over the Pyth update fee, to `msg.sender`. |
| Aderyn H-2 "state change after external call" | `Executor` and `Repricer` constructors | Constructor reads of the Aave addresses provider and the asset's decimals; a contract under construction cannot be re-entered. |
| Slither `calls-loop` (low), Aderyn L-2 | `repriceMany`, `totalAssets` | Loops over the caller's own borrower list (a long list only costs the caller) and the owner's short asset list (two assets at launch). |
| Aderyn L-1 centralisation | Owner setters | Owner controls bounded parameters only, never funds; ownership transfer is two-step. |
| Slither `timestamp` (low) | `_checkPyth` | Comparing Pyth's publish time with the block time is the point of the staleness check; a few seconds of validator skew does not matter against a one-hour bound. |
| Slither `missing-zero-check` (low), Aderyn L-6 | `setUnwinder` | Setting the unwinder to zero disables unwinding by anyone but the owner, which is a valid choice. |
