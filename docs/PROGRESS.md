# Progress log

Newest entry first. One entry per session: what moved, commit hashes, what is next, what is blocked and why.

## 5 Oct 2026, M3 Keeper

- Done: keeper (heads with monadNewHeads, newHeads and polling fallbacks; multicall observation on proposed state; exit then repriceMany; measured gas with buffer and headroom; page-compressed access lists; eth_sendRawTransactionSync with fallback; nonce resync; out-of-gas recovery; JSON logs). 33 vitest tests plus an env-gated live smoke test that passes against mainnet and testnet `monadNewHeads`.
- M3 acceptance run on a mainnet Anvil fork (Aave is not on testnet, ADR-020): the keeper repriced in 59 of 60 consecutive blocks about 300 ms apart (receipts in about 290 ms via eth_sendRawTransactionSync), then exited the position the block after HF reached the trigger (fork tx `0xb7200e7f1ad84e0fbb351f9edc417d849c899ab5ed2556063e89717b14b96265`, HF 1.0449 to 1.11). Fork hashes are rehearsal evidence only, never proof.
- Changed (ADR-026): repricing no longer transfers premium; the vault sweeps it in. The rehearsal showed the transfer made per-block gas jump past the estimate.
- Measured (ADR-027): the access list cuts repriceMany gas by 63% and exit gas by 43% on the fork.
- Scripts: `scripts/fork.sh`, `scripts/deploy-mainnet.sh` (also `--fork`), `scripts/demo-position.sh` (seed, open, keeper, nudge; also `--fork`).
- Next: M4 web.
- Blocked: testnet MON for the live `eth_sendRawTransactionSync` smoke check; fund `0xeDA6994BC554131E1c5370f5fE9Afe4dD02c4089` (key in the ignored `keeper/.env.testnet`), then run `LIVE_SMOKE=1 MONAD_SMOKE_WS_URL=wss://testnet-rpc.monad.xyz MONAD_SMOKE_RPC_URL=https://testnet-rpc.monad.xyz pnpm --filter keeper exec vitest run test/live.smoke.test.ts` with that key exported.

## 5 Oct 2026, M1 Scaffold and M2 Contracts

- M1 done (`28869ba`): Foundry project on 1.8.4 with `network = "monad"`, pinned submodules, pnpm workspace (keeper, web, indexer), ABI export script, CI. CI green on main.
- M2 done: PositionRegistry (page-aligned packed records), Repricer (per-block premium, one-page Pyth volatility window), Executor (vault funding, flash-loan fallback with bounded swap, HF post-check), ShieldVault (ERC-4626, NAV includes seized aTokens), UniswapV3Swapper. 97 tests pass: unit (premium math and k calibration, packing, accrual, volatility window, vault), fork tests against real Aave V3 on a Monad mainnet fork (every exit path and refusal), a fuzzed HF check, an accounting invariant (5,120 calls) and an exit HF invariant on the fork. Gas snapshot in `contracts/.gas-snapshot` and `contracts/snapshots/`.
- Found while testing: WETH's LTV (80.5%) is below its liquidation threshold (84%), so borrowing alone stops at HF 1.0435. A 1.04 trigger is reached by a price move; triggers above 1.0435 can be reached by a real extra borrow (`test_exit_afterExtraBorrow_noPriceChange`).
- Found while testing: a fully flash-funded exit cannot budget 3% slippage inside a 1% discount, so the swap input is capped at the seized amount and the oracle bound still applies.
- Next: M3 keeper (code written, tests next), then Slither and Aderyn.
- Blocked: as before (testnet MON, Hermes key, Envio token and bounty text, repo visibility).

## 5 Oct 2026, M0 Verify

- Done: every VERIFY box in docs/SPEC.md is ticked with its result; Pyth mainnet address, Aave Monad flash-loan premium (5 bp), Monad EVM target (Prague shape, Foundry 1.8 `network = "monad"`), MIP-8 page size and costs, block time and block tags are recorded under Verified facts in docs/TECH-DECISIONS.md.
- Decided (ADR-015 to ADR-025): real Aave position only; WETH and cbBTC collateral with USDC debt because Aave Monad has no MON reserve; Pyth push feeds with an optional Hermes update because Hermes now needs an API key; flash-loan fallback swaps through a bounded swapper; Foundry 1.8 Monad execution; Aave-dependent tests on a mainnet Anvil fork because Aave is not on testnet; exit sizing to trigger + 0.06; pricing defaults and k = 0.00125; one MIP-8 page per volatility buffer; vault NAV includes seized aTokens at the Aave oracle; configurable repricing cadence.
- Corrected: the comparison table said Morpho pre-liquidation is not on Monad. It is (PreLiquidationFactory `0xB5b3e541abD19799E0c65905a5a42BD37d6c94c0`), for Morpho Blue markets only.
- Next: M1 scaffold.
- Blocked: testnet MON (faucet needs a browser); Pyth Hermes API key (optional, push feeds cover it); exact Envio bounty card text (portal login); repo is private and must be public before submission.

## 5 Oct 2026

- Repo initialised with README, docs/SPEC.md, docs/TECH-DECISIONS.md, CLAUDE.md, LICENSE (MIT).
- Current milestone: M0 Verify. Nothing started.
- Next: resolve the six VERIFY items in docs/SPEC.md and record them in docs/TECH-DECISIONS.md under Verified facts.
- Blocked: repo is private; it must be public before submission (Metropolis rule).
