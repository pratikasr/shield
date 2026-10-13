# Metropolis submission text

The text entered on hackathon.monad.xyz for Track 01, kept here so it stays in step with the code. Figures come from the README, docs/TEST-REPORT.md and the Verified facts in docs/TECH-DECISIONS.md.

## Project name

Shield

## One-line description

An opt-in early exit for Aave V3 borrowers on Monad: at a health factor you choose, a vault repays part of your debt for a 1% discount instead of Aave's 5.5% liquidation bonus.

## Description

```text
Problem
Aave V3 borrowers on Monad whose health factor falls below 1.00 are liquidated: a liquidator repays part of the debt and takes collateral worth 5.5% more than it repaid (Aave's bonus on WETH). Avoiding that means watching the market around the clock or handing a bot your keys. Aave Monad's one liquidation so far shows the cost: on 22 Aug 2026 (block 98,106,057) a borrower paid $87.98 above the $1,670.69 of debt that was repaid. A 1% exit on the same repayment would have cost $16.71.

Solution
Shield is an opt-in early exit, enforced on chain. A borrower picks a trigger health factor (for example 1.05), approves Shield to move their aWETH, and prepays a small USDC premium. When Aave's health factor reaches the trigger, anyone can call exit(), and in one transaction:
- Pyth's price is checked against Aave's oracle; they must agree within 2%.
- A USDC vault repays part of the borrower's debt, enough to lift the health factor to the trigger plus 0.06. An Aave flash loan covers any shortfall in the vault.
- Shield takes aWETH worth the repaid amount plus 1%, instead of Aave's 5.5%.
- The transaction reverts unless the health factor ends above 1.0 and higher than it started.
New cover waits 15 minutes before it can exit, so it cannot be bought at the moment it is needed.

Pricing
The premium follows risk: p = k x sigma x V / max(d, d_min) per block, where V is the borrower's debt, sigma the collateral's realised volatility over the last 200 Pyth prices, and d the distance between the health factor and the trigger. k is calibrated so a position 0.05 above its trigger at 80% volatility pays 2% of its debt a year. The rate moves with the position: closer to the trigger costs more.

Who earns what
A USDC vault (ERC-4626) funds exits. At launch it is protocol-funded: the treasury is its only depositor, so all of Shield's income goes to the protocol. 10% of each premium is paid to the treasury directly (capped at 20% in the contract); the rest of the premium and the whole 1% exit discount accrue to the vault, which holds the seized collateral until it is sold. Premium income accrues every block while covers are active; exit income depends on volatility and timing. Outside liquidity providers are on the roadmap: the vault has a depositor allowlist, so they can be added without a redeploy.

Premium from any chain (Aurora Intents)
Every borrower has a deposit address on Monad, a CREATE2 forwarder known before it is deployed. Aurora Intents delivers USDC there from any of its supported chains, and the forwarder executes on arrival: sweepPremium, run by the keeper or anyone, turns it into the borrower's prepaid premium. The borrower never needs MON, a bridge or a network switch to keep cover funded. The treasury funds the vault the same way, and an Aurora refund goes back to the sender on the origin chain.

Why Monad
- 300 ms blocks. The keeper subscribes to monadNewHeads, reads health factors on the proposed block, and sends exits with eth_sendRawTransactionSync, which returns the receipt in the same call. On a mainnet fork the exit's receipt came back about 290 ms after sending.
- Cheap execution makes risk-based repricing affordable: the premium accrues every block, and the keeper reprices every block it can for its first 600 blocks (about 3 minutes), then every 200 blocks to save gas. It sends one transaction at a time and waits for the receipt: on a mainnet fork its reprices landed in consecutive blocks; on mainnet, from our keeper in India (0.5 to 0.75 s per round trip to the RPC), they landed every 3 to 4 blocks, about 1 s apart. Its EIP-2930 access list cut a steady reprice from 523k to 192k gas and an exit from 1.2M to 682k on a mainnet fork, mostly by warming Aave's and the tokens' storage; Shield's own records are packed one per MIP-8 storage page.
- Gas is billed on the limit on Monad, so every keeper transaction carries a measured limit.
- The public Analytics page streams Monad's commit states (Proposed, Voted, Finalized, Verified) with Shield's reprices landing in them.

What is built
- Five contracts (PositionRegistry, Repricer, Executor, ShieldVault, ShieldForwarderFactory) on Aave V3 Monad and Pyth, with a Uniswap V3 adapter to sell seized collateral.
- A TypeScript keeper (viem) that reprices covers, runs exits and sweeps cross-chain deposits.
- An Envio HyperIndex indexer: positions, every reprice and exit, vault flows, and platform earnings by hour, day and since launch.
- A Next.js app in a cartoon, game-like design: your loan is a level where ETH stands above Aave's lava and Shield's line sits in between, and a mascot's face shows the status. Protect a position in plain words ("ETH can fall 6.5% before Aave liquidates you"), pick Early, Balanced or Last call with its price and cost, and turn Shield on with one button; top up from any chain; see the protocol's vault and a Stats scoreboard with a live Monad block ticker. The health factor and details sit in a "Stats for nerds" drawer.

How it is checked
143 contract tests (100 unit, fuzz and invariant; 43 against real Aave on a Monad mainnet fork), 91 keeper, 8 indexer and 65 web tests, and a Playwright run of the whole demo flow on a mainnet fork. An internal review before mainnet found 1 critical, 15 high and 36 medium issues; all are fixed, with regression tests for the contracts and keeper. The contracts have not had an external audit. Contract addresses, transaction hashes and gas figures are in the README.
```

## Go-to-market and user acquisition

```text
First users
Aave V3 borrowers on Monad with WETH collateral and USDC debt, starting with larger positions and positions that sit close to liquidation. Aave V3 holds about $324M on Monad (DefiLlama, 5 Oct 2026). Every Aave position is public on chain, so at-risk borrowers can be found from Aave's events and their health factors read directly.

How we reach them
1. Go straight to at-risk positions. Shield shows any address read only: its liquidation price, its exit price, and what Aave's bonus would cost against a Shield exit. We will share those links with borrowers whose health factor is under 1.3, through Monad community channels and on X when markets move.
2. Lead with proof. The public Analytics page shows every exit, the penalty it avoided, and the platform's earnings block by block. The opening example is Aave Monad's one liquidation so far: the borrower paid $87.98 above the debt, and a Shield exit would have cost $16.71.
3. Integrate where borrowers already are. A "protect this position" link fits into Monad wallets, portfolio dashboards and lending front ends. The exit is permissionless, so integrators and other keepers can run it too.
4. Remove the funding friction. Many borrowers keep stablecoins on other chains. Through Aurora Intents they top up cover from Ethereum, Base, Arbitrum, Solana and the other chains Aurora supports, without bridging or holding MON, so cover is never left to lapse for want of USDC on Monad.
5. Fund the vault ourselves first. The protocol seeds the vault and keeps all income while exits prove out; outside liquidity providers (Monad ecosystem funds and DeFi treasuries first) are added to the allowlist later, with 90% of income going to them.
6. Expand across Monad. The same exit fits Monad's other lenders: Euler V2 ($258.6M on Monad), Morpho Blue ($192.7M), Curvance ($128.7M) and Neverland ($8.5M). Each needs its own exit path and fork tests; they are listed in the app as coming soon.

Business model
At launch the protocol keeps all income: 10% of premiums directly and the rest of the premiums plus the exit discounts through the vault it funds. Once outside liquidity providers join, they keep 90% and the protocol 10%, capped at 20% in the contract. The borrower's cost does not change with the split.

What we will report publicly
Debt protected, penalty avoided, premiums, the vault's return, cross-chain top-ups and keeper cost, all on the Analytics page from the Envio indexer.

Trust
Open source under MIT, with test reports, an internal audit and every owner power listed in the repository. Before growing past a small vault we will get an external audit.
```

## Other fields

| Field | Value |
| --- | --- |
| GitHub repository | https://github.com/pratikasr/shield (public, or shared with metropolis@hackathon.monad.xyz) |
| Project logo | docs/brand/shield-logo-512.png (1024 px: docs/brand/shield-logo-1024.png) |
| Live product | https://shieldexit.xyz, on Monad mainnet |
| Technical demo video | Up to 3 minutes of the working product on mainnet, after M6 (script in docs/SPEC.md) |
| Primary track | Track 01, Onchain Finance and Trading; bounties: Envio, and Aurora Intents only if the real cross-chain top-up in the demo succeeds |
