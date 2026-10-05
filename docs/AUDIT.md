# Shield internal audit, 5 Oct 2026

An internal review before the Monad mainnet deployment. It is not an external audit. Six reviewers worked in parallel, each with a narrow brief, and every non-trivial finding had to come with a proof: a failing test, a code citation, a screenshot or a live source.

| Reviewer | Scope | Evidence |
| --- | --- | --- |
| Contracts, security | Executor, swap adapter, vault as the exit's counterparty; attacker, owner and keeper threat models | Foundry proofs of concept on a Monad mainnet fork |
| Contracts, correctness | Repricer, PositionRegistry, ShieldVault, PremiumMath, deploy scripts; accounting, rounding, edge cases | Unit and fork proofs of concept |
| Keeper, indexer, scripts | Failure modes, nonce and gas handling, latency, secrets, mainnet safety of every script | Vitest proofs, live read-only mainnet checks |
| Web code | Input parsing, transaction state, numbers, data freshness, security, copy against contract guarantees | Code citations, scripted checks of pure functions |
| Live QA | Every happy and bad path in a browser against the full local stack | Screenshots and on-chain receipts |
| Claims | Every number and statement in the README, docs and website against code, tests and live sources | Code lines, test output, sources with dates |

Severity follows impact on users' funds first, then on what users are told, then on operations. "Fixed" means the change is merged with a regression test that failed before the fix.

## Contracts

| ID | Severity | Finding | Status | Regression test |
| --- | --- | --- | --- | --- |
| F1 | High | The vault's unwind trusted the number the swap adapter returned, not the USDC received; an owner-set adapter could take all seized collateral and pay nothing. The flash path had the same pattern | Fixed: both paths measure balances and re-supply unsold collateral (ADR-028) | `test_F1_unwind_revertsWhenSwapperDoesNotPay`, `test_F1_unwind_resuppliesUnsoldCollateral`, `test_F1_flashExit_revertsWhenSwapperDoesNotPay` |
| H-1 | High | Cover could be bought at the moment of need: a lapsed record restored with 0.000001 USDC, or a fresh opt-in with a trigger above HF, exited in the same block for no premium | Fixed: a waiting period (`minCoverSeconds`, 900 s) after opt-in, restore or trigger raise; at or below the trigger the floor rate applies (ADR-031) | `test_H1_exitRefusedDuringWaitingPeriod`, `test_H1_dustRestoreAtTheMomentOfNeed_isRefused`, `test_H1_triggerAboveHf_paysTheFloorRate`, `test_reprice_atOrBelowTrigger_paysTheFloorRate` |
| F2 | High to medium | A mostly flash-funded exit could spend the vault's whole contribution on a fill at the price bound; the "LP loss capped at slippage" claim in ADR-018 was false | Fixed: a flash-assisted exit reverts unless the vault gets back at least what it paid (ADR-029) | `test_F2_flashExit_revertsWhenVaultWouldLose`, `test_F2_flashExit_fairFillStillRuns` |
| F3, M-1 | Medium | A deposit, permissionless exit and redeem in one transaction (with a free Morpho flash loan) took about 98% of the exit discount from the LPs | Fixed: exit gains unlock into the share price over six hours (ADR-030) | `test_F3_jitDepositAroundExit_capturesNothing`, `test_F3_profitUnlocksLinearly` |
| M-2 | Medium | `optOut` did not settle accrued premium; opt-out and opt-in cycling evaded all premium | Fixed: opt-out settles first; the waiting period makes cycling useless (ADR-032) | `test_optOut_settlesFirst` |
| M-3 | Medium | A borrower could improve their position for one transaction, reprice, and have the next interval billed at that low rate | Fixed: each interval is billed at the higher of the stored and live rate (ADR-032) | `test_reprice_selfRepriceFromImprovedState_doesNotDiscount`, `test_reprice_billsHigherOfStoredAndLiveRate` |
| M-4 | Medium | Free dust opt-ins could push the keeper's single batch past its gas ceiling and freeze repricing for everyone | Fixed in the contracts: opt-in needs 1 USDC prepaid. Keeper side: see below | `test_optIn_revertsWithoutMinimumPrepay` |
| M-5 | Medium | cbBTC was enabled, but Monad has no cbBTC/USDC swap route: its flash fallback always reverts and seized cbBTC can never be sold | Fixed: cbBTC listed but disabled at deploy (ADR-034) | Deployment config; verified with `getPool` on chain |
| L2, L-5 | Low | An exit still ran when its own premium settlement emptied the prepaid balance | Fixed: the record is re-read after settlement | `test_L2_exitRefusedWhenSettlementLapsesCover` |
| L-1 | Low | One bad Pyth print saturated the volatility sum; 200 observations later every reprice and exit for that feed reverted | Fixed: squared returns capped at a 100% move (ADR-033) | `test_volWindow_badPrintDoesNotBrickTheFeed`, `test_squaredReturn_cappedAtOneHundredPercent` |
| L-2 | Low | A change of Pyth exponent read as a 100x move | Fixed: prices stored at a fixed 8-decimal scale | `test_volWindow_expoChangeIsNotAMove` |
| L-3 | Low | The owner's `k` and fallback volatility had no upper bound, so prepaid balances could be repriced into the vault within minutes; block time allowed 15 s | Fixed: k at most 0.0125, fallback 10% to 500%, block time 100 to 2,000 ms | `test_setAsset_boundsKAndFallbackSigma` |
| L-4 | Low | The average-discount statistic counted flash-assisted exits and reported 1106 bps for a 100 bps exit | Fixed: only vault-only exits count | Unit tests in `ShieldVault.t.sol` |
| Info | Info | `activeBorrowers(offset, huge limit)` overflowed | Fixed | `test_activeBorrowers_hugeLimit` |
| L1 (security) | Low | Seized collateral is valued at Aave's oracle with no haircut: the first LPs to withdraw take USDC and the last hold the collateral's price risk | Accepted and disclosed in SECURITY.md (Known limits); the profit unlock removes the timing game around exits | |
| L3 (security) | Low | With push feeds only, the 2% Aave-against-Pyth check can compare with a price up to an hour old | Accepted and disclosed; push feeds update on a 0.02% move, so an hour-old price means a quiet market | |
| L4 (security) | Low | Aave governance can block exits (LTV 0, frozen reserve) while premium accrues | Accepted and disclosed in the trust model; the web app's protection check flags LTV-0 collateral | |
| L5 (security) | Low | The unwinder (the keeper's hot key) can sell at up to the slippage bound below the oracle | Accepted: bounded by balance-checked swaps (F1) and the 3% bound; disclosed | |
| Info | Info | Premium accrued before the first LP deposit has no claimant | Disclosed; the runbook seeds the vault before any opt-in | |
| Info | Info | At keeper cadence the volatility window spans minutes, so one sharp candle moves the premium a lot | Disclosed in SECURITY.md (Known limits) | |
| Info | Info | Charging assumes 300 ms blocks against a measured 304 ms (borrowers pay about 1.3% less) | Accepted | |

Owner powers, stated exactly (the old "no owner path moves funds" was wrong): the owner cannot transfer aTokens, USDC or prepaid balances, and the contracts are not upgradeable. Within fixed bounds the owner can raise premiums, pause exits, and choose the swap adapter that sells seized collateral. Every sale is checked by the USDC actually received against Aave's price less at most 10%. The full table is in [SECURITY.md](SECURITY.md).

## Claims

| # | Claim (where) | What was true | Status |
| --- | --- | --- | --- |
| 1 | "No owner function can move borrower or vault funds" (FAQ, SECURITY.md) | False as written: an owner-set adapter could take seized collateral (F1) and an unbounded k could reprice prepaid balances away (L-3) | Contracts fixed; trust model and FAQ rewritten with the owner's real powers |
| 2 | WETH and cbBTC are illiquid on Monad: 1 WETH sells 3.8% under the oracle (README, SPEC, ADRs, site) | True only for one thin Uniswap V3 pool; an aggregator quoted 0.06% for 1 WETH and 0.49% for 50 WETH | Repositioned (ADR-035): an on-chain exit at a set HF, for large positions and thin moments |
| 3 | DeFi Saver costs "about 0.08% plus slippage" | 0.25% service fee plus 0.05% automation fee per repay, plus gas and slippage | Corrected in the README, SPEC and site |
| 3b | Euler: "a discount that rises over time" | It rises as health worsens | Corrected |
| 4 | "Protected" shown, and "revoking disarms the cover" | The UI showed Protected while an exit could not run (approval revoked, eMode, oracle gap) and premium kept accruing | Web fix (see below); copy says premium accrues until opt-out |
| 5 | cbBTC covered | No swap route; never fork-tested | cbBTC disabled; docs say so |
| 6 | Savings figures (calculator, comparison line, "penalty avoided") | Three different definitions; the calculator's premium line used d = 0.20 for a position at d = 0.02 | One labelled definition everywhere (web) |
| 7 | "An exit would land minutes late" on a 12-second chain; "receipts in about 300 ms" | Up to 12 s; 290 ms was measured on a local fork, not mainnet | Reworded |
| 8 | "63% less gas" credited to Shield's storage layout | The access list mostly warms Aave's and the tokens' pages | Reworded with the attribution |
| 9 | "eMode's liquidation penalty on Monad is 1%" | Monad eMode bonuses are 1% to 4%; no category uses WETH or cbBTC as collateral | Reworded: Shield covers positions outside eMode only |
| 10 | Flash fallback "independent of LP capital" | Fits small exits only on a 2.25 WETH pool | Reworded; the runbook seeds the vault |
| 11 | Collateral "sold back to USDC within a bounded price range" | Only the owner or unwinder sells it, at up to 3% (owner maximum 10%) under the oracle | Reworded |
| 12 | "101 tests against real Aave" | 72 unit (mocks) and 29 fork | Counts restated by kind |
| 13 | Invariant "across random price moves and borrowing" | The handler did no borrowing | Reworded |
| 14 | SPEC stale lines (5% penalty, Morpho only on Ethereum and Base, function names, $412 / $83 / $329 example, unwind immediately) | Out of date | SPEC corrected with notes |
| 15 | "V is the debt covered" | V is the borrower's total Aave debt | Corrected |
| 16 | Smaller items: "8,500 MON a day" (7,200), Envio prize text, stale VERIFY markers, "100,000 blocks of state" (500,000 served), "checks every on-screen claim", track name, "pending" tag | Corrected in the docs |

Claims verified as true are listed in the reviewer's report: test counts at the time, gas figures against the snapshots, the k calibration, every external Aave, Pyth, Monad, Morpho, Euler and Envio fact, and the runbook arithmetic.
