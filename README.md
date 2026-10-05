# Shield

Opt-in early exit for borrowers on Aave V3 Monad. Set a trigger a little above the liquidation line. When your position reaches it, a vault repays part of your debt and takes collateral at a 1% discount, plus a per-block premium while you are covered, instead of Aave's 5.5% liquidation bonus on WETH. The premium is recomputed every 300 ms block.

Built for Track 01 (Onchain Finance & Trading) of [Monad Metropolis](https://www.monad.xyz/developers/hackathons/metropolis). Submission closes 13 Oct 2026, 11:59pm ET.

## What it is, what it is not

Swapping collateral to deleverage is cheap on Monad for most sizes: on 5 Oct 2026 an aggregator quoted 0.06% under Aave's oracle for 1 WETH and 0.49% for 50 WETH. What a borrower cannot buy today is an exit that happens on its own, on chain, at a health factor they choose, without watching the market. Today they hold extra buffer, set alerts, or eat Aave's liquidation bonus (5.5% on WETH). Shield gives WETH borrowers with USDC debt an opt-in exit, enforced by the contracts, at a known 1% plus a per-block premium. It matters most for large positions and for the moments when liquidity thins. cbBTC is listed but disabled until a cbBTC/USDC swap route exists on Monad (ADR-034).

Shield does not race liquidators. Aave on Monad runs Chainlink SVR via Atlas: the price update that pushes a position under water arrives in the same bundle as the winning liquidator's transaction. Shield triggers above health factor 1.0. That is the only honest design, and it is why the trigger is the borrower's choice.

Anyone may call `exit` when the condition holds. The keeper is a convenience, not a trust assumption.

## Why Monad

- 300 ms blocks make per-block premium repricing meaningful. On a 12-second chain the premium would be repriced 40 times less often and an exit could wait up to 12 seconds for the next block.
- MIP-8 page-ified storage: each borrower record is packed into one 128-slot storage page, and each collateral's 200-observation volatility window into another, so after the first access every further slot costs 100 gas. Every keeper transaction carries an EIP-2930 access list naming the pages it will touch, Aave's and Shield's, with one key per page. Measured on a mainnet fork: `repriceMany` 523,194 gas without the list, 192,094 with it (63% less); `exit` 1,203,849 without, 682,349 with (43% less). Most of the saving is Aave's and the tokens' pages; Shield's own layout keeps its share to one page per record and one per feed.
- The keeper reads health factors on the proposed block (`latest`, the same as `pending` on Monad) and submits with `eth_sendRawTransactionSync`, which returns the receipt from the proposed block; finality follows in 600 ms. On a local fork the receipt came back in about 290 ms; the mainnet figure will be published with the proof.
- Gas is charged as gas_limit x price on Monad, so every keeper call uses a measured limit and the Executor's gas is published below.

## How it works

```mermaid
flowchart TB
    subgraph everyblock [Every block]
        B[Borrower] -->|optIn: trigger, max discount, prepay| PR[PositionRegistry]
        K[Keeper] -->|reprice + Pyth update| RP[Repricer]
        RP -->|premium accrues| PR
    end
    subgraph exit [When HF reaches the trigger]
        K2[Keeper] -->|exit + Pyth update + access list| EX[Executor]
        V[ShieldVault ERC-4626] -->|funds repay| EX
        EX -->|repay onBehalfOf borrower| AAVE[Aave V3 Monad]
        EX -->|take aTokens worth 1.01x| AAVE
        EX -->|HF must end above 1.0 and above pre-exit| EX
        FL[flashLoanSimple] -.->|fallback if vault short| EX
    end
```

Premium per block: `p = k * sigma * V / max(d, d_min) * dt`, where V is the borrower's total Aave debt in USD (not the smaller amount an exit repays), sigma is realised collateral volatility from the last 200 Pyth observations, d is the distance between current HF and the trigger (at or below the trigger d is taken as d_min, the most expensive rate), d_min bounds the premium, and dt is one block. Each interval is billed at the higher of the stored and the live rate. The borrower prepays at least 1 USDC; when it runs out, cover lapses and the UI shows "unprotected". New, restored or raised cover can exit only after a 15-minute waiting period (ADR-031).

### Who earns what

| Income | Liquidity providers (the vault) | Protocol treasury |
| --- | --- | --- |
| Premiums, charged every block | 90% | 10% at launch; the owner can set 0% to 20%, capped in the contract (ADR-037) |
| Exit discount, 1% of the debt an exit repays | 100%: it pays for holding the seized collateral's price risk | none |

The borrower's cost is the same either way: the protocol's part comes out of the premium, never on top of it. The Repricer splits each charge when it bills it, so a change of share never reaches premium already charged. Earnings by hour, day and since deployment come from the Envio indexer and appear on the app's Analytics page.

### Pricing parameters

| Parameter | Value | Meaning |
| --- | --- | --- |
| `k` (WETH) | 0.00125 | Calibrated so a position at distance d = 0.05 with 80% annualised volatility pays 2% of covered debt a year: 0.02 = k x 0.80 / 0.05 |
| `k` (cbBTC) | 0.00125 | Same calibration (cbBTC is configured but disabled at launch, ADR-034). The owner can set k up to 0.0125 |
| `d_min` | 0.01 | Floor on the HF distance; caps the premium at 5x the d = 0.05 rate |
| `N` | 200 | Pyth observations in the realised-volatility window |
| sigma fallback | 80% | Used until a feed has 10 observations; realised sigma is clamped to [10%, 500%] |
| Default trigger | 1.04 | Borrower's choice; the contract accepts 1.01 to 2.00 |
| Waiting period | 15 minutes | Time cover must be held before it can exit (owner-set, at most 7 days) |
| Minimum prepay | 1 USDC | Needed to opt in |
| Exit discount | 1% | Borrower's max discount must be at least this (default 1%, at most 5%) |
| Exit target | trigger + 0.06 | The exit repays enough debt to bring HF back to this |
| Protocol share | 10% of premiums | Paid to the treasury by `sweepProtocol()`, which anyone may call; at most 20% (`MAX_PROTOCOL_SHARE_BPS`) |

The calibration is a Foundry test: `test_calibration_kGivesTwoPercentAtD5Sigma80` in [contracts/test/unit/PremiumMath.t.sol](contracts/test/unit/PremiumMath.t.sol).

Full design: [docs/SPEC.md](docs/SPEC.md). Stack and reasoning: [docs/TECH-DECISIONS.md](docs/TECH-DECISIONS.md).

## Contracts

| Contract | Responsibility |
| --- | --- |
| `PositionRegistry` | One packed record per opted-in borrower, page-aligned for MIP-8 |
| `Repricer` | Per-block premium from Pyth price, realised volatility and distance to trigger; accrues against the prepaid balance |
| `Executor` | The exit: vault funds or flash loan, `Pool.repay` on behalf of the borrower, `aToken.transferFrom` at 1.01x, reverts unless HF improves and stays above 1.0, and (on the flash path) unless the vault gets back at least what it paid |
| `ShieldVault` | ERC-4626 vault in USDC; LPs fund exits and earn premiums plus the 1% discount. NAV is USDC, seized aTokens at Aave's oracle, and premium accrued at the Repricer, less exit gains still unlocking (they reach the share price over six hours) |
| `UniswapV3Swapper` | Helper: the bounded swap the flash-loan fallback and vault unwinds use (Uniswap V3 on Monad) |

The exit is permissionless: anyone may call `Executor.exit` when the conditions hold, and the contract checks every one of them. The keeper is a convenience, not a trust assumption. Trust model and static-analysis results: [docs/SECURITY.md](docs/SECURITY.md).

## Compared with what exists

| | Shield | Morpho pre-liquidation | Euler V2 native | DeFi Saver automation |
| --- | --- | --- | --- | --- |
| Lender covered | Aave V3 Monad | Morpho Blue only | Euler vaults only | Aave, Morpho, others |
| On Monad today | Yes | Yes, Morpho Blue markets only | Yes | No (6 chains, not Monad) |
| Mechanism | Opt-in early trigger, vault repays, 1% discount | Opt-in preLIF and preLltv, permissionless caller | Liquidation discount that starts at 0% and rises as health worsens | Repay from collateral via swap |
| Cost to borrower | Premium per block plus 1% of the debt repaid | preLIF discount | A discount that rises as health worsens | About 0.3% per automated repay (0.25% service fee plus 0.05% automation fee), plus gas and slippage |
| Who funds the exit | Vault LPs, with a small flash-loan fallback | Any liquidator | Any liquidator | Borrower's own collateral |
| Wins when | You want an on-chain exit at a set health factor on Aave Monad, for large positions or thin moments | Borrower is on Morpho | Borrower is on Euler | Collateral is cheap to swap, on chains it supports |

## Repository layout

| Path | What |
| --- | --- |
| `contracts/` | Foundry project: contracts, unit, fork, fuzz and invariant tests, deploy and demo scripts |
| `keeper/` | TypeScript keeper on viem |
| `web/` | Next.js app: landing, borrower page, LP page; Playwright end-to-end and review specs |
| `indexer/` | Envio HyperIndex for positions, repricing, exits and vault flows |
| `docs/` | Spec, technical decisions, design, security, test report, demo runbook, progress log |
| `scripts/` | Mainnet deploy, demo position, indexer deploy, local fork stack, end-to-end run |
| `CLAUDE.md` | Guide for coding agents working in this repo |

## Status

| Milestone | State |
| --- | --- |
| M0 Verify external facts | done |
| M1 Scaffold contracts, keeper, web, indexer | done |
| M2 Contracts and Foundry tests | done |
| M3 Keeper | done, on a mainnet fork (Aave is not on Monad testnet, ADR-020) |
| M4 Web | done, rehearsed end to end on a mainnet fork |
| M5 Envio indexer | done locally; the hosted deployment needs the owner's Envio login (`scripts/deploy-indexer.sh`) |
| M6 Mainnet deployment and proof | scripted and rehearsed; waiting for mainnet funds and keys |
| M7 Submission | waiting for M6 and the video |

## Deployments (Monad mainnet, chain id 143)

Not deployed yet. `bash scripts/deploy-mainnet.sh` deploys and writes `contracts/deployments/143.json` once every address holds code (it refuses to run again while that file exists, unless `--force`); `bash scripts/verify-mainnet.sh` verifies on MonadVision (and Monadscan with `ETHERSCAN_API_KEY`) and can be rerun on its own. The addresses go here.

| Contract | Address |
| --- | --- |
| PositionRegistry | not deployed yet (M6) |
| Repricer | not deployed yet (M6) |
| Executor | not deployed yet (M6) |
| ShieldVault | not deployed yet (M6) |
| UniswapV3Swapper | not deployed yet (M6) |

## Proof

Filled during M6 with Monad mainnet transactions only, from `bash scripts/proof.sh`, which checks every address and receipt on chain first; every item will open on [monadvision.com](https://monadvision.com) or [monadscan.com](https://monadscan.com). The fork rehearsals in [docs/DEMO.md](docs/DEMO.md) are tests, not proof.

| Item | Value |
| --- | --- |
| Opt-in tx | not yet (M6) |
| Three consecutive repricing txs | not yet (M6) |
| Exit tx (`Exited` event) | not yet (M6) |
| Protocol share paid to the treasury (`ProtocolPremiumPaid`) | not yet (M6) |
| Gas (forge snapshot, Monad execution, cold state, with the protocol share) | `exit` funded by the vault 1,178,113; `exit` through the flash-loan fallback 1,852,786; `reprice` of one borrower 526,248; `repriceMany` of three 704,199; vault `unwind` 849,073. The protocol share added about 2,100 gas to a reprice (0.4%) and 2,400 to an exit. Source: [contracts/snapshots/](contracts/snapshots/), [contracts/.gas-snapshot](contracts/.gas-snapshot) |
| Gas with the keeper's access list (mainnet fork, measured before the audit fixes with `pnpm --filter keeper measure`) | steady-state `repriceMany` for one borrower 192,094 (523,194 without); `exit` 682,349 (1,203,849 without) |
| Envio indexer endpoint | not yet (needs the owner's Envio login) |
| Demo video | not yet (M6) |

## Quick start

Requirements: git, [Foundry](https://getfoundry.sh) 1.8 or later (`foundryup`; earlier versions have no Monad execution), Node 22 or later, pnpm 11, and Docker for the local indexer.

```bash
git clone --recurse-submodules https://github.com/pratikasr/shield.git
cd shield

# contracts: unit tests run offline; set MONAD_RPC_URL to also run the fork tests against real Aave on Monad
cd contracts
forge build
forge test
MONAD_RPC_URL=https://rpc.monad.xyz forge test
cd ..

# keeper, web, indexer
pnpm install
pnpm -r build
pnpm lint
pnpm test
```

If you cloned without `--recurse-submodules`, run `git submodule update --init` first.

The first fork-test run takes about 12 minutes, because every state read goes to the public RPC. Foundry caches that state per pinned block, so pin one with `FORK_BLOCK=<block>` (rpc.monad.xyz served state 500,000 blocks back on 5 Oct 2026, about 40 hours): a rerun at the same block took 4.4 minutes on 5 Oct 2026. Test runs do not rewrite the committed gas figures; `FORGE_SNAPSHOT_EMIT=true MONAD_RPC_URL=https://rpc.monad.xyz FORK_BLOCK=110596951 forge snapshot` refreshes them at the block they were measured at, for as long as Foundry's cache or an archive RPC holds it.

### Run the whole thing locally

Everything against a local fork of Monad mainnet (a test environment; the header says "Local fork"):

```bash
bash scripts/stack.sh up      # fork, Shield deployment, LP deposit, a borrower position, Envio, keeper, web
```

Open http://localhost:3200, choose "Fork test wallet" in Connect, set a trigger, approve, prepay and opt in. The keeper reprices every block. `bash scripts/stack.sh down` stops everything. `bash scripts/e2e.sh` runs the same flow under Playwright and checks the video script's key claims against the fork's receipts.

### On Monad mainnet

Keys stay in Foundry keystores and, for the keeper, in a `chmod 600` key file outside the repo; none goes on a command line or in the shell's environment (docs/DEMO.md shows how to create them).

```bash
export MONAD_RPC_URL=https://rpc.monad.xyz MONAD_WS_URL=wss://rpc.monad.xyz
export DEPLOYER_ACCOUNT=shield-deployer DEMO_ACCOUNT=shield-borrower LP_ACCOUNT=shield-lp
export KEEPER_PRIVATE_KEY_FILE=~/.shield/keeper.key KEEPER_ADDRESS=$(cat ~/.shield/keeper.address)
bash scripts/deploy-mainnet.sh            # refuses local RPCs, any chain but 143, and an existing 143.json
bash scripts/verify-mainnet.sh            # sends nothing; rerun until every contract is verified
bash scripts/demo-position.sh seed
bash scripts/demo-position.sh open
bash scripts/demo-position.sh keeper
bash scripts/demo-position.sh nudge       # after the 15-minute waiting period; checks the cover first
bash scripts/web-env.sh && pnpm --filter web build && pnpm --filter web start
bash scripts/proof.sh                     # Deployments and Proof rows, each checked on chain
```

The full runbook, account funding, the video steps and the fork rehearsals are in [docs/DEMO.md](docs/DEMO.md).

## Tests

| What | Command | Result |
| --- | --- | --- |
| Contracts: unit, fork, fuzz, invariant | `cd contracts && MONAD_RPC_URL=https://rpc.monad.xyz forge test` | 130 tests pass: 89 unit, fuzz and invariant (mocks), 41 fork tests against real Aave on Monad |
| Static analysis | Slither 0.11.6, Aderyn 0.6.8 | every high and medium fixed or justified in [docs/SECURITY.md](docs/SECURITY.md) |
| Keeper | `pnpm --filter keeper test` | 81 tests pass; 2 live smoke tests run with `LIVE_SMOKE=1` |
| Indexer | `pnpm --filter shield-indexer test` | 6 tests pass |
| Web: amounts, risk maths, analytics series | `pnpm --filter web test` | 47 tests pass |
| End to end, the video script on a fork | `bash scripts/e2e.sh` | passes |
| Demo rehearsal | two clean-fork runs of `scripts/e2e.sh` and one run of the scripted mainnet flow | pass; blocks and hashes in [docs/DEMO.md](docs/DEMO.md) |
| Lighthouse (mobile) | landing, borrower, LP, analytics | with devtools throttling, performance 99 on all four; with the default simulated throttling on a shared machine, 96 on the landing page and 84 to 90 on the app pages, which load the wallet libraries. Accessibility and best practices 100 and CLS 0 on all |

Dates, commands and outcomes for every round: [docs/TEST-REPORT.md](docs/TEST-REPORT.md). The internal audit of 5 Oct 2026 (contracts, keeper, indexer, scripts, web, live QA and every claim in these docs), its findings and their fixes: [docs/AUDIT.md](docs/AUDIT.md). Shield has had no external audit.

## Bounties

Envio: every user-facing Shield event (opt-ins, triggers, each per-block reprice, exits, vault deposits, withdrawals, share transfers, premiums and collateral flows) is indexed with Envio HyperIndex (`indexer/`). The web app's exit history, repricing history, covered-positions table, vault activity and the LP premium rate read from its GraphQL endpoint. HyperSync serves Monad mainnet; the same indexer runs against the local fork over RPC.

## Disclosures

- Pre-existing code: none. Everything in this repository was written for this hackathon. OpenZeppelin Contracts, Aave V3 interfaces and the Pyth Solidity SDK are dependencies.
- AI tools: Claude (Anthropic) via Claude Code and Cowork, used for research, specification, code generation, testing and documentation.

## License

MIT. See [LICENSE](LICENSE).
