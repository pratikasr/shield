# keeper

TypeScript keeper on viem (ADR-003). One process that, for every proposed Monad block:

1. Receives the block from `monadNewHeads` (commitState `Proposed`); falls back to `newHeads`, then to HTTP polling of `latest`, and reconnects with backoff.
2. Reads every active cover's exit status and Aave health factor on proposed state in one multicall (`Executor.previewExit`, `PositionRegistry.record`).
3. Submits `Executor.exit` for every borrower whose status is `Ready`, then `Repricer.repriceMany` for the rest on the configured cadence (ADR-025).
4. Gives each transaction a measured gas limit (estimate plus `GAS_BUFFER_BPS`, plus headroom for repricing), an EIP-2930 access list reduced to one key per MIP-8 page (ADR-027), and sends it with `eth_sendRawTransactionSync`, falling back to `eth_sendRawTransaction` when the RPC lacks it.
5. Logs one JSON line per block (number, each borrower's HF, trigger and status, the decision) and one per transaction (hash, block, gas used and limit, latency).

The keeper is a convenience, not a trust assumption: `exit` is permissionless and the contracts check every condition.

## Run

```bash
cp keeper/.env.example keeper/.env   # fill in the RPC URLs, CHAIN_ID, KEEPER_PRIVATE_KEY, SHIELD_DEPLOYMENT_FILE
pnpm --filter keeper start           # or: pnpm --filter keeper dev (restarts on file changes)
pnpm --filter keeper measure         # gas of repriceMany and due exits with and without the access list
```

## Test

```bash
pnpm --filter keeper test            # unit tests: heads, submitter, access lists, decisions, keeper loop, config
LIVE_SMOKE=1 MONAD_SMOKE_WS_URL=wss://testnet-rpc.monad.xyz pnpm --filter keeper test   # live monadNewHeads check
```

Add `MONAD_SMOKE_PRIVATE_KEY` (a funded testnet key) to the live run to also check `eth_sendRawTransactionSync` returns a receipt.
