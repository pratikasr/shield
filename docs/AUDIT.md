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

**Result.** The review found 1 critical, 15 high and 36 medium issues, plus lows and informational notes, and 16 inaccurate claims:

- **Contracts:** 3 high, 5 medium.
- **Keeper, indexer and scripts:** 6 high, 14 medium.
- **Web app:** 1 critical, 6 high, 17 medium.

Every critical, high and medium issue is fixed (what "fixed" means is defined below). The low issues not fixed are accepted and disclosed below and in [SECURITY.md](SECURITY.md).

After the fixes:

- **Contracts:** 122 tests pass (82 unit, fuzz and invariant; 40 fork tests against real Aave on Monad).
- **Keeper:** 81 tests pass.
- **Indexer:** 5 tests pass.
- **Static analysis:** Slither and Aderyn were rerun, and every high and medium finding is fixed or justified.
- **End to end:** the video-script test passes against the full stack on two fresh forks.
- **Mainnet runbook:** the scripted flow (deploy, seed, open, keeper, nudge, exit, `proof.sh`) passes on a fresh fork after the script changes ([DEMO.md](DEMO.md), run 4).
- **Web:** Lighthouse (mobile) landing 97, borrower 92, LP 91 for performance, 100 for accessibility and best practices, CLS 0; 48 review captures in [screenshots/pass-4](screenshots/pass-4/).

Severity follows impact on users' funds first, then on what users are told, then on operations. "Fixed" means the change is merged. Contract and keeper fixes each carry a regression test; web fixes were rechecked in a browser against the full local stack; document fixes are the corrected text.

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

## Keeper, indexer and scripts

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| K-H1 | High | `stack.sh down` and `e2e.sh` pattern-killed any `tsx ... src/index.ts` on the machine, including a mainnet keeper started with `demo-position.sh keeper` | Fixed: PID files with start times; only processes the stack started are stopped |
| K-H2 | High | On Monad every reverted receipt reports gas used equal to the limit, so every revert counted as out of gas and ratcheted the buffer until exits exceeded `MAX_GAS_EXIT` and were refused | Fixed: out of gas only when an `eth_call` replay at the same limit runs out; the exit ceiling ignores the extra buffer |
| K-H3 | High | Defaults repriced every block forever (about 7,200 MON a day) with no reserve for exits | Fixed: 600-block window, then every 200 blocks; reprices stop below `MIN_BALANCE_FOR_EXIT_WEI` (0.2 MON) while exits continue (ADR-036) |
| K-H4 | High | Lapsed, empty and failed records were repriced every block, so cheap sybil covers drained the keeper | Fixed: only active, funded, cleanly read records are repriced (and the contract now needs 1 USDC to opt in) |
| K-H5 | High (proof) | Nine sequential round trips per pass made three reprices in consecutive blocks unlikely on mainnet | Fixed: three round trips per steady pass (record and balance in one multicall, cached access list, reused measured limit, cached fees) |
| K-H6 | High | `deploy-mainnet.sh` overwrote `143.json` on every run, before the broadcast succeeded; a rerun after a failed verification redeployed everything | Fixed: refuses without `--force`, writes only after `cast code` passes for all five contracts, `--resume`, verification moved to `verify-mainnet.sh` |
| K-M1 | Medium | A sync-send timeout blocked the keeper for 180 s | Fixed: 4 s wait, then move on; only a true node timeout counts; read fallbacks with 1 s timeouts |
| K-M2 | Medium | After an unclear send failure the next transaction reused the in-flight exit's nonce | Fixed: hash lookup and a pending gate; error classes resync the nonce |
| K-M3, M4, M6 | Medium | One borrower's failed read aborted every later exit and the reprice; one reverting borrower blocked the whole batch; the batch was never split | Fixed: per-exit isolation, chunks under the gas ceiling riskiest first, a reverting borrower is bisected out and skipped for 100 blocks |
| K-M5 | Medium | A stuck position (HF under the trigger but not Ready) was silent; Hermes updates were never tried for stale prices | Fixed: warn-level log with the status; with a Hermes key, stale or deviating exits are retried with a fresh update and the Pyth fee |
| K-M7 | Medium | RPC URLs with API keys were written to `keeper.log` | Fixed: short messages only, configured URLs redacted |
| K-M8 | Medium | `cp .env.example .env` failed; blank numeric settings became 0; a stale address silently overrode the deployment file | Fixed: blanks mean defaults, conflicts refuse, startup checks the deployment's code and wiring |
| K-M9, M10 | Medium | The fork and mainnet share chain id 143; a mistyped flag sent a mainnet borrow | Fixed: mainnet paths refuse local RPCs and require chain 143; unknown arguments are rejected |
| K-M11 | Medium | `nudge` moved the real position to HF 1.045 without checking the cover was armed | Fixed: preflight (active, past the waiting period, allowance, vault liquidity, keeper alive); `previewExit` printed after |
| K-M12 | Medium | Mainnet keys on command lines and in shell history | Fixed: Foundry keystores for deployer, borrower and LP; a `chmod 600` key file for the keeper |
| K-M13 | Medium | A WebSocket that went quiet was never noticed | Fixed: 2 s watchdog falls back to polling and reconnects; the socket's chain id is checked |
| K-M14 | Medium | The indexer silently indexed placeholder addresses when env vars were missing | Fixed: no defaults; a missing variable stops codegen |
| I-1, I-2, I-3 | Low | Exit rows collided when two exits shared a transaction; share transfers broke depositor counts; a late start left borrowers OptedOut | Fixed with tests |
| K-L | Low | Idle cadence could be skipped forever, unbounded memory, entry point broken by spaces in paths, no graceful shutdown, no single-instance lock, Pyth fee not paid, `require-foundry.sh` silent when forge was missing, `fork.sh` did not check its port, config files overwritten without backup, `proof.sh` could print stale rows | Fixed |

Residual risks, disclosed:

- **Stuck transactions.** A transaction the node knows but has not mined for 60 s is logged as stuck and stops blocking sends. If it is still in the mempool, the next send may be refused until it clears.
- **Key visible in `ps`.** The deploy script's `KEEPER_ADDRESS` check passes a keeper key file's key to `cast` for one call, so the key is visible in `ps` while that call runs.

Tests: the keeper went from 33 to 81 tests and the indexer from 2 to 5. Each new test covers one finding.

## Web app (code review and live QA)

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| W-C1, QA-B2, QA-M1 | Critical | "Protected" was shown while an exit could not run (approval revoked, eMode, discount above the user's maximum, oracle gap, LTV-0 collateral) because `previewExit` returns AboveTrigger first; premium kept accruing | Fixed: a client-side armed check of every Executor condition drives the header, panel and gauge; "Not armed: reason" with the fix; every exit status has its own sentence; a "Protection check" list |
| W-H1, QA-B1 | High | Typing a 21-digit amount crashed the whole app; no error boundary | Fixed: one bigint amount parser and input (comma as decimal, inline validation, Max from bigint); error boundaries |
| W-H2 | High | The page used the largest collateral, not the cover's own, so a cbBTC cover was managed as WETH | Fixed: one collateral chosen for the page from the record |
| W-H3 | High | An active cover became unmanageable (no opt out or withdraw) if the position changed | Fixed: the manage panel always renders for an active cover, with a warning |
| W-H4, QA-M2, QA-M6 | High | Prepaid USDC could not be withdrawn after an opt-out or an exit; no Max for withdraw | Fixed: a prepaid card whenever prepaid is above zero; Max net of accrual |
| W-H5 | High | A second click after a confirmation could send the same step again | Fixed: the step stays locked until chain state moves on |
| W-H6 | High | An empty prepay field drifted every block and could force a second approval | Fixed: the amount is fixed on the first click; choices persist across reloads |
| W-M1, M2, QA-M3 | Medium | Contract error names never reached the user; no simulation before signing; a keeper reprice between estimate and inclusion made a user withdraw run out of gas (Monad bills the limit) | Fixed: decoded errors, simulate first, a measured limit with headroom, an out-of-gas message that says retry |
| W-M3, QA-M7, M8, M9 | Medium | Frozen data looked live when the RPC, keeper or indexer stopped | Fixed: reconnect banner and amber chip, "last repriced N blocks ago", "Run the exit yourself" after 10 due blocks, indexer failures shown in every tab |
| W-M4 | Medium | The transaction client followed the wallet's chain; replaced transactions were not handled | Fixed: pinned to chain 143, replacements handled |
| W-M5 | Medium | The cost comparison used USDC debt only, hard-coded parameters, and three different "savings" definitions | Fixed: total debt, the registry's parameters, Aave v3.7's per-reserve close factor, one labelled definition |
| W-M6, QA-M11 | Medium | Watch mode was ignored when a wallet was connected; bad addresses failed silently | Fixed |
| W-M7, QA-M4 | Medium | Changing the trigger after opt-in had none of the setup safeguards | Fixed: due-now note, near-1.00 acknowledgement, fresh quote, waiting-period warning; max discount editable |
| W-M10 | Medium | Copy promised more than the contracts (owner powers, "revoking disarms", withdrawable prepaid, eMode 1%) | Fixed with the claims corrections |
| W-M11 | Medium | The hero example sat at its own trigger and its badge was static | Fixed: debt sized for HF about 1.22; the badge follows the HF |
| W-M12 | Medium | The vault premium rate counted lapsed covers and said "No covers" when the indexer was down | Fixed |
| W-M13, M14 | Medium | The wallet modal theme did not match after hydration; no security headers | Fixed: theme after mount; X-Frame-Options, frame-ancestors, Referrer-Policy, nosniff, Permissions-Policy |
| W-M15 | Medium | Found in the final end-to-end run: a first read slower than viem's 10 s default timeout was aborted and started over, so a slow RPC (or a cold fork) kept the borrower page on its loading state | Fixed: a 30 s RPC timeout, so the first read finishes once; the fork stack also fetches the pages' state before a browser connects (`scripts/warm-fork.mjs`) |
| W-M16 | Medium | Found in the final Lighthouse run: the reconnect fix (no "Connect wallet" flash for a returning wallet) rendered a skeleton for every visitor until scripts ran, so the borrower page's first paint took 6.2 s on a mobile profile (performance 76, from 94) | Fixed: the server reads `?address=` and a data-free cookie set while a wallet is connected; a first visit gets the connect prompt in the HTML (92, 3.3 s) |
| W-L10 | Low | The fork test wallet relied on one env variable | Fixed: needs the variable and a local RPC |
| QA minors | Low | HF rounding mismatches, invalid input not explained, amounts cleared after approvals, tap targets under 44 px, copy capitals, raw "Failed to fetch", slider screen-reader value; in the final captures, a doubled "arms" in the arming header and a preview trigger labelled "not armed" | Fixed |

Untestable in the QA run (the mock wallet auto-signs): a rejected signature. Covered in code review: a rejected signature is handled.

## Claims

| # | Claim (where) | What was true | Status |
| --- | --- | --- | --- |
| 1 | "No owner function can move borrower or vault funds" (FAQ, SECURITY.md) | False as written: an owner-set adapter could take seized collateral (F1) and an unbounded k could reprice prepaid balances away (L-3) | Contracts fixed; trust model and FAQ rewritten with the owner's real powers |
| 2 | WETH and cbBTC are illiquid on Monad: 1 WETH sells 3.8% under the oracle (README, SPEC, ADRs, site) | True only for one thin Uniswap V3 pool; an aggregator quoted 0.06% for 1 WETH and 0.49% for 50 WETH | Repositioned (ADR-035): an on-chain exit at a set HF, for large positions and thin moments |
| 3 | DeFi Saver costs "about 0.08% plus slippage" | 0.25% service fee plus 0.05% automation fee per repay, plus gas and slippage | Corrected in the README, SPEC and site |
| 3b | Euler: "a discount that rises over time" | It rises as health worsens | Corrected |
| 4 | "Protected" shown, and "revoking disarms the cover" | The UI showed Protected while an exit could not run (approval revoked, eMode, oracle gap) and premium kept accruing | Web fix (W-C1); copy says premium accrues until opt-out |
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

The claims reviewer also confirmed as true: test counts at the time, gas figures against the snapshots, the k calibration, every external Aave, Pyth, Monad, Morpho, Euler and Envio fact, and the runbook arithmetic.
