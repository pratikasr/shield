# Shield

Opt-in early exit for borrowers on Aave V3 Monad. Set a trigger a little above the liquidation line. When your position reaches it, a vault repays part of your debt and takes collateral at a 1% discount instead of Aave's 5.5% liquidation bonus on WETH. The price of that protection is recomputed every 300 ms block.

Built for Track 01 (Onchain Finance and Trading) of [Monad Metropolis](https://www.monad.xyz/developers/hackathons/metropolis). Submission closes 13 Oct 2026, 11:59pm ET.

## What it is, what it is not

Borrowers with large or illiquid collateral cannot deleverage by swapping without paying more than 1% in slippage. On Aave V3 Monad that is bridged WETH and cbBTC borrowed against stablecoins: on 5 Oct 2026, selling 1 WETH on Uniswap V3 Monad quoted 3.8% under the oracle price. Today these borrowers hold extra buffer, set alerts, or eat Aave's liquidation bonus (5.5% on WETH, 7% on cbBTC). Shield gives them a priced, opt-in exit at 1%.

Shield does not race liquidators. Aave on Monad runs Chainlink SVR via Atlas: the price update that pushes a position under water arrives in the same bundle as the winning liquidator's transaction. Shield triggers above health factor 1.0. That is the only honest design, and it is why the trigger is the borrower's choice.

Anyone may call `exit` when the condition holds. The keeper is a convenience, not a trust assumption.

## Why Monad

- 300 ms blocks make per-block premium repricing meaningful. On a 12-second chain the premium would be repriced 40 times less often and the keeper would act minutes late.
- MIP-8 page-ified storage: each borrower record is packed into one 128-slot storage page, and each collateral's 200-observation volatility window into another, so after the first access every further slot costs 100 gas. Every keeper transaction carries an EIP-2930 access list with one key per page. Measured on a mainnet fork: `repriceMany` 523,194 gas without the list, 192,094 with it (63% less); `exit` 1,203,849 without, 682,349 with (43% less).
- The keeper reads health factors on the `pending` (proposed) tag and submits with `eth_sendRawTransactionSync`, which returns the receipt on the proposed block; finality follows in 600 ms.
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

Premium per block: `p = k * sigma * V / max(d, d_min) * dt`, where V is the debt covered, sigma is realised collateral volatility from Pyth over the last N blocks, d is the distance between current HF and the trigger, d_min bounds the premium, and dt is one block. The borrower prepays a balance; when it runs out, cover lapses and the UI shows "unprotected".

### Pricing parameters

| Parameter | Value | Meaning |
| --- | --- | --- |
| `k` (WETH) | 0.00125 | Calibrated so a position at distance d = 0.05 with 80% annualised volatility pays 2% of covered debt a year: 0.02 = k x 0.80 / 0.05 |
| `k` (cbBTC) | 0.00125 | Same calibration. The formula already carries each asset's own volatility, so the same target gives the same k |
| `d_min` | 0.01 | Floor on the HF distance; caps the premium at 5x the d = 0.05 rate |
| `N` | 200 | Pyth observations in the realised-volatility window |
| sigma fallback | 80% | Used until a feed has 10 observations; realised sigma is clamped to [10%, 500%] |
| Default trigger | 1.04 | Borrower's choice, between 1.01 and 2.00 |
| Exit discount | 1% | Borrower's max discount must be at least this (default 1%, at most 5%) |
| Exit target | trigger + 0.06 | The exit repays enough debt to bring HF back to this |

The calibration is a Foundry test: `test_calibration_kGivesTwoPercentAtD5Sigma80` in [contracts/test/unit/PremiumMath.t.sol](contracts/test/unit/PremiumMath.t.sol).

Full design: [docs/SPEC.md](docs/SPEC.md). Stack and reasoning: [docs/TECH-DECISIONS.md](docs/TECH-DECISIONS.md).

## Contracts

| Contract | Responsibility |
| --- | --- |
| `PositionRegistry` | One packed record per opted-in borrower, page-aligned for MIP-8 |
| `Repricer` | Per-block premium from Pyth price, realised volatility and distance to trigger; accrues against the prepaid balance |
| `Executor` | The exit: vault funds or flash loan, `Pool.repay` on behalf of the borrower, `aToken.transferFrom` at 1.01x, reverts unless HF improves and stays above 1.0 |
| `ShieldVault` | ERC-4626 vault in USDC; LPs fund exits and earn premiums plus the 1% discount. NAV is USDC, seized aTokens at Aave's oracle, and premium accrued at the Repricer |
| `UniswapV3Swapper` | Helper: the bounded swap the flash-loan fallback and vault unwinds use (Uniswap V3 on Monad) |

The exit is permissionless: anyone may call `Executor.exit` when the conditions hold, and the contract checks every one of them. The keeper is a convenience, not a trust assumption. Trust model and static-analysis results: [docs/SECURITY.md](docs/SECURITY.md).

## Compared with what exists

| | Shield | Morpho pre-liquidation | Euler V2 native | DeFi Saver automation |
| --- | --- | --- | --- | --- |
| Lender covered | Aave V3 Monad | Morpho Blue only | Euler vaults only | Aave, Morpho, others |
| On Monad today | Yes | Yes, Morpho Blue markets only | Yes | No (6 chains, not Monad) |
| Mechanism | Opt-in early trigger, vault repays, 1% discount | Opt-in preLIF and preLltv, permissionless caller | Reverse Dutch auction from 0% discount | Repay from collateral via swap |
| Cost to borrower | Premium per block plus 1% on seized collateral | preLIF discount | Rising discount | About 0.08% plus swap slippage |
| Who funds the exit | Vault LPs, flash-loan fallback | Any liquidator | Any liquidator | Borrower's own collateral |
| Wins when | Collateral is illiquid or large; swap slippage exceeds 1% | Borrower is on Morpho | Borrower is on Euler | Collateral is liquid |

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
| Gas (forge snapshot, Monad execution, cold state) | `exit` funded by the vault 1,113,356; `exit` through the flash-loan fallback 1,716,714; `reprice` of one borrower 523,633; `repriceMany` of three 716,151. Source: [contracts/snapshots/](contracts/snapshots/), [contracts/.gas-snapshot](contracts/.gas-snapshot) |
| Gas with the keeper's access list (mainnet fork) | steady-state `repriceMany` for one borrower 192,094 (523,194 without); `exit` 682,349 (1,203,849 without) |
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

The first fork-test run takes about 12 minutes, because every state read goes to the public RPC. Foundry caches that state per pinned block, so pin one with `FORK_BLOCK=<block>` (public RPCs keep about 100,000 blocks of state, roughly eight hours): a rerun at the same block took 4.4 minutes on 5 Oct 2026. Test runs do not rewrite the committed gas figures; `FORGE_SNAPSHOT_EMIT=true MONAD_RPC_URL=https://rpc.monad.xyz FORK_BLOCK=110596951 forge snapshot` refreshes them at the block they were measured at, for as long as Foundry's cache or an archive RPC holds it.

### Run the whole thing locally

Everything against a local fork of Monad mainnet (a test environment; the header says "Local fork"):

```bash
bash scripts/stack.sh up      # fork, Shield deployment, LP deposit, a borrower position, Envio, keeper, web
```

Open http://localhost:3200, choose "Fork test wallet" in Connect, set a trigger, approve, prepay and opt in. The keeper reprices every block. `bash scripts/stack.sh down` stops everything. `bash scripts/e2e.sh` runs the same flow under Playwright and checks every on-screen claim against the fork's receipts.

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
| Contracts: unit, fork, fuzz, invariant | `cd contracts && MONAD_RPC_URL=https://rpc.monad.xyz forge test` | 101 tests pass |
| Static analysis | Slither 0.11.6, Aderyn 0.6.8 | every high and medium fixed or justified in [docs/SECURITY.md](docs/SECURITY.md) |
| Keeper | `pnpm --filter keeper test` | 81 tests pass; 2 live smoke tests run with `LIVE_SMOKE=1` |
| Indexer | `pnpm --filter shield-indexer test` | 5 tests pass |
| End to end, the video script on a fork | `bash scripts/e2e.sh` | passes |
| Demo rehearsal | two clean-fork runs of `scripts/e2e.sh` and one run of the scripted mainnet flow | pass; blocks and hashes in [docs/DEMO.md](docs/DEMO.md) |
| Lighthouse (mobile) | landing, borrower, LP | performance 94, 94, 91; accessibility and best practices 100 on all |

Dates, commands and outcomes for every round: [docs/TEST-REPORT.md](docs/TEST-REPORT.md).

## Bounties

Envio: every Shield event (opt-ins, triggers, each per-block reprice, exits, vault deposits, withdrawals, premiums and collateral flows) is indexed with Envio HyperIndex (`indexer/`). The web app's exit history, repricing history, covered-positions table, vault activity and the LP premium rate read from its GraphQL endpoint. HyperSync serves Monad mainnet; the same indexer runs against the local fork over RPC.

## Disclosures

- Pre-existing code: none. Everything in this repository was written for this hackathon. OpenZeppelin Contracts, Aave V3 interfaces and the Pyth Solidity SDK are dependencies.
- AI tools: Claude (Anthropic) via Claude Code and Cowork, used for research, specification, code generation, testing and documentation.

## License

MIT. See [LICENSE](LICENSE).
