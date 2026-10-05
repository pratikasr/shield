# indexer

Envio HyperIndex project for Shield on Monad mainnet (chain 143), the Envio bounty deliverable (ADR-005). It indexes every Shield event and serves them over GraphQL to the web app's history views.

| Entity | From | Used for |
| --- | --- | --- |
| `Position` | `OptedIn`, `TriggerSet`, `MaxDiscountSet`, `OptedOut`, `CoverLapsed`, `CoverRestored`, `Repriced`, `ToppedUp`, `Withdrawn`, `Exited` | Borrower status (Protected, Unprotected, OptedOut, Exited), premium paid, last HF and sigma |
| `Reprice` | `Repriced` | The per-block premium history and the sparkline |
| `Exit` | `Exited` | Exit history with penalty avoided (`savedVsAave`) |
| `PrepaidFlow` | `ToppedUp`, `Withdrawn` | Prepaid balance history |
| `VaultFlow`, `VaultStats`, `Depositor` | ERC-4626 `Deposit`, `Withdraw`, `PremiumReceived`, `ExitFunded`, `CollateralReceived`, `Unwound` | LP dashboard totals and tables |
| `PriceSample` | `PriceSampled` | The Pyth observations behind realised volatility |

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
