# Progress log

Newest entry first. One entry per session: what moved, commit hashes, what is next, what is blocked and why.

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
