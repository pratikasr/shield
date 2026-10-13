# indexer

Envio HyperIndex project for Shield on Monad mainnet (chain 143), the Envio bounty deliverable (ADR-005). It indexes every Shield event and serves them over GraphQL to the web app's history views.

| Entity | From | Used for |
| --- | --- | --- |
| `Position` | `OptedIn`, `TriggerSet`, `MaxDiscountSet`, `OptedOut`, `CoverLapsed`, `CoverRestored`, `Repriced`, `ToppedUp`, `Withdrawn`, `Exited` | Borrower status (Protected, Unprotected, OptedOut, Exited), premium paid, last HF and sigma |
| `Reprice` | `Repriced` | The per-block premium history and the sparkline |
| `Exit` | `Exited` | Exit history with penalty avoided (`savedVsAave`) |
| `PrepaidFlow` | `ToppedUp`, `Withdrawn`, `PremiumSwept` | Prepaid balance history; a top-up swept from the borrower's deposit address has kind `CrossChainTopUp` |
| `VaultFlow`, `VaultStats`, `Depositor` | ERC-4626 `Deposit`, `Withdraw`, share `Transfer` between accounts, `PremiumReceived`, `ExitFunded`, `CollateralReceived`, `Unwound` | LP dashboard totals and tables |
| `PriceSample` | `PriceSampled` | The Pyth observations behind realised volatility |
| `ForwarderSweep`, `Forwarder` | `ShieldForwarderFactory` `PremiumSwept`, `VaultFunded`, `ForwarderDeployed` | USDC swept from deposit addresses (ADR-039) into a borrower's premium or into the vault for the treasury, and each deployed deposit address. A vault funding is counted in `VaultStats` and the earnings buckets once, by the vault's own `Deposit` |

## Environment

`config.yaml` has no defaults for `ENVIO_START_BLOCK`, `ENVIO_REGISTRY_ADDRESS`, `ENVIO_REPRICER_ADDRESS`, `ENVIO_EXECUTOR_ADDRESS`, `ENVIO_VAULT_ADDRESS` and `ENVIO_FORWARDERS_ADDRESS`. They must be set, in `indexer/.env` locally or in the hosted env, or `envio dev`, `envio start` and `envio codegen` stop with "Environment variables are not present". `scripts/stack.sh` writes `indexer/.env` for a fork rehearsal (keeping the previous one as `indexer/.env.bak`) and `scripts/deploy-indexer.sh` sets the hosted env from `contracts/deployments/143.json`. `pnpm lint`, `pnpm build` and `pnpm test` take placeholder values from `test.env` (codegen and unit tests only, never a running indexer).

## Run locally against a fork

```bash
bash scripts/fork.sh && bash scripts/deploy-mainnet.sh --fork      # fork, then deploy Shield on it
cp indexer/.env.example indexer/.env                                  # fill in from contracts/deployments/fork-143.json,
                                                                      # ENVIO_RPC_URL=http://127.0.0.1:8545, ENVIO_RPC_FOR=sync
pnpm --filter shield-indexer dev                                      # needs Docker; GraphQL at http://localhost:8080/v1/graphql
```

## Test

```bash
pnpm --filter shield-indexer test
```

## Hosted

`bash scripts/deploy-indexer.sh` after the mainnet deployment and a one-time `npx envio-cloud login`. The endpoint goes in the README Proof table and in `web/.env` as `NEXT_PUBLIC_ENVIO_GRAPHQL_URL`.
