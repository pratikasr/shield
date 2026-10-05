# Shield: Technical Decisions

Decision log in ADR form. Each entry is a decision that is already made; agents build on it rather than reopening it. To change one, add a new entry that supersedes it and say why. Dates are when the decision was recorded.

## ADR-001 One monorepo, not separate repos (5 Oct 2026)

Decision: `pratikasr/shield` holds contracts, keeper, web, indexer, docs and scripts.

Why: Metropolis takes one repo link and judges the commit history of that repo. Contracts, keeper and web share ABIs and change together; a split would mean four repos to keep in sync and four histories to show. No GitHub organization: repos under the personal account are easier to connect to build agents and to submit.

Layout:

```
shield/
  contracts/    Foundry: PositionRegistry, Repricer, Executor, ShieldVault, tests, deploy scripts
  keeper/       TypeScript on viem: proposed-block watcher, exit submitter
  web/          Next.js with wagmi: borrower opt-in, LP vault dashboard
  indexer/      Envio HyperIndex: positions, repricing, exits (Envio bounty)
  docs/         SPEC.md, TECH-DECISIONS.md, PROGRESS.md
  scripts/      deployment, demo position setup, repricing capture
  CLAUDE.md     agent guide (AGENTS.md points here)
```

TypeScript packages (`keeper`, `web`, `indexer`) live in one pnpm workspace at the repo root. `contracts/` is a standalone Foundry project; its `out/` ABIs are consumed by the TypeScript packages through a small `abi` export step in `scripts/`.

## ADR-002 Contracts: Solidity with Foundry (5 Oct 2026)

Decision: Solidity 0.8.x (latest Foundry default at M1; record the exact version under Verified facts), Foundry for build, test and deploy. Dependencies: OpenZeppelin Contracts v5 (`ERC4626`, `SafeERC20`, `ReentrancyGuard`, `Ownable2Step`), Aave V3 interfaces from `aave-v3-origin` (`IPool`, `IAToken`, `IPoolAddressesProvider`, `IFlashLoanSimpleReceiver`), Pyth `pyth-sdk-solidity` (`IPyth`, `PythStructs`).

Why: Foundry gives mainnet-fork tests for every Aave interaction, gas snapshots for the "measured and documented" claim, and one-command deploys with verification. Nothing in Shield needs an upgradeable proxy; contracts are immutable with an owner for parameters only.

EVM target: set `evm_version` in `foundry.toml` to what Monad supports. Resolved at M0: Prague, with Foundry 1.8 `network = "monad"` (ADR-019 and Verified facts).

## ADR-003 Keeper in TypeScript on viem (5 Oct 2026)

Decision: Node 22, TypeScript, viem, vitest. One long-running process.

Why: viem exposes raw RPC calls (`client.request`) so `eth_sendRawTransactionSync`, the `pending` block tag and `monadNewHeads` subscriptions are one-liners; ABIs come straight from the Foundry build and are shared with `web/` with full typing. Rust was considered and rejected on merit: no ABI sharing with the web app, slower iteration, and nothing in the keeper is CPU-bound.

## ADR-004 Web in Next.js 15 with wagmi and viem (5 Oct 2026)

Decision: Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, wagmi v2 + viem, RainbowKit for wallet connection. Live values (HF, premium per block, prepaid balance) are read directly from RPC on the proposed tag; history (positions, repricing, exits, vault flows) comes from the Envio indexer's GraphQL endpoint.

## ADR-005 Indexer on Envio HyperIndex (5 Oct 2026)

Decision: an Envio HyperIndex project indexing `OptedIn`, `TriggerSet`, `OptedOut`, `Repriced`, `Exited`, `Deposit`, `Withdraw` on Monad mainnet, deployed to Envio's hosted service. This is the Envio bounty deliverable and the README says so.

Verified 5 Oct 2026: Envio HyperSync supports Monad mainnet (chain 143, `https://143.hypersync.xyz`) and Monad testnet (chain 10143, `https://10143.hypersync.xyz`). Source: docs.envio.dev/docs/HyperIndex/supported-networks.

## ADR-006 Oracles: Pyth for pricing, Aave's own view for the trigger (5 Oct 2026)

Decision: the Repricer uses Pyth pull-oracle prices (update attached to the calldata) for realised volatility and distance. The trigger and the post-exit safety check use Aave's `getUserAccountData`, which reflects Aave's own Chainlink SVR feeds. The two never disagree about whether an exit is allowed, because only Aave's HF decides that.

Why: Aave's HF is what liquidators act on; pricing premium off a different feed is fine, gating exits off a different feed is not.

Verified 5 Oct 2026 (docs.monad.xyz/tooling-and-infra/oracles): Pyth is live on Monad mainnet and testnet. Testnet price feeds contract `0x2880aB155794e7179c9eE2e38200202908C17B43`; MON/USD feed id `0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1`. Mainnet contract address: resolved at M0, `0x2880aB155794e7179c9eE2e38200202908C17B43` (Verified facts).

## ADR-007 Networks (5 Oct 2026)

Decision: Monad mainnet (chain id 143) for deployment, proof and the demo. Monad testnet (chain id 10143) for staging only. Local Anvil forks of mainnet for Foundry tests and nothing else; a fork never appears in the video.

Verified 5 Oct 2026 (docs.monad.xyz/developer-essentials/network-information): mainnet chain id 143, native token MON, public RPCs `https://rpc.monad.xyz`, `https://rpc1.monad.xyz`, `https://rpc2.monad.xyz`, `https://rpc3.monad.xyz`, `https://rpc-mainnet.monadinfra.com`; explorers `https://monadvision.com` and `https://monadscan.com`.

## ADR-008 Registry storage layout for MIP-8 (5 Oct 2026)

Decision: each borrower record is packed into as few slots as possible and placed at a page-aligned base slot derived from the borrower address, so one EIP-2930 access-list entry warms the whole record. Field packing: trigger (uint32, HF x 1e4), maxDiscountBps (uint16), prepaid balance (uint128), accrued premium (uint128), last repriced block (uint64), flags (uint8). The exact slot arithmetic follows MIP-8's page definition; page size and warm and cold costs were verified at M0 (Verified facts).

## ADR-009 Pricing parameters (5 Oct 2026)

Decision: `k` per collateral asset, `d_min`, and the volatility window `N` are registry parameters set by the owner and published in the README. Initial values are a human decision before mainnet deployment (see CLAUDE.md). The Repricer is pure given those inputs, so it is unit-tested with fixed price series.

## ADR-010 Flash-loan fallback (5 Oct 2026)

Decision: when the vault cannot fund the full repay, the Executor borrows the gap with Aave `flashLoanSimple` and repays it from the seized aTokens (withdrawn to the underlying) in the same transaction. The flash-loan premium is a cost to the LPs, taken out of the 1% discount. Aave Monad's flash premium is 5 bps (Verified facts). Superseded in part by ADR-029: a flash-assisted exit must leave the vault whole.

## ADR-011 Testing and CI (5 Oct 2026)

Decision:

- Foundry unit tests for the Repricer math and registry packing; fork tests (`--fork-url` mainnet) for every Aave call path including the flash-loan fallback and the HF invariant; `forge snapshot` committed for the Executor's gas.
- Keeper: vitest with a recorded RPC fixture; one live smoke test against testnet behind an env flag.
- Web: Playwright smoke of the opt-in page against testnet.
- GitHub Actions on every push: `forge fmt --check`, `forge build`, `forge test` (fork tests use an RPC URL secret and are skipped if absent), `pnpm lint`, `pnpm test`, `pnpm build`. Added in M1.

## ADR-012 Secrets (5 Oct 2026)

Decision: deployer key and keeper key only in environment variables (`.env`, ignored). `.env.example` lists names with empty values. Deployment uses `forge script` with `--private-key` from the environment or a Foundry keystore, never a key in a file in the repo.

## ADR-013 License, visibility, disclosures (5 Oct 2026)

Decision: MIT from the first commit (OSI-approved, required by Metropolis). The repo is private at creation and must be flipped to public before submission; commit history is unaffected by the flip. All code in this repo is written for this hackathon; OpenZeppelin, Aave interfaces and the Pyth SDK are dependencies, not pre-existing project code. AI tools: Claude (Anthropic) via Claude Code and Cowork, named in the README and the submission.

## ADR-014 Out of scope (5 Oct 2026)

Execution Events SDK (mentioned as the path to sub-block latency, not used); Chainlink CRE bounty; EIP-7702 delegated accounts; LP governance over holding versus unwinding seized collateral (hackathon build unwinds immediately).

## ADR-015 Demo path: real Aave V3 Monad position only (5 Oct 2026)

Decision: the proof and the video use one real Aave V3 Monad position (WETH collateral, USDC debt). The own-Morpho-market path is not built. Supersedes the "recommended: both" line in SPEC.md, Demo plan.

Why: the human pre-made this choice for the run, and M0 shows the Aave path can be exercised end to end on mainnet: USDC is borrowable and repayable on behalf (no caller restriction in `ValidationLogic.validateRepay` beyond an explicit amount), WETH is collateral outside eMode, flash loans are enabled on USDC and WETH, and Pyth has a live ETH/USD push feed. The HF move that triggers the exit comes from a real borrower action (an extra USDC borrow) or from the market; both are real Monad transactions. Nothing in the demo is mocked.

## ADR-016 Collateral is WETH (and cbBTC); debt asset is the vault asset, USDC (5 Oct 2026)

Decision: the demo collateral is WETH, not MON. The registry supports any Aave reserve that is collateral outside eMode and has a Pyth feed; at launch it lists WETH (Pyth ETH/USD) and cbBTC (Pyth CBBTC/USD). The debt Shield repays must be in the vault asset, USDC. The vault asset is USDC (human decision, pre-made).

Why: Aave V3 Monad has no WMON reserve (`Pool.getReservesList()` on 5 Oct 2026 returns 13 reserves, none of them MON). SPEC.md's "collateral MON" cannot be exercised. WETH on Monad is a bridged asset with thin DEX liquidity (Uniswap V3 WETH/USDC 0.3% pool holds 2.2 WETH; selling 1 WETH quotes 3.8% under the oracle), which is exactly the illiquid-collateral borrower Shield is for. Restricting the debt asset to the vault asset avoids a swap on the repay leg. eMode positions are out of scope: Aave's eMode liquidation bonus on Monad is 1% (categories 3 and 4), so Shield's 1% discount saves nothing there.

## ADR-017 Pyth: on-chain push feeds first, Hermes update optional (5 Oct 2026)

Decision: `reprice` and `exit` take `bytes[] pythUpdate`, which may be empty. When it is non-empty the contract pays `getUpdateFee` from `msg.value` and calls `updatePriceFeeds`; either way it then reads the on-chain price. The keeper attaches a Hermes update only when `PYTH_HERMES_API_KEY` is set. Exit requires the Pyth price to be no older than `exitMaxPriceAge` (default 3,600 s, the push heartbeat).

Why: Hermes has required an API key since 26 Aug 2026 (unauthenticated `GET /v2/updates/price/latest` returns 401). Pyth pushes sponsored feeds on Monad mainnet (ETH/USD and BTC/USD at 0.02% deviation, 1 h heartbeat), so a fresh on-chain price exists whenever the market moves. Pyth's role is premium pricing and an exit sanity bound; Aave's own HF still gates every exit (ADR-006).

## ADR-018 Flash-loan fallback swaps seized collateral through an owner-set swapper (5 Oct 2026)

Decision: supersedes the mechanism in ADR-010. When the vault's idle USDC is below the repay amount, the Executor flash-borrows the gap in USDC with `flashLoanSimple`, repays the borrower's debt, pulls the borrower's aWETH, withdraws enough WETH and swaps it to USDC through an `ISwapper` set by the owner, then repays the flash loan plus the 5 bp premium. The swap is exact-output with `amountInMaximum` bounded by the Aave oracle price and `maxSwapSlippageBps`; if the market cannot meet it, the exit reverts and the LPs lose nothing. Leftover collateral is re-supplied to Aave on behalf of the vault. The launch swapper is Uniswap V3 `SwapRouter02` on Monad.

Why: the flash loan is in USDC but the seized collateral is WETH, so a same-transaction swap is the only way to close the loan. Bounding it against the oracle keeps the LP loss per exit capped at the configured slippage.

## ADR-019 Foundry 1.8 with Monad execution (5 Oct 2026)

Decision: supersedes the EVM target note in ADR-002. Foundry 1.8.4 (official foundryup build), `network = "monad"` in `foundry.toml`, solc `evm_version = "prague"`. Forge tests, `forge snapshot` and Anvil then use Monad's gas model, including MIP-8 page accounting (MonadTen). CI pins Foundry v1.8.4.

Why: Foundry releases before 1.8 do not include Monad execution, so a 1.7 gas snapshot would price storage like Ethereum and the README's gas numbers would be wrong for Monad. Block headers on mainnet carry `requestsHash` (Prague shape); Monad's docs ship `evm_version = "prague"` in the Foundry template.

## ADR-020 Where each kind of test runs (5 Oct 2026)

Decision: Aave V3 is not deployed on Monad testnet, so every Aave-dependent test (Foundry fork tests, keeper end to end, web end to end with Playwright) runs against a local Anvil fork of Monad mainnet. Monad testnet is used for what exists there: keeper RPC behaviour (`monadNewHeads`, `eth_sendRawTransactionSync`), Pyth reads, and an Envio index of a testnet deployment of the registry and repricer events. The fork is for testing only and never appears in the demo or the README proof tables.

Why: the human pre-made this rule for the case M0 found. Monad's protocol registry lists no Aave on testnet and the Aave address book has no Monad testnet market.

## ADR-021 Exit sizing and discount (5 Oct 2026)

Decision: an exit repays enough debt to bring HF back to `trigger + exitHfBuffer` (default buffer 0.06, so 1.04 goes to 1.10). With D the debt and HF the health factor from `getUserAccountData`, LT_c the liquidation threshold of the seized collateral and delta the exit discount, the repay value is `r = D * (H_t - HF) / (H_t - (1 + delta) * LT_c)`, capped by the borrower's USDC debt and by the aToken balance that can be seized. The seized collateral is `(1 + delta) * r` valued at Aave's oracle. delta is the registry's `exitDiscountBps` (default 100); the borrower's `maxDiscountBps` is a ceiling that delta must not exceed, and opt-in rejects a ceiling below the current delta. The trigger must lie in [1.01, 2.00]. After the exit the record closes; unused prepaid premium stays withdrawable. `savedVsAave` is `r * (aaveLiquidationBonus - 1 - delta)` in USDC: the penalty Aave would charge on the same repaid debt, minus Shield's discount.

Why: restoring a target HF is what a borrower who sets a trigger wants, and the closed form is exact for a single-collateral position. HF always improves when `HF / LT_c > 1 + delta` (for WETH, any HF above 0.85), so the after-exit check in the Executor is a guard, not the sizing method. Aave's aToken `transferFrom` checks the borrower's HF stays at or above 1 (`SupplyLogic.executeFinalizeTransfer`), which the repay-first order always satisfies at these sizes.

## ADR-022 Pricing defaults and the calibration of k (5 Oct 2026)

Decision: supersedes the "human decision" note in ADR-009 with the human's pre-made values: `d_min = 0.01`, `N = 200` price samples, trigger default 1.04, max discount default 100 bps. `k` is calibrated so that a position at distance d = 0.05 with 80% annualised realised volatility pays 2% of covered debt per year: `0.02 = k * 0.80 / 0.05`, so `k = 0.00125` for every listed collateral. The calibration lives in a Foundry test and the values are published in the README. Covered debt V is the borrower's total debt value from `getUserAccountData`. Per block, `p = k * sigma * V / max(d, d_min) * (blockTimeMs / 1000) / 31,536,000`, charged for every block since the last reprice.

Why: the formula already scales by each asset's own volatility, so the same target lands on the same k for WETH and cbBTC; k stays per asset so a risk premium can be added later without a redeploy.

## ADR-023 Realised volatility lives in one MIP-8 page per feed (5 Oct 2026)

Decision: the Repricer keeps, per Pyth feed, a ring buffer of the last N = 200 distinct Pyth observations (price and publish time, two observations per slot) plus a header slot, all inside one 128-slot page. A new observation is recorded only when its publish time is newer than the last one. Variance per second is the sum of squared simple returns over the window divided by the window's time span, annualised with 31,536,000 s. Until 10 observations exist the asset's fallback sigma applies (80% for WETH and cbBTC); sigma is clamped to [10%, 500%].

Why: the whole volatility state for an asset costs one cold page access (8,100 gas) and 100 gas per further slot under MIP-8, which is what makes per-block repricing cheap on Monad. Dividing by elapsed time, not by sample count, keeps the estimate right when push updates arrive irregularly.

## ADR-024 Vault holds USDC and seized aTokens; NAV at Aave's oracle (5 Oct 2026)

Decision: `ShieldVault` is an ERC-4626 over USDC with a 6-decimal virtual-share offset. `totalAssets()` is idle USDC plus every seized aToken balance valued at the Aave oracle and converted to USDC. A keeper role calls `unwind(asset, amount, minOut)` to withdraw seized collateral from Aave and swap it to USDC through the same swapper, bounded by oracle price and `maxSwapSlippageBps`. Premiums arrive as USDC from the Repricer on every reprice.

Why: on Monad, unwinding a large WETH amount immediately would cost more than the 1% discount (3.8% slippage for 1 WETH on 5 Oct 2026), so forcing an unwind inside the exit would hand the LPs a loss. Holding aWETH earns Aave supply yield and the oracle valuation is the same one Aave uses for HF. The SPEC's "unwind immediately" becomes "unwind when the swap clears the slippage bound".

## ADR-025 Keeper repricing cadence is configurable (5 Oct 2026, measured figures added the same day)

Decision: the keeper reprices every proposed block by default (`REPRICE_EVERY_N_BLOCKS=1`) and batches all active records into one `repriceMany` call per block. A `REPRICE_WINDOW_BLOCKS` setting bounds a continuous every-block run (used to capture the consecutive repricing transactions for the proof), after which the keeper falls back to `REPRICE_IDLE_EVERY_N_BLOCKS`. The health-factor watch and exits always run every block.

Why: measured on a mainnet fork, a steady-state `repriceMany` for one borrower uses 192,094 gas with the keeper's access list; with the 15% buffer and 25,000 headroom the limit is about 246,000 gas, about 0.025 MON at the 100 gwei base fee (MON at $0.0334 on 5 Oct 2026). One every 300 ms is about 7,200 MON a day (0.025 MON x 288,000 blocks; corrected in the 5 Oct audit from an earlier 8,500). Accrual is charged per elapsed block, so a slower cadence changes how often the number updates, not what the borrower pays.

## ADR-026 Repricing moves no tokens; the vault pulls premium (5 Oct 2026)

Decision: supersedes the "premiums arrive on every reprice" line of ADR-024. `reprice` and `repriceMany` only update accounting; accrued premium waits in the Repricer as `pendingToVault`. `Repricer.sweep()` moves whole USDC units to the vault; anyone may call it, and the vault calls it itself before it pays out (exit funding, LP withdrawals). The vault counts pending premium in `totalAssets()` and `availableLiquidity()`, so NAV and the LP dashboard still move every block.

Why: on the fork rehearsal the per-block transfer to the vault fired whenever pending premium crossed one USDC unit, which touched the USDC proxy, its implementation and the vault cold and added about 61,000 gas the previous block's estimate had not seen; several `repriceMany` calls ran out of gas. Without the transfer, steady-state reprice gas is constant (58 of 61 consecutive fork reprices used exactly 193,018 gas) and the cold single-borrower figure fell from 618,956 to 523,162.

## ADR-027 Keeper access lists are built from the node and Shield's own pages (5 Oct 2026)

Decision: every keeper transaction carries an EIP-2930 access list: the node's `eth_createAccessList` result merged with the registry record page and the volatility-window page (from the contracts' `recordSlot` and `volSlot` views), reduced to one key per (address, 128-slot page).

Why: under MIP-8 an access-list address costs 2,400 and a key 1,900, against 10,100 for a cold account and 8,100 for a cold page. Measured on the fork: `repriceMany` 523,194 gas without a list, 192,094 with it (63% less); `exit` 1,203,849 without, 682,349 with (43% less). This is the "page-warmed registry" claim in numbers.

## ADR-028 Swaps are trusted by balance, not by return value (5 Oct 2026, audit F1)

Decision: `ShieldVault.unwind` and `Executor._sellForShortfall` measure the USDC actually received (balance after minus before) and check it against their bounds; collateral the swap adapter leaves behind is supplied back to Aave for the vault.

Why: the audit proved that an owner-set adapter could take all seized collateral and report a fill without paying, because the vault trusted the returned number. With balance checks, the most a bad or captured adapter can cost is the slippage bound.

## ADR-029 A flash-assisted exit must leave the vault whole (5 Oct 2026, audit F2; supersedes the LP-loss note in ADR-018)

Decision: a flash-funded exit reverts (`VaultWouldLose`) unless the collateral and USDC the vault keeps are worth at least the USDC the vault put in, at Aave's oracle.

Why: with a small vault contribution and a large flash leg, a swap filled at the Executor's own price bound could consume the whole seized amount, so the vault paid USDC and received nothing. ADR-018's statement that LP loss is capped at the slippage setting was wrong.

## ADR-030 Exit gains unlock over six hours (5 Oct 2026, audit F3)

Decision: the vault's `totalAssets` subtracts exit gains still unlocking; each exit's gain (collateral value kept minus USDC paid) unlocks linearly over `PROFIT_UNLOCK_SECONDS` (6 hours). `grossAssets` and `lockedProfit` expose the parts.

Why: an exit raised the share price at once, so a deposit, permissionless exit and redeem in one transaction (with a free Morpho flash loan for the deposit) took about 98% of the discount owed to the LPs who carried the cover. Streaming gains is the standard defence and adds no per-user state that could be griefed.

## ADR-031 Cover cannot be bought at the moment it is needed (5 Oct 2026, audit H-1, M-4)

Decision: three rules.

- Cover must have been held for `Executor.minCoverSeconds` before it can exit. The clock restarts at opt-in, at a top-up that restores a lapsed cover, and at a trigger raise. The launch value is 900 s; it is owner-set within 0 to 7 days, and fork rehearsals use 20 s.
- A position at or below its trigger is priced at the d_min floor, the most expensive rate, never zero.
- Opting in needs at least 1 USDC prepaid.

Why: a borrower could keep a lapsed record, restore it with 0.000001 USDC when HF crossed the trigger, and exit in the same block; or opt in with a trigger above HF and exit at once. Either way the premium was optional, and combined with ADR-030's attack a healthy borrower could sell collateral to the vault at the oracle price for about 0.02%. The minimum prepay also keeps free dust records out of the keeper's batch.

## ADR-032 Premium billing resists timing (5 Oct 2026, audit M-2, M-3)

Decision: each interval since the last reprice is billed at the higher of the stored rate and the live rate. `optOut` settles the blocks since the last reprice through `Repricer.settleForOptOut` before closing the record.

Why: `reprice` is permissionless and stored the next interval's rate from instantaneous Aave state, so a borrower could add collateral for one transaction, reprice, and pay almost nothing for the next interval. Opting out skipped the final interval, and opt-out/opt-in cycling evaded every charge.

## ADR-033 Bounded owner inputs and a hardened volatility window (5 Oct 2026, audit L-1, L-2, L-3)

Decision:

- k is at most 0.0125, ten times the launch value.
- The fallback volatility is 10% to 500%.
- The block time is 100 to 2,000 ms.
- Each squared return in the volatility window is capped at a 100% move.
- Pyth prices are stored at a fixed 8-decimal scale.

Why: with an unbounded k the owner could reprice every prepaid balance into the vault within minutes. A single bad print could saturate the running sum and later brick every reprice and exit for that feed. A Pyth exponent change read as a 100x move.

## ADR-034 cbBTC is listed but disabled at launch (5 Oct 2026, audit M-5; supersedes the cbBTC part of ADR-016)

Decision: the deployment configures cbBTC (feed `0x2817d7bf…7aff9a97`, verified) but leaves it disabled.

Why: Monad's Uniswap V3 has no cbBTC/USDC pool at any fee tier, only cbBTC/WETH, and the swap adapter is single-hop. A cbBTC exit's flash fallback would always revert, and seized cbBTC could never be sold to USDC. It can be enabled once a multi-hop or aggregator route exists.

## ADR-035 What Shield is for, after checking liquidity (5 Oct 2026)

Decision: Shield is positioned as an exit enforced on chain, at a trigger the borrower sets, at a known 1% cost, without watching the market. It is aimed at larger positions and at moments when liquidity thins. It is not positioned as a fix for collateral that cannot be sold.

Why: the claim that WETH is thin on Monad came from one Uniswap V3 pool (3.8% for 1 WETH). Aggregators route through deeper venues and quoted 0.06% for 1 WETH and 0.49% for 50 WETH (Verified facts). For collateral that is cheap to swap, a swap-based deleverage costs less, and the site says so.

## ADR-036 Keeper spending limits and repricing defaults (5 Oct 2026, from the pre-mainnet audit)

Decision: supersedes the defaults in ADR-025. The keeper reprices every block for `REPRICE_WINDOW_BLOCKS` (default 600, about 3 minutes) from its start, then every `REPRICE_IDLE_EVERY_N_BLOCKS` (200) counted from the last reprice; 0 still means no end and fork rehearsals use it. It reprices only records that are active, not lapsed, with prepaid premium left and a clean preview, riskiest first, in chunks under `MAX_GAS_REPRICE`. Below `MIN_BALANCE_FOR_EXIT_WEI` (0.2 MON) it stops repricing and keeps the balance for exits. A `repriceMany` gas limit is measured when the batch changes and again every 20 blocks or after a failure; in between, the last limit measured for the same batch is reused, so every transaction still carries a measured limit. A reverted receipt counts as out of gas only when an `eth_call` replay at the same limit runs out of gas, because Monad receipts report gas used equal to the limit.

Why: with no window, every-block repricing of one borrower costs about 7,200 MON a day (ADR-025), and a keeper left running would spend its balance on reprices while a due exit could not be paid for. Lapsed or empty covers cannot be charged, so repricing them only spends gas. One `repriceMany` for every borrower stops fitting under the ceiling at about 50 borrowers, and one reverting borrower blocked the whole batch. The cached limit and access list cut a steady pass from 9 sequential round trips to 3, which keeps three reprices in consecutive 300 ms blocks within reach on mainnet.

## ADR-037 A protocol share of premiums; the exit discount stays with liquidity providers (5 Oct 2026)

Decision: `PositionRegistry.protocolShareBps` (default 1000 at deploy, 10%; capped in code at `MAX_PROTOCOL_SHARE_BPS`, 2000) of every premium charge goes to `PositionRegistry.treasury` (default: the owner; `SHIELD_TREASURY` and `SHIELD_PROTOCOL_SHARE_BPS` override it at deploy). The Repricer splits each charge when it bills it, into `pendingToVault` and `pendingToTreasury` (one storage slot). `sweep()` pays the vault, as before; `sweepProtocol()`, which anyone may call, pays the treasury and emits `ProtocolPremiumPaid`. The two are separate because the vault sweeps before every withdrawal and exit, so a treasury that cannot receive USDC (a blocklisted address, for example) must not be able to stop the vault. A change of share applies from the next charge; premium already charged keeps its split. The whole exit discount still goes to the vault, and the borrower's cost is unchanged.

Why: a clear protocol revenue line the owner cannot raise past a fixed cap. Premiums are the steady income and accrue every 300 ms block. The exit discount is what pays liquidity providers for holding the seized collateral's price risk (SECURITY.md, Known limits), so taking part of it would weaken the side that funds exits. Splitting at charge time keeps the split exact, and the exit path, the most audited code, does not change. The share is packed into the slot that already holds the exit parameters, so a reprice reads it from a slot it already touches; the second pending counter shares a slot with the first.

## ADR-038 Analytics from the indexer; a live Monad block stream; other lenders shown as coming soon (5 Oct 2026)

Decision:
- The indexer keeps earnings buckets (since deployment, per UTC day, per hour): premiums charged and their split, treasury payouts, gross exit discounts, exits, debt repaid, savings against Aave's bonus, reprices, opt-ins, deposits and withdrawals. It also keeps a config row and the treasury payouts.
- A public analytics page reads those buckets, plus live values from the chain on the proposed tag. It shows a live block stream from `monadNewHeads`, where each block moves through Proposed, Voted, Finalized and Verified and the keeper's reprices land in it. On a fork, which has no `monadNewHeads`, it falls back to polling and says so.
- Euler V2, Morpho Blue, Curvance and Neverland are shown as coming soon, with their Monad TVL from DefiLlama and its date.
- The one WETH/USDC liquidation in Aave Monad's history is shown as a worked example, with its transaction hash.

Why:
- Judges and users should see what the platform earns, who earns it, and that it runs block by block on Monad. The data comes from Envio and the chain, never from fixtures.
- An aggregate "liquidation penalties paid on Monad" figure was dropped: Aave Monad has had one liquidation (Verified facts). One real, checkable example is more honest than a thin total.
- Other lenders need their own exit path and fork tests, so they are listed, not built, before the deadline.

## Verified facts

Append one line per fact, with the date checked and the source. Agents append here as M0 items are resolved.

- 5 Oct 2026: Monad mainnet chain id 143, token MON, RPCs and explorers as in ADR-007. Source: docs.monad.xyz/developer-essentials/network-information.
- 5 Oct 2026: Monad testnet chain id 10143. Source: docs.envio.dev/docs/HyperIndex/supported-networks.
- 5 Oct 2026: Envio HyperSync supports Monad 143 and 10143. Source: same page.
- 5 Oct 2026: Pyth live on Monad mainnet and testnet; testnet price feeds contract and MON/USD feed id as in ADR-006. Source: docs.monad.xyz/tooling-and-infra/oracles.
- 4 Oct 2026: Aave V3 on Monad launched July 2026 with Chainlink SVR via Atlas from day one. Source: monad.xyz/blog/aave-third-largest-fee-generator.
- 4 Oct 2026: MIP-12 300 ms blocks; MIP-8 page-ified storage live since 2 Sep 2026. Source: mips.monad.xyz.
- 4 Oct 2026: Metropolis submission closes 13 Oct 2026 11:59pm ET; judging five criteria at 20% each; OSI license and public repo required; AI tools must be disclosed. Source: hackathon.monad.xyz rules (gated) as quoted in an entrant's README.
- 5 Oct 2026: Aave V3 Monad addresses. PoolAddressesProvider `0x34793Fb9935F7bB5E5aE920fb963F39063E7A615`, Pool `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` (confirmed: `PoolAddressesProvider.getPool()` returns it), AaveOracle `0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf`, ProtocolDataProvider `0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad`. Source: github.com/bgd-labs/aave-address-book `src/AaveV3Monad.sol`, checked on chain with `cast call` against rpc.monad.xyz.
- 5 Oct 2026: Aave V3 Monad runs aave-v3-origin v3.7.0 (`Pool.POOL_REVISION()` = 11, matching `PoolInstance.sol` at tag v3.7.0). Source: on chain and github.com/aave-dao/aave-v3-origin.
- 5 Oct 2026: Aave Monad reserves (13): USDT0, USDC, USDe, mUSD, AUSD, WETH, cbBTC, wstETH, weETH, syrupUSDC, sUSDe, GHO, PT-AUSD-8OCT2026. No WMON. Source: `Pool.getReservesList()`.
- 5 Oct 2026: reserve parameters outside eMode (LTV / liquidation threshold / liquidation bonus): WETH 80.50% / 84.00% / 105.50%; cbBTC 73.00% / 78.00% / 107.00%; USDC 75.00% / 78.00% / 107.50%, borrowing enabled, active, not frozen, not paused. wstETH, weETH, sUSDe, syrupUSDC and the PT token have LTV 0 outside eMode. eMode 3 (wstETH/WETH) is 94% / 96% / 101%. Source: `ProtocolDataProvider.getReserveConfigurationData`, `Pool.getEModeCategoryCollateralConfig(3)`.
- 5 Oct 2026: token addresses. USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (aUSDC `0x35a73BAcb179d3740395A3ceCc87FF2e581d6042`, variable debt `0x9F555aB84C4e0a531B50283f09Dba7A97134c4e4`); WETH `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` (aWETH `0x4377b53aAA8b8e3fF7AA2843832CAF004f5Cb8b6`); cbBTC `0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b` (acbBTC `0x1F5e388861A32226c716e922CE748a6FEE5e8e57`). Source: `getReserveTokensAddresses` and the address book.
- 5 Oct 2026: Aave flash loans. `FLASHLOAN_PREMIUM_TOTAL` = 5 (0.05%), `FLASHLOAN_PREMIUM_TO_PROTOCOL` = 10000 (all of it to the protocol); flash loans enabled on USDC, WETH, cbBTC. USDC reserve: 177.4M supplied, 161.6M borrowed. Source: on chain.
- 5 Oct 2026: `repay(asset, amount, 2, onBehalfOf)` is open to any caller; the only on-behalf rule is that `amount` must not be `type(uint256).max`. Source: `ValidationLogic.validateRepay` at v3.7.0.
- 5 Oct 2026: aToken `transferFrom` out of a borrower runs `ValidationLogic.validateHFAndLtvzero` when the asset is collateral and the borrower has debt: HF after the transfer must be at least 1.0, and LTV-0 collateral must be moved first. Since v3.6 the receiver does not get the asset enabled as collateral, and a max allowance is not consumed. Since v3.5 the scaled transfer amount rounds up, so the receiver gets at least the requested amount. Source: aave-v3-origin v3.7.0 `SupplyLogic.executeFinalizeTransfer`, docs/3.5 and docs/3.6 feature notes.
- 5 Oct 2026: Aave oracle sources are Chainlink-style feeds: USDC "Capped USDC / USD" `0x787962943811D279d01eC973Bd3A15f1b3e1F0D9`, WETH "ETH / USD (USD Scaled)" `0x47F1D18329Ae59341617B7a5BE59605B63f0e373`, cbBTC "CBBTC / USD (USD Scaled)" `0x48692d15DA2636E1b0335344104Ce9d92f231DdA`; base currency unit 1e8. Source: `AaveOracle.getSourceOfAsset` and `description()`.
- 5 Oct 2026: Pyth mainnet PriceFeed contract `0x2880aB155794e7179c9eE2e38200202908C17B43` (same address as testnet), Entropy `0xD458261E832415CFd3BAE5E416FdF3230ce6F134`. `getUpdateFee([])` and `singleUpdateFeeInWei()` return 0. Feed ids: ETH/USD `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace`, CBBTC/USD `0x2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97`, USDC/USD `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a`, MON/USD `0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1`. Sponsored push feeds: ETH and BTC at 0.02% deviation and 1 h heartbeat. Read on chain: ETH $2,729.06, MON $0.0334. Source: github.com/monad-crypto/protocols `mainnet/pyth.jsonc`, then `cast call` on mainnet.
- 5 Oct 2026: Pyth Hermes requires an API key since 26 Aug 2026; `hermes.pyth.network/v2/updates/price/latest` returns HTTP 401 without one, while `/v2/price_feeds` still answers. Source: direct request; docs.pyth.network/price-feeds/core/api-instances-and-providers/hermes.
- 5 Oct 2026: block tags. `latest` and `pending` both map to Proposed, `safe` to Voted, `finalized` to Finalized. Source: docs.monad.xyz/reference/json-rpc/overview.
- 5 Oct 2026: `eth_sendRawTransactionSync` is recognised by rpc.monad.xyz (Monad/0.16.4): an invalid payload returns code 5 "The transaction is not ready to be processed", while an unknown method returns -32601. A funded transaction is still needed to confirm the receipt shape (see docs/PROGRESS.md). Source: direct request.
- 5 Oct 2026: `monadNewHeads` subscriptions work on wss://rpc.monad.xyz, wss://rpc1.monad.xyz, wss://rpc3.monad.xyz and wss://rpc-mainnet.monadinfra.com. Each block arrives as Proposed, then Voted one block later, then Finalized, then Verified, each with `blockId` and `commitState`. Source: direct subscription.
- 5 Oct 2026: measured block time 304 ms (1,000 blocks in 304 s ending at block 110,588,957); block timestamps are whole seconds. Base fee 100 gwei, `eth_gasPrice` 102 gwei. Source: `cast block`, `cast gas-price`.
- 5 Oct 2026: MIP-8 (Final). Page = 128 slots, `page_index = slot >> 7`. SLOAD: 8,100 for the first touch of a page, 100 after. SSTORE: 100 base, plus 8,000 if the page is cold, plus 2,800 on the first value-changing write to the page, plus 17,000 per net-new slot. Access-list keys in the same page pay the cold cost once. Cold account access 10,100. Source: mips.monad.xyz/MIPs/MIP-8 and docs.monad.xyz/developer-essentials/opcode-pricing.
- 5 Oct 2026: Monad charges `gas_bid * gas_limit`; max contract size 128 KB, init code 256 KB; EIP-7702 delegated EOAs keep a 10 MON reserve. Source: docs.monad.xyz/developer-essentials/differences.
- 5 Oct 2026: EVM target. Mainnet headers carry `requestsHash` (Prague shape). Foundry 1.8 or later provides Monad execution (`network = "monad"`, MonadTen, MIP-8 accounting) in forge, anvil and cast; releases before 1.8 do not. Installed: forge 1.8.4. Source: docs.monad.xyz/tooling-and-infra/toolkits/foundry, `cast block`.
- 5 Oct 2026: Morpho Blue `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee` and `PreLiquidationFactory` `0xB5b3e541abD19799E0c65905a5a42BD37d6c94c0` are live on Monad mainnet (bytecode present, factory's `MORPHO()` returns the Morpho address). The SPEC comparison row "On Monad today: No" for Morpho pre-liquidation was wrong and is corrected. Source: github.com/monad-crypto/protocols `mainnet/morpho.jsonc`, on chain.
- 5 Oct 2026: Euler V2 is live on Monad mainnet (`mainnet/euler.jsonc`). DeFi Saver supports Ethereum, Arbitrum, Optimism, Base, Linea and Plasma, not Monad. Source: monad-crypto/protocols; help.defisaver.com/general/compatibility/supported-chains-and-protocols.
- 5 Oct 2026: Uniswap V3 on Monad: factory `0x204faca1764b154221e35c0d20abb3c525710498`, SwapRouter02 `0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900`, QuoterV2 `0x661e93cca42afacb172121ef892830ca3b70f08d`. WETH/USDC 0.3% pool `0x25EF1a210fF55BcEe9F8fee979aAFf6bD1bE5Bf1` holds 2.23 WETH and 8,048 USDC; QuoterV2 gives 2,625.57 USDC for 1 WETH against an Aave oracle price of 2,728.78 (3.8% under). Source: monad-crypto/protocols `mainnet/uniswap.jsonc`, on chain.
- 5 Oct 2026: Aave V3 is not on Monad testnet: monad-crypto/protocols `testnet/` lists no Aave entry and the address book has no Monad testnet market. Source: GitHub API listing.
- 5 Oct 2026: the testnet faucet (faucet.monad.xyz) sits behind a Vercel security checkpoint and returns HTTP 429 to scripted requests; testnet MON must be claimed by a person in a browser.
- 5 Oct 2026 (corrected in the audit the same day): the public prizes page lists "$1,000 Best Use of Envio" plus "$5,000 Free Envio Cloud hosting for winning teams"; an earlier note quoted different hosting terms. The bounty requirement text is behind the portal login; the version quoted by other entrants reads: "Meaningfully use Envio's HyperIndex, HyperSync, or HyperRPC to power real on-chain data driving a core feature in your app", with evidence being a working indexer, its endpoints consumed by the app, and documentation. VERIFY: log in at hackathon.monad.xyz/tracks and read the Envio bounty card.
- 5 Oct 2026: contract verification. MonadVision: `forge verify-contract <addr> <name> --chain 143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/` (no API key). Monadscan: `--verifier etherscan --etherscan-api-key <key>` (Etherscan v2 key). Source: docs.monad.xyz/guides/verify-smart-contract/foundry.
- 5 Oct 2026: Anvil 1.8.4 forking Monad mainnet supports `eth_sendRawTransactionSync`, `eth_createAccessList`, `newHeads` subscriptions and `anvil_dealERC20`, but not `monadNewHeads`; interval mining at `--block-time 0.3` gives about 300 ms blocks. Source: direct requests against a local fork.
- 5 Oct 2026: `eth_createAccessList` is served by rpc.monad.xyz; `eth_maxPriorityFeePerGas` returns 2 gwei. Source: direct requests.
- 5 Oct 2026: gas under Monad execution (Foundry 1.8.4, cold state, fork of block 110,596,951): `exit` funded by the vault 1,109,278; through the flash-loan fallback 1,714,904; `reprice` of one borrower 618,956; `repriceMany` of three 827,870. Most of it is cold account (10,100) and cold page (8,100) access across Aave, its oracles and token proxies. Source: `contracts/snapshots/`.
- 5 Oct 2026: access-list effect under Monad execution (Anvil 1.8.4 fork of block 110,596,951): `repriceMany` for one borrower 523,194 gas without an access list, 192,094 with one (20 addresses, 31 keys); `exit` 1,203,849 without, 682,349 with (51 keys). Source: `pnpm --filter keeper measure` against the fork.
- 5 Oct 2026: `monadNewHeads` subscriptions work on the testnet WebSocket (wss://testnet-rpc.monad.xyz) as on mainnet. Source: keeper live smoke test.
- 5 Oct 2026: gas under Monad execution after ADR-026 and the Pyth confidence and SafeCast changes (Foundry 1.8.4, cold state, fork of block 110,596,951): `exit` funded by the vault 1,113,356; through the flash-loan fallback 1,716,714; `reprice` of one borrower 523,633; `repriceMany` of three 716,151; vault unwind 844,384. Supersedes the earlier gas line for current code. Source: `contracts/snapshots/`.
- 5 Oct 2026: Homebrew's Foundry is 1.7.1 and rejects `network = "monad"` ("unknown variant"); a forge 1.8.4 script against an Anvil 1.7.1 fork fails with "unknown monad hardfork 'Bpo1'". Both tools must be 1.8 or later; `scripts/require-foundry.sh` checks before any forge step. Source: `forge --version`, local runs.
- 5 Oct 2026: Monad mainnet gas price 102 gwei; Aave oracle WETH price $2,726.39 (`getAssetPrice` 272639000000). Source: `cast gas-price`, `cast call` on rpc.monad.xyz at block 110,645,044.
- 5 Oct 2026 (audit): KyberSwap's aggregator on Monad, at block 110,699,392 with Aave's WETH oracle at $2,723.63, quoted:
  - 1 WETH: 2,722.11 USDC, 0.06% under the oracle.
  - 10 WETH: 0.08% under; 25 WETH: 0.14% under; 50 WETH: 0.49% under (135,526.85 USDC).
  - cbBTC (oracle $86,214): 0.1 at the oracle, 1 at 0.23% under, 2 at 1.10% under.
  - Routes went through Hanji CLOB, Uniswap v4, WOOFi and Balancer v3.
  - The Uniswap V3 WETH/USDC 0.3% pool alone holds about 2.25 WETH (3.81% under the oracle for 1 WETH at block 110,699,054).
- 5 Oct 2026 (audit): Uniswap V3 on Monad has no cbBTC/USDC pool at fee 100, 500, 3000 or 10000 (`getPool` returns zero); a cbBTC/WETH 0.3% pool exists at `0x79A779D8C4c1F625B562C4bA9432e65AC8b713e0`.
- 5 Oct 2026 (audit): Pyth CBBTC/USD feed `0x2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97` is live on Monad (Hermes `/v2/price_feeds` and on chain at block 110,698,656).
- 5 Oct 2026 (audit): Aave V3 Monad eMode categories:
  - 1, syrupUSDC to stables: bonus 4%.
  - 2, USDe/sUSDe to stables: 4%.
  - 3, wstETH borrowing WETH: 1%.
  - 4, weETH borrowing WETH: 1%.
  - 5, PT: 2.44%.
  - No category uses WETH or cbBTC as collateral. Source: `Pool.getEModeCategoryCollateralConfig`.
- 5 Oct 2026 (audit): DeFi Saver charges a 0.25% service fee on uncorrelated swaps plus 0.05% per automated adjustment, with gas charged to the position. Source: help.defisaver.com fees page.
- 5 Oct 2026 (audit): Euler V2 liquidation discounts start at zero at the liquidation threshold and rise linearly as health worsens. Source: Euler docs.
- 5 Oct 2026 (audit): Morpho Blue on Monad holds about 14.47M USDC and charges no flash-loan fee, so capital-free same-transaction deposits are realistic (the reason for ADR-030).
- 5 Oct 2026 (audit): rpc.monad.xyz served account state 500,000 blocks back (block 110,200,773) and failed at 2,000,000.
- 5 Oct 2026 (audit): on Monad mainnet a receipt's `gasUsed` equals the transaction's gas limit (all 38 transactions in block 110,698,158), so a revert cannot be told from out-of-gas by gas used.
- 5 Oct 2026 (audit): mainnet base fee 100 gwei; `eth_maxPriorityFeePerGas` 2 gwei. Round trip from the build machine to rpc.monad.xyz on a reused connection: 82 to 90 ms, with spikes of 1.1 to 2.3 s.
- 5 Oct 2026: Lending protocols with TVL on Monad mainnet, by DefiLlama's Monad TVL: Aave V3 $324.0M, Euler V2 $258.6M, Morpho Blue $192.7M, Curvance $128.7M, Neverland $8.5M (then Gearbox, Folks Finance and TownSquare under $0.3M each). Source: https://api.llama.fi/protocols, filtered to chain Monad, category Lending.
- 5 Oct 2026: Aave V3 Monad's Pool (0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef) has emitted one `LiquidationCall` from block 0 to 110,740,416: block 98,106,057 (22 Aug 2026), tx 0xa5ce55310328c30e978a1c778a9cd11f95bf08c8eb4f21affb853d44fcfe7794. WETH collateral, USDC debt, user 0xc556d420ebd20fb8b3763bffeebf16fa61250443. 1,670.686190 USDC repaid; 0.728710735618030097 WETH to the liquidator plus 0.003818874745973479 aWETH to Aave's treasury, 0.732529610364003697 WETH in total. Source: `eth_getLogs` in 20M-block ranges on rpc1.monad.xyz, and the transaction receipt.
- 5 Oct 2026: The last Pyth ETH/USD update on Monad before that liquidation (block 98,106,025, publish time 1787375497) was $2,400.81. At that price the WETH taken was worth $1,758.66, $87.98 (5.27%) above the debt repaid; a 1% exit on the same repayment costs $16.71. Aave's 5.5% bonus implies an oracle price of $2,406.15, within 0.2% of Pyth. Source: Pyth `PriceFeedUpdate` logs on 0x2880aB155794e7179c9eE2e38200202908C17B43. Pyth's historical HTTP APIs (benchmarks and Hermes by timestamp) answered 401 without a key.
- 5 Oct 2026: `monadNewHeads` on wss://rpc.monad.xyz accepts a subscription from a client that sends a browser Origin header, so the web app can subscribe directly; blocks arrived about every 300 ms as Proposed, then Voted, Finalized and Verified. Source: direct subscription with Origin set.
