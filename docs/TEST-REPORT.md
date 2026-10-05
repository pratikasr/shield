# Shield test report

Seven rounds, all run on 5 Oct 2026 on macOS (Apple silicon) with Foundry 1.8.4 (`network = "monad"`), Node 24.6, pnpm 11.3 and Docker 29.2. Fork tests and fork rehearsals use Monad mainnet through the public RPCs (rpc.monad.xyz, rpc1.monad.xyz); Aave V3 is not on Monad testnet (ADR-020). Nothing in this report is mainnet proof.

## Round 1: contracts, static analysis, keeper, workspace

| Check | Command | Outcome |
| --- | --- | --- |
| Foundry, all suites | `cd contracts && FORGE_SNAPSHOT_EMIT=true MONAD_RPC_URL=https://rpc.monad.xyz FORK_BLOCK=110596951 forge snapshot` | 101 tests pass in 9 suites: PremiumMath 10, PositionRegistry 24, Repricer 28, ShieldVault 9, AccountingInvariant 1 (3 invariants, 128 runs, 5,120 calls, 0 reverts), ExitFork 23, RepricerFork 5, ExitInvariant 1 (2 invariants on the fork, 6 runs x 20 calls) |
| Repricer math | `forge test --match-contract PremiumMathTest` | pass, including the k calibration (`test_calibration_kGivesTwoPercentAtD5Sigma80`) and a 512-run monotonicity fuzz |
| Registry packing | `forge test --match-contract PositionRegistryTest` | pass, including 512-run fuzzes of page alignment, packing round trip and active-list consistency |
| Every Aave path on a mainnet fork | `forge test --match-contract ExitForkTest` | pass: vault-funded exit, flash-loan fallback with the vault empty, mixed funding, every refusal (see Round 3), NAV and unwind |
| Fuzz on reprice and exit inputs | `testFuzz_monotonic`, `testFuzz_volWindow_sumMatchesRecompute`, `testFuzz_exit_neverLeavesHfAtOrBelowOne` (24 runs on the fork) | pass |
| Invariant: exit never leaves HF at or below 1.0 or below the pre-exit HF | `forge test --match-contract ExitInvariantTest` | pass; the last run made 8 exit attempts, 2 of which exited and satisfied the invariant |
| Gas snapshot | `forge snapshot` | committed: `contracts/.gas-snapshot`, `contracts/snapshots/` |
| Formatting | `forge fmt --check` | clean |
| Slither 0.11.6 | `slither . --filter-paths "lib/|test/|script/" --exclude-informational --exclude-optimization` | before fixes 5 high, 22 medium; after, 5 high and 16 medium, each justified in docs/SECURITY.md |
| Aderyn 0.6.8 | `aderyn . --src src` | before fixes 3 high; after, 2 high, both justified in docs/SECURITY.md |
| Keeper | `pnpm --filter keeper test` | 33 pass, 2 live smoke tests skipped by default |
| Keeper live smoke | `LIVE_SMOKE=1 MONAD_SMOKE_WS_URL=wss://rpc.monad.xyz pnpm --filter keeper exec vitest run test/live.smoke.test.ts` (also testnet) | `monadNewHeads` part passes on mainnet and testnet; the `eth_sendRawTransactionSync` part waits for a funded testnet key |
| Indexer | `pnpm --filter shield-indexer test` | 2 pass |
| Workspace | `pnpm lint && pnpm test && pnpm -r build` | clean |
| Lighthouse 12 (mobile emulation, production build) | `npx lighthouse http://localhost:3200/<route> --only-categories=performance,accessibility,best-practices` | version 1: landing 98 / 100 / 100; borrower 92 / 100 / 100; LP 91 / 100 / 100. Version 2 (redesign): landing 94 / 100 / 100; borrower 94 / 100 / 100; LP 91 / 100 / 100, CLS 0 on all three (performance / accessibility / best practices) |

Defects found in this round and fixed, each with a regression test:

| Defect | Fix | Regression test |
| --- | --- | --- |
| A fully flash-funded exit budgeted 3% slippage on top of the repay and could exceed the 1.01x seized collateral, so it always reverted | Swap input capped at the amount seized; the oracle price bound still applies | `test_exit_flashLoanFallback_vaultEmpty` |
| Vault `maxWithdraw` lost a unit to rounding through OpenZeppelin 5.7's `maxRedeem` path | Cap computed from the owner's full balance | `test_withdrawCappedByIdleUsdc` |
| Pyth confidence was not checked (Slither) | Exit refuses wide-confidence prices; the volatility window skips them | `test_exit_revertsOnWidePythConfidence`, `test_sample_skipsLowConfidencePrice` |

## Round 2: end to end on a mainnet fork

`bash scripts/e2e.sh`: `scripts/stack.sh up` starts an Anvil fork of Monad mainnet at the latest block with 300 ms blocks, deploys Shield with the mainnet deploy script, makes an LP deposit, opens a 0.05 WETH / USDC position at HF 1.07 (no cover), starts the Envio indexer, the keeper and a production build of the web app. Playwright (`web/e2e/video-script.spec.ts`) then walks the SPEC.md video script and checks each claim against the fork's receipts:

1. Connect the fork test wallet; the borrower page shows HF 1.069.
2. Set the trigger to 1.06 with the keyboard, prepay 5 USDC, and run the four steps (approve WETH, approve USDC, prepay, opt in); each step waits for "finalised in block N". On chain: exactly one `OptedIn` with trigger 10,600.
3. The premium ticks: "Premium paid so far" rises; on chain, `Repriced` events land in at least three consecutive blocks.
4. The price moves: Aave's WETH price drops 1.6% (a fork-only oracle source; inside the exit's 2% Aave-versus-Pyth bound) and HF falls to 1.0529, under the trigger.
5. The keeper exits: one `Exited` event, receipt `success`, HF after above 1.0 and above HF before; the page shows "penalty avoided" with the same USDC amount as the event.
6. The LP page shows one exit executed, the exit transaction in the table, premium earned above zero.

| Run | Outcome | Duration |
| --- | --- | --- |
| Final run, 5 Oct 2026 | pass | 2.2 min for the Playwright part |
| Re-run after the version 2 redesign (docs/DESIGN.md), 5 Oct 2026 | pass | 2.2 min |

Defects found by this round and fixed: wagmi only watched blocks when the `watch` object also set `enabled`, so every "per block" read on the page was one-shot (the premium never ticked); the page now reads the exit from chain logs so it can show the penalty avoided before the indexer catches up; `envio dev` stalls without a terminal, so the stack starts Postgres and Hasura with `envio local docker up` and runs `envio start`; the E2E scripts now stop every process they start. The premium-tick and penalty-avoided assertions are the regression tests.

## Round 3: adversarial scenarios

Each scenario has a test that reproduces it; all pass.

| # | Scenario | Expected | Test |
| --- | --- | --- | --- |
| 1 | `exit` while HF is above the trigger | reverts `ExitBlocked(AboveTrigger)` | `test_exit_revertsAboveTrigger` |
| 2 | `exit` on a borrower who never opted in | reverts `ExitBlocked(NotActive)` | `test_exit_revertsForBorrowerNotOptedIn` |
| 3 | Two exits for one borrower in one block | the second reverts `NotActive` | `test_exit_doubleExitInOneBlock` |
| 4 | Prepaid balance runs out mid-cover | cover lapses, nothing more is charged, the exit is refused (`CoverLapsed`), a top-up restores cover without billing the lapsed blocks | `test_prepaidExhausted_lapsesMidCover`, `test_exit_revertsWhenCoverLapsed`, `test_debitToZero_lapsesAndCreditRestores` |
| 5 | Stale Pyth price | exit reverts `PythStale`; a fresh update in the same call clears it | `test_exit_revertsOnStalePyth` |
| 6 | Pyth update for the wrong feed | no observation added; exit still `PythStale` | `test_exit_pythUpdateForWrongFeed_doesNotHelp`, `test_sample_wrongFeedUpdateDoesNotMoveOurFeed` |
| 7 | Re-entrancy through callbacks. Aave v3.7 aTokens have no transfer hooks, so the callbacks reachable during an exit are Aave's flash-loan callback and the swapper | a re-entering swapper reverts the exit; the flash callback rejects direct calls and foreign initiators | `test_reentrancy_throughSwapperIsBlocked`, `test_executeOperation_rejectsDirectCall`, `test_executeOperation_rejectsForeignInitiator` |
| 8 | Vault empty and flash loans disabled | exit reverts, the cover stays active | `test_exit_revertsWhenVaultEmptyAndFlashLoanUnavailable` |
| 9 | Borrower revokes the aToken approval | `previewExit` reports `AllowanceTooLow`, exit reverts; the UI shows "Unprotected" with "Approve again" | `test_exit_revertsWhenApprovalRevoked` |
| 10 | Borrower repays all debt before the exit | not due (`AboveTrigger`); premium falls to zero | `test_exit_borrowerRepaidInFull_notDue`, `test_reprice_borrowerRepaidInFull_rateZero` |
| 11 | Trigger below 1.0 (or below 1.01, or above 2.00) | opt-in and `setTrigger` revert `TriggerOutOfRange` | `test_optIn_revertsTriggerBelowOneOhOne`, `test_optIn_revertsTriggerAboveTwo`, `test_setTrigger_and_setMaxDiscount` |
| 12 | Max discount below 1% | opt-in reverts `MaxDiscountOutOfRange` | `test_optIn_revertsMaxDiscountBelowOnePercent` |
| 13 | Keeper RPC failure and recovery | the failed block is logged, the next block is processed; WebSocket drops reconnect; repeated failures fall back to polling, which survives errors | `logs an RPC failure and recovers on the next block`, `reconnects after a dropped socket…`, `falls back to HTTP polling…` |
| 14 | `eth_sendRawTransactionSync` unsupported | falls back to `eth_sendRawTransaction` and receipt polling, and remembers it; a sync timeout waits for the receipt | `falls back to eth_sendRawTransaction…`, `waits for the receipt when the sync call times out` |
| 15 | Gas limit too low | an out-of-gas revert raises the buffer for that call type until 50 clean runs; seen live on the fork and fixed (ADR-026) | `raises the gas buffer after an out-of-gas revert`, `test_repriceGas_doesNotDependOnSweepThreshold` |
| 16 | Access list names the wrong page | detected; the keeper builds pages from the contracts' own slot views and lists one key per page | `detects an access list that names the wrong page`, `exits a Ready borrower before repricing the rest, with the right access list` |
| 17 | Aave and Pyth disagree by more than 2% | exit reverts `OracleDeviation` | `test_exit_revertsOnOracleDeviation` |
| 18 | Pyth confidence wider than the bound | exit reverts `OracleDeviation`; no volatility observation | `test_exit_revertsOnWidePythConfidence`, `test_sample_skipsLowConfidencePrice` |
| 19 | Borrower in eMode | exit reverts `EModeUnsupported` | `test_exit_revertsInEMode` |
| 20 | Owner raises the exit discount above the borrower's ceiling | exit reverts `DiscountAboveMax` until the borrower raises it | `test_exit_revertsWhenDiscountRaisedAboveBorrowerMax` |
| 21 | First-depositor inflation attack on the vault | victim keeps at least 99.9% | `test_inflationAttack_uneconomic` |
| 22 | LP withdraws more than the liquid USDC | capped; seized collateral must be unwound first | `test_withdrawCappedByIdleUsdc` |
| 23 | Reprice called twice in one block | charged once | `test_reprice_twiceInOneBlock_chargesOnce` |
| 24 | Pyth fee underpaid or overpaid | reverts `InsufficientUpdateFee`; the excess is refunded | `test_pythUpdate_feeChargedAndRefunded` |
| 25 | Anyone but the modules writes a record | reverts `NotRepricer` or `NotExecutor` | `test_moduleWrites_onlyModules` |
| 26 | Same exit attempted twice by the keeper while the first is in flight | not resubmitted | `does not exit a borrower whose exit is already in flight` |
| 27 | Any HF drop and position size | an exit either leaves HF above 1.0 and above its start, or does not happen | `testFuzz_exit_neverLeavesHfAtOrBelowOne`, `invariant_exitNeverLeavesHfAtOrBelowOneOrBelowStart` |

## Round 4: fresh clone

An empty directory, the README Quick start commands in order, word for word, with Foundry 1.8.4 first on PATH (as `foundryup` leaves it), Node 24.6 and pnpm 11.3. The clone was of `main` at `1dc476c`.

| Step | Command | Outcome | Time |
| --- | --- | --- | --- |
| Clone | `git clone --recurse-submodules https://github.com/pratikasr/shield.git` | pass, including Aave's nested submodules | 2 min |
| Build | `cd contracts && forge build` | pass | 3 s |
| Unit tests, offline | `forge test` | 72 pass; the 3 fork suites skip themselves | 3 s |
| Fork tests against live mainnet | `MONAD_RPC_URL=https://rpc.monad.xyz forge test` | 101 pass, 0 fail | 12 min |
| Install | `pnpm install` | pass | 11 s |
| Build | `pnpm -r build` | pass (keeper, indexer codegen, web production build) | 27 s |
| Lint | `pnpm lint` | pass | 5 s |
| Test | `pnpm test` | keeper 33 pass (2 live smoke tests skipped), indexer 2 pass | 4 s |

Defects found: none that stopped a step. Three found around it, all fixed: running the fork tests rewrote the committed gas figures in `contracts/snapshots/` (block-dependent), leaving the clone dirty, so `foundry.toml` now sets `gas_snapshot_emit = false` and the refresh command sets `FORGE_SNAPSHOT_EMIT=true`; the fork tests take 12 minutes on a first run because every state read goes to the public RPC, which the README now says, with `FORK_BLOCK` for cached reruns (4.4 minutes, measured); and a forge older than 1.8 first on PATH fails with a config error that does not name the fix (the scripts now check, Round 5). Pinning every fork test in a run to one shared block was tried and made no difference to a first run (693 s against 734 s), so it was not kept.

## Round 5: demo rehearsal

| Run | Command | Outcome |
| --- | --- | --- |
| 1, clean fork of block 110642017 | `bash scripts/e2e.sh` | pass: opt-in in fork block 110642413; reprices in blocks 110642416, 110642417 and 110642418 with keeper receipts 301 ms and 300 ms apart; exit in block 110642449, HF 1.0529 to 1.1200, penalty avoided 1.191184 USDC |
| 2, clean fork of block 110642711 | `bash scripts/e2e.sh` | pass: opt-in in fork block 110643135; reprices in blocks 110643138, 110643139 and 110643140 with receipts 300 ms and 300 ms apart; exit in block 110643168, HF 1.0529 to 1.1200, penalty avoided 1.190170 USDC |
| 3, the scripted mainnet flow on a clean fork of block 110644465 | `fork.sh`, `deploy-mainnet.sh --fork`, `demo-position.sh seed/open/keeper/nudge --fork`, `proof.sh --fork` | pass: every command exited 0; reprices in three consecutive blocks with receipts 299 ms and 301 ms apart; the nudge took HF to 1.045 and the keeper exited; `proof.sh` checked every address and hash on the fork |

Click path, every block number and hash, and the mainnet runbook: [DEMO.md](DEMO.md). Defects found: the scripts ran whatever `forge` came first on PATH, and Homebrew's Foundry 1.7 has no `network = "monad"`; the forge scripts now stop with the fix (`scripts/require-foundry.sh`). The demo keeper now writes its JSON log to `keeper.log` so `scripts/proof.sh` can read the repricing and exit hashes from it, and `demo-position.sh position` opens the position without cover so the opt-in can happen on camera.

## Round 6: after the internal audit

Every check rerun on `main` after the audit fixes were merged ([AUDIT.md](AUDIT.md)).

| Check | Command | Outcome |
| --- | --- | --- |
| Foundry, all suites | `cd contracts && MONAD_RPC_URL=https://rpc.monad.xyz forge test` | 122 pass, 0 fail: 82 unit, fuzz and invariant tests (mocks), 40 fork tests against real Aave on Monad, including the 11 audit regression tests in `ExitHardening.t.sol` |
| Gas snapshot | `FORGE_SNAPSHOT_EMIT=true MONAD_RPC_URL=https://rpc.monad.xyz FORK_BLOCK=110596951 forge snapshot` | refreshed; figures in the README |
| Slither 0.11.6, Aderyn 0.6.8 | as in Round 1 | Slither 8 high and 18 medium, Aderyn 2 high, each fixed or justified in docs/SECURITY.md |
| Keeper | `pnpm --filter keeper test` | 81 pass, 2 live smoke tests skipped by default |
| Indexer | `pnpm --filter shield-indexer test` | 5 pass |
| Workspace | `pnpm lint && pnpm test` | clean |
| End to end, clean fork of block 110723988 | `MONAD_RPC_URL=https://rpc1.monad.xyz bash scripts/e2e.sh` | pass: opt-in in fork block 110724485 after the 20-second waiting period of the fork deployment; reprices in blocks 110724486, 110724487 and 110724488 with keeper receipts 301 ms and 299 ms apart; exit in block 110724596, HF 1.0529 to 1.1200, 1.186221 USDC saved against Aave's bonus on 26.36 USDC repaid |
| End to end, second clean fork (block 110729247), after the borrower page change below | same | pass: opt-in in block 110729753; reprices in blocks 110729754, 110729755 and 110729756 with keeper receipts 299 ms and 300 ms apart; exit in block 110729830, HF 1.0529 to 1.1200, 1.185659 USDC saved on 26.35 USDC repaid; exit gas 697,349 on the fork |
| The scripted mainnet flow, clean fork of block 110732451 | `fork.sh`, `deploy-mainnet.sh --fork`, `demo-position.sh seed/open/keeper/nudge --fork`, `proof.sh --fork` | pass: every command exited 0 after a fix to the fork keeper's cadence (below); nudge preflight passed, the keeper exited 3.9 s after the nudge, `proof.sh` checked every address and hash; details in [DEMO.md](DEMO.md), run 4 |
| Design review captures | `REVIEW_DIR=... pnpm exec playwright test review` against `scripts/stack.sh up` | pass: 48 captures in docs/screenshots/pass-4/, every 375 px capture exactly 375 px wide |
| Lighthouse 12 (mobile emulation, production build) | as in Round 1 | landing 97 / 100 / 100; borrower 92 / 100 / 100; LP 91 / 100 / 100; CLS 0 on all three (performance / accessibility / best practices) |

Defects found in this round and fixed. First, on a cold fork the borrower page never left its loading state. Its first batch of reads touches every Aave reserve, and each uncached storage slot is a round trip to the upstream RPC (350 to 700 ms measured), so the batch outlasted viem's 10-second default timeout and was aborted and restarted every time. The web transport now allows 30 seconds, and `scripts/stack.sh` runs `scripts/warm-fork.mjs` first, which makes the pages' reads once in parallel (101 s on this fork). A mainnet RPC serves these reads from local state; the longer timeout only matters there if the public RPC is slow.

Second, Lighthouse performance on the borrower page fell from 94 to 76 (largest paint 6.2 s). An audit fix rendered a skeleton for every visitor until scripts ran, so that a returning wallet would not flash "Connect wallet" while it reconnects. The page now reads `?address=` and a data-free cookie on the server, so a first visit gets the connect prompt in the HTML and only a returning wallet sees the skeleton (92, 3.3 s). Third, Anvil answers any query on the `pending` tag with "Required data unavailable" while a transaction waits for the next block, and a keeper repricing every block always has one waiting. That failed the review run's price move and the first nudge of the scripted flow. The price helper now sends with fixed gas limits, and the fork demo keeper uses the mainnet repricing cadence. Monad's `pending` tag is the proposed block, so mainnet is not affected.

## Round 7: the protocol share and analytics

Every check rerun on `main` after the protocol share (ADR-037) and the analytics work (ADR-038).

| Check | Command | Outcome |
| --- | --- | --- |
| Foundry, all suites | `cd contracts && FORGE_SNAPSHOT_EMIT=true MONAD_RPC_URL=https://rpc.monad.xyz FORK_BLOCK=110596951 forge snapshot` | 130 pass, 0 fail: 89 unit, fuzz and invariant tests (7 new for the share, including a fuzz of conservation across the split and a treasury that cannot receive USDC), 41 fork tests (a new one pays the treasury in real USDC); gas snapshot refreshed |
| Static analysis | as in Round 1 | Slither 8 high and 19 medium, the new medium the same deliberate remainder as `sweep`; Aderyn the same 2 highs; all justified in docs/SECURITY.md |
| Keeper | `pnpm --filter keeper test` | 81 pass, 2 live smoke tests skipped by default |
| Indexer | `pnpm --filter shield-indexer test` | 6 pass (a new one checks the per-charge split, hourly, daily and all-time buckets, payouts and the exit's trigger and discount) |
| Web unit tests | `pnpm --filter web test` | 47 pass: amounts, risk maths (health factor at a price, simulator thresholds, chance of touching a price), analytics series |
| Workspace | `pnpm lint` and `pnpm --filter web build` | clean |
| End to end, clean fork of block 110760655 | `MONAD_RPC_URL=https://rpc.monad.xyz bash scripts/e2e.sh` | pass: opt-in in block 110761050; reprices in blocks 110761051, 110761052 and 110761053 with keeper receipts 298 ms and 302 ms apart; exit in block 110761123, HF 1.0529 to 1.1200, 1.186543 USDC saved on 26.37 USDC repaid; exit gas 699,739 on the fork |
| The scripted mainnet flow, clean fork of block 110762163 | `fork.sh`, `deploy-mainnet.sh --fork`, `demo-position.sh seed/open/keeper/nudge --fork`, `sweepProtocol()`, `proof.sh --fork` | pass; the treasury received its share on chain; details in [DEMO.md](DEMO.md), run 5 |
| Design review captures | `REVIEW_DIR=... pnpm exec playwright test review` | pass: 54 captures in docs/screenshots/pass-5/, including the Analytics page; every 375 px capture exactly 375 px wide |
| Lighthouse 12 (mobile, production build) | default (simulated throttling) and `--throttling-method=devtools` | devtools throttling: 99 / 100 / 100 on the landing, borrower, LP and analytics pages, largest paint equal to first paint (1.5 s). Simulated: landing 96; the app pages 84 to 90 between runs, on a machine where another project's processes used over three cores. In a browser at 4x CPU slowdown the largest paint landed within 0.1 s on every page |

Defects found in this round and fixed:

1. **A treasury that could not receive USDC would have blocked the vault.** The first version paid the treasury inside `sweep()`, which the vault calls before every withdrawal and exit; a blocklisted treasury would have made both revert. The treasury is now paid by its own `sweepProtocol()` (`test_protocolShare_failingTreasuryNeverBlocksTheVault`).
2. **Aderyn flagged `sweepProtocol` for writing state after the registry read.** Harmless (a view call to the registry, behind the reentrancy guard), but the counter is now written first.
3. **A first fork run failed seven tests**, five on the RPC resetting connections (Cloudflare 1015 on rpc1.monad.xyz) and two that passed on rerun; a new fork test of mine measured the vault's total against only the second charge. All pass on the rerun and the fixed test.
4. **The video-script test moved the wrong slider**: the new price simulator is the first slider on the page. Both specs now find the trigger slider by its name.
5. **The MetaMask SDK loaded on every app page** (about 450 KB) through RainbowKit's MetaMask entry. MetaMask now connects through its extension; blocking time on the app pages fell by about two thirds.
6. **A Vitest config committed before Vitest was installed broke a web build** in the stack. Vitest is now a web dev dependency.

