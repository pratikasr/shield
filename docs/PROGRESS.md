# Progress log

Newest entry first. One entry per session: what moved, commit hashes, what is next, what is blocked and why.

## 13 Oct 2026, Aurora app key and the keeper on testnet

- **Done.**
  - The owner created Shield's app key in Aurora Intents Studio. It is kept outside the repo in `~/.shield/aurora-app-key` and in the ignored `web/.env.local`.
  - A dry quote of 25 USDC from Base gives 24.989266 USDC on Monad, in about 37 s. In the app on the fork stack, "Add fuel" with "From another chain" got a real quote and a deposit address on Base, and the status checks started.
  - The keeper's live check passed on Monad testnet: `monadNewHeads` heads, and a receipt from `eth_sendRawTransactionSync` 542 ms after sending (tx 0xc2ccc7b2443186c955a1d5083e889138b903951d40a1222849edec7ee845e773). Testnet wallet 0x39DaBE2ACE84F86C758af45bDf58BE41f88FD791, funded by the owner from the faucet.
  - The indexer records cross-chain top-ups end to end on the local stack (TEST-REPORT, round 9).
- **Next.** M6 on mainnet: the deploy, the hosted indexer, the hosted web app with `NEXT_PUBLIC_AURORA_APP_KEY` set, the demo (including the 25 USDC Base top-up), `proof.sh`, then the video, the repo going public, and the submission.
- **Blocked on the owner.** Mainnet funds and keystores (docs/DEMO.md, Funding); Envio and Vercel logins; 25 USDC and a little ETH on Base for the Aurora top-up; making the repo public. Claim the Aurora bounty only if the real top-up reaches SUCCESS.

## 13 Oct 2026, version 3: the cartoon "floor is lava" redesign

- **Why.** The owner rejected the calm fintech design: charts, sliders and the health factor made no sense to degens, who want to know at once whether they are safe, when Shield steps in and what it costs. They asked for a cartoon, game-like site with motion, built by a team with a researcher, a designer and a critic, and a prototype first.
- **How.**
  - Research Part 3: 42 live sites captured (docs/DESIGN-RESEARCH.md, `c952010`).
  - A clickable prototype of every screen and state, with a token system and motion table (design/prototype/, `ae2c893`).
  - A critic's review: ship to build with 11 must-fix items (design/prototype/CRITIC.md, `3a9db33`).
  - Three builders rebuilt the app on live data with those fixes in: foundation and landing (`fd4994a`), Vault and Stats (`bf683cb`), Protect (`2eab407`).
- **Done.**
  - A sky level where ETH stands above Aave's lava, with Shield's line in between and a mascot whose face is the status.
  - A plain sentence instead of the health factor, which moves to "Stats for nerds".
  - Three line cards and fuel presets instead of sliders, and one "Turn on Shield" button for the four wallet steps.
  - Honest states (arming, off by choice, blocked with its fix, stepped in).
  - A vault with three numbers and a Stats scoreboard.
  - A block ticker that stamps only real Shield transactions.
  - DESIGN.md has a version 3 section.
- **Checks.**
  - Lint clean; 82 web unit tests pass; the production build passes.
  - Lighthouse with devtools throttling: landing 97, borrower 98, vault 98, stats 98.
  - The browser tests are updated for the new flow.

## 13 Oct 2026, protocol-funded vault and premium from any chain (Aurora Intents)

- **Why.** The owner's plan (Shield: Aurora Intents Routing and Vault Economics): a protocol-funded vault keeping all income, and top-ups from any chain for the Aurora Intents bounty, without touching the exit path.
- **Done (uncommitted until commit signing is unlocked).**
  - Contracts: the vault's depositor allowlist (the treasury only at launch), `Repricer.topUpFor` for the factory only, and `ShieldForwarderFactory` with per-account CREATE2 deposit addresses, `sweepPremium` and `sweepVault` (ADR-039). The deploy makes the LP account the treasury. 143 contract tests pass; gas snapshot refreshed at block 113,031,739.
  - Keeper: a sweep pass for active borrowers' and the treasury's deposit addresses, after reprices and never ahead of an exit.
  - Indexer: forwarder events; cross-chain top-ups labelled in the borrower's history.
  - Web: "From another chain" on the borrower page (deposit address, Aurora quote, deposit address on the source chain, a five-step status strip, "Move into premium"); the Vault page protocol-funded; copy across the site.
  - Docs: ADR-039, SECURITY, README ("Who earns what", "Premium from any chain", Aurora in Bounties), SPEC, DEMO, DESIGN, SUBMISSION; verified facts on Aurora's API.
- **Checks.** Round 8 in [TEST-REPORT.md](TEST-REPORT.md).
- **Blocked on the owner.** Commit signing (GPG passphrase); Docker Desktop (the local indexer); the Aurora app key (real quotes and the 25 USDC demo top-up from Base); mainnet funds and keystores; Envio and Vercel logins; making the repo public. Claim the Aurora bounty only if the real top-up reaches SUCCESS.

## 5 Oct 2026, protocol earnings and analytics

- **Why.** The owner asked for protocol earnings, rich analytics in the style of THORChain's earnings dashboards, closer Monad alignment, and other lenders shown as coming soon; plan first, check it fits the hackathon, then build and test.
- **Done.**
  - Contracts (`93b6f34`, `ad4f703`, `f576085`): a protocol share of premiums, 10% at deploy and capped at 20% in code, split per charge and paid to a treasury by its own `sweepProtocol()`; the exit discount stays with liquidity providers (ADR-037). 130 contract tests pass; gas snapshot refreshed.
  - Indexer (`93b6f34`): hourly, daily and all-time earnings buckets, config and treasury payouts.
  - Web (merged in `d36374b` and the following commits): a public Analytics page with earnings over time, the earnings breakdown, a live Monad block stream showing commit states and Shield's reprices, keeper cost, covers and exits, the one Aave Monad liquidation as a worked example, and Monad lenders coming soon; on the borrower page, health-factor history, a price simulator and the chance of touching the exit price; on the vault page, income since launch. MetaMask connects without the SDK.
  - Scripts and docs: the deploy and proof scripts show the treasury and its payouts; README "Who earns what"; SPEC, SECURITY, DESIGN, ADR-037 and ADR-038; verified facts on Monad lenders, Aave Monad's only liquidation and Monad's commit-state timings.
- **Checks.** Round 7 in [TEST-REPORT.md](TEST-REPORT.md): all suites green; the video-script test and the scripted mainnet flow pass on clean forks; review pass 5 (docs/screenshots/pass-5/).
- **Next.** Unchanged: M6 needs the owner's funds, keystores and Envio login; then the video, the repo going public, and the submission. The hosted indexer must be deployed from this schema.

## 5 Oct 2026, internal audit before mainnet

- **Why.** The owner asked for a full audit: every case, happy and bad paths, UI and UX, bugs, red team.
- **How.** Six parallel reviewers (contracts security, contracts correctness, keeper/indexer/scripts, web code, live QA in a browser, every claim in the docs). Non-trivial findings needed a proof: a failing test, a code citation, a screenshot or a live source. Report: [AUDIT.md](AUDIT.md).
- **Found.** 1 critical, 15 high, 35 medium, plus lows and notes, and 16 inaccurate claims. Every critical, high and medium item is fixed; accepted lows are disclosed in SECURITY.md.
- **Done.**
  - Contracts (`53df3ad`): balance-checked swaps on both unwind paths, a 900 s waiting period before cover can exit, the vault never loses on a flash-assisted exit, exit gains unlock over six hours, opt-out settles first, billing at the higher of stored and live rate, 1 USDC minimum prepay, bounded owner parameters, capped volatility input, cbBTC disabled at deploy. 122 tests pass (82 unit, 40 fork). ADR-028 to 035.
  - Keeper, indexer and scripts (`751c52b`, `87d9d21`, `618e12e`, `72c6ec3`, `637081a`, merged in `f9a48ff`): correct out-of-gas detection on Monad, spending limits and a reserve for exits (ADR-036), per-borrower isolation, three round trips per pass, safe mainnet deploys, keystores instead of keys on command lines, PID-based process control. Keeper 81 tests, indexer 5.
  - Web (`4f8c838`, `a16d3fc`, `eb60d4f`, merged in `054d7e7`; `343a9c3`): "Protected" only when every exit condition holds, a protection checklist, one safe amount parser, simulate before every send, stale RPC, keeper and indexer states, error boundaries, security headers, a 30 s RPC timeout.
  - Docs (`4f7c1b4`): trust model with the owner's real powers, corrected claims across README, SPEC and site, static analysis rerun.
- **Checks.** Round 6 in [TEST-REPORT.md](TEST-REPORT.md): all suites green; the video-script end-to-end test passes on two clean forks; Lighthouse (mobile) landing 97, borrower 92, LP 91 with accessibility and best practices 100, CLS 0; review pass 4 (docs/screenshots/pass-4/).
- **Found while verifying** (`343a9c3`, `1356689`, `3ddc510`, `782020f`): the borrower page stayed on its loading state on a cold fork (30 s RPC timeout, and the stack now warms the fork); the reconnect fix had cost the borrower page its server-rendered first paint (Lighthouse 76, now 92); two copy fixes; capture and price-move flakes in the test harness.
- **Next.** M6 needs the owner: funds, keystores, the Envio login. Then the video, the repo going public, and the submission.
- **Open for the owner.** Whether to name the builder in the footer, and a security contact.

## 5 Oct 2026, M4 web redesign (version 2)

- **Why.** The owner said version 1 "feels a little sus".
- **Research.**
  - 26 DeFi and fintech sites captured live at desktop and phone widths: Aave, Morpho, Euler, Spark, Compound, Uniswap, Fluid, Pendle, Lido, Sky, DeFi Saver, Summer.fi, Liquity, Monad, Stripe, Coinbase, Mercury and Robinhood.
  - Inside the lending apps with a read-only wallet pointed at real borrowers.
  - Published work on credibility and crypto scam sites.
  - Written up as Part 2 of docs/DESIGN-RESEARCH.md.
- **Done (version 2, docs/DESIGN.md).**
  - Light by default with a neutral graphite dark theme.
  - Instrument Sans at weight 500 with tabular figures.
  - A new mark and app icon (the default Next.js favicon is gone).
  - Token and network logos everywhere.
  - A wallet avatar.
  - Rates per year in place of sub-cent headlines.
  - A health-factor gauge with a scale and legend.
  - A cost comparison with bars.
  - Liquidation and exit prices.
  - Trigger and prepay presets.
  - A calm protected state.
  - An exit summary card.
  - A "Sources and contracts" panel (Aave oracle against Pyth, every contract linked).
  - **Landing page:**
    - A live product card in the hero, a disclosure line, and a proof strip linked to evidence.
    - A savings calculator.
    - The exit as a five-step transaction trace.
    - A "Built to be checked" security section with "Not audited yet".
    - An FAQ led by "Is Shield audited?" and "What can the owner change?".
    - A full footer with an unaudited and not-affiliated disclaimer.
- **Checks.**
  - The video-script E2E passes on the redesign.
  - Review pass 3 captured every state at 375, 768 and 1440 px (docs/screenshots/pass-3/), with no horizontal scroll at 375 px.
  - Lighthouse (mobile): landing 94 / 100 / 100, borrower 94 / 100 / 100, LP 91 / 100 / 100, CLS 0.
- **Fixed on the way.** `scripts/stack.sh down` never stopped the keeper (wrong process pattern), so stale keepers piled up on every new fork.
- **Open for the owner.** Whether to name the builder in the footer, and a security contact. Both are recommended by the research as the strongest trust signals left.

## 5 Oct 2026, M4 Web, M5 Indexer, test rounds 1 to 5, M6 and M7 prepared

- M4 done (`1138fb0`, `4945088`): landing at `/` (pitch, live block demo, comparison table, Why Monad, limits), borrower page `/app/borrow` (Aave position, opt-in with trigger slider, max discount, aToken approval, prepay, premium ticking per block with sparkline, "Aave penalty if liquidated: $X. Shield: $Y.", unprotected state, exit history with penalty avoided) and LP page `/app/vault` (deposit, withdraw, NAV, premium earned, exits, average discount, Envio tables). Design system in docs/DESIGN.md; two screenshot review passes at 375, 768 and 1440 px in docs/screenshots/. Lighthouse (mobile): performance 98, 92, 91 and accessibility 100 on all three routes.
- M5 done locally (`572be50`): Envio HyperIndex 3.12 config, handlers and entities for every Shield event; the web history views read its GraphQL endpoint; README names Envio under Bounties. The hosted deployment waits for the owner's Envio login (`scripts/deploy-indexer.sh`), so the "reads from the hosted endpoint" criterion is open.
- Tests (`4049b06`, `66e127f`, `eb5da03`, `1dc476c`): all five rounds in docs/TEST-REPORT.md. Round 1: 101 Foundry tests including fork, fuzz and invariant; Slither and Aderyn findings fixed or justified in docs/SECURITY.md; keeper 33, indexer 2; workspace lint, test and build clean. Round 2: the video script under Playwright on a mainnet fork, every claim checked against receipts. Round 3: 27 adversarial scenarios, each with a test. Round 4: a fresh clone followed the README quick start word for word; every step passed, 101 Foundry tests against live mainnet. Round 5: two clean-fork rehearsals plus the scripted mainnet flow, recorded in docs/DEMO.md.
- M6 prepared: `scripts/deploy-mainnet.sh`, `scripts/demo-position.sh` (seed, position, open, keeper, nudge), `scripts/proof.sh`, `scripts/web-env.sh` and `scripts/deploy-indexer.sh`; the first four exercised on a fork. Runbook, account funding and video steps in docs/DEMO.md.
- M7 prepared: README has Why Monad, the comparison table, gas numbers, the Envio statement, both disclosures and the license; the Deployments and Proof tables fill from `scripts/proof.sh`.
- CI: paused at the owner's request during the build (`8f059c8`), restored in the final commit of this session.
- Next, for the owner: fund the four mainnet accounts and run docs/DEMO.md Part 2; Envio login and hosted indexer; record the video; flip the repo to public; register and submit on hackathon.monad.xyz.
- Blocked on the owner: mainnet MON, WETH and USDC and the four keys; testnet MON for the live `eth_sendRawTransactionSync` smoke check (`0xeDA6994BC554131E1c5370f5fE9Afe4dD02c4089`); Envio login and HyperSync token; the exact Envio bounty card text (portal login); repo visibility. Optional: Pyth Hermes key, WalletConnect project id, Monadscan API key.

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
