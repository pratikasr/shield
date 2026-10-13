# keeper

TypeScript keeper on viem (ADR-003). One process that, for every proposed Monad block:

1. Receives the block from `monadNewHeads` (commitState `Proposed`); falls back to `newHeads`, then to HTTP polling of `latest`, and reconnects with backoff. The WebSocket's chain id is checked before subscribing. A watchdog polls over HTTP and reconnects when the subscription delivers nothing for 2 s, and counts the drops.
2. Reads the active borrowers, then every one's exit status, record and the keeper's own balance in one multicall on proposed state (`Executor.previewExit`, `PositionRegistry.record`, Multicall3 `getEthBalance`).
3. Submits `Executor.exit` for every borrower whose status is `Ready`. Each exit is isolated: one borrower's failed read or send does not stop the next exit or the reprice. `CoverWarmingUp` (the waiting period after an opt-in, restore or raised trigger) is not ready.
4. Reprices with `Repricer.repriceMany` on the configured cadence (ADR-025): every block for `REPRICE_WINDOW_BLOCKS` (600, about 3 minutes) from its start, then every `REPRICE_IDLE_EVERY_N_BLOCKS` (200) counted from the last reprice. Only records that are active, not lapsed, with prepaid premium left and a clean preview are repriced, riskiest first, in chunks that fit under `MAX_GAS_REPRICE`. A chunk whose estimate reverts is split until the borrower that reverts is found; that borrower is left out for 100 blocks.
5. Stops repricing while its balance is under `MIN_BALANCE_FOR_EXIT_WEI` (0.2 MON), so the balance is kept for exits, and logs `keeper.low_balance` at error level once a minute.
6. Gives each transaction a measured gas limit (estimate plus `GAS_BUFFER_BPS`, plus headroom for repricing), an EIP-2930 access list reduced to one key per MIP-8 page (ADR-027), and sends it with `eth_sendRawTransactionSync`, falling back to `eth_sendRawTransaction` when the RPC lacks it. A `repriceMany` limit is measured when the batch changes and again every 20 blocks or after a failure; in between the last measured limit for the same batch is reused.
7. Sweeps deposit addresses (ADR-039) every `SWEEP_EVERY_N_BLOCKS` (20, about 6 s): one multicall reads the USDC at `ShieldForwarderFactory.forwarderFor(borrower)` for every active borrower and at `treasuryForwarder()` (each deposit address is read once and cached). A balance of at least `SWEEP_MIN_UNITS` (1, in USDC base units) is moved into Shield with `sweepPremium(borrower)` (the borrower's prepaid premium, through `Repricer.topUpFor`) or `sweepVault()` (vault shares for the treasury), riskiest borrowers first and the vault last. Exits keep priority: no sweep runs in a pass with an exit to make, none while the balance is under `MIN_BALANCE_FOR_EXIT_WEI`, and after each sweep the pass ends when a newer head is waiting, so the remaining sweeps go out from the next pass. A sweep that fails is left out for 100 blocks; the others still go out. Without a factory address (an older deployment file) the keeper runs without sweeps. Logs: `sweep.due` (what waits, where), `tx.included`, `sweep.done`, `sweep.failed`, `sweep.skipped`, `sweep.deferred`.
8. Logs one JSON line per block (number, each borrower's HF, trigger and status, the decision) and one per transaction (`tx.included`: label, `to`, hash, block, gas used and limit, latency). A borrower at or under its trigger whose exit is not `Ready` gets a `position.at_trigger_not_ready` warning naming the status. With a Hermes key, a `PythStale` or `OracleDeviation` exit is tried with a fresh Pyth update (and Pyth's fee as the value) when its estimate passes.

The keeper is a convenience, not a trust assumption: `exit` is permissionless and the contracts check every condition.

## Safety

- Out of gas: Monad receipts report gas used equal to the limit for every transaction, so a reverted receipt only raises the gas buffer when an `eth_call` replay at the same limit also runs out of gas. The ceiling (`MAX_GAS_EXIT`, `MAX_GAS_REPRICE`) is checked without that extra buffer, which is capped at the ceiling.
- Unclear sends: after a sync timeout the keeper polls for the receipt for 4 s, then moves on. After any send failure that is not a clear rejection (connection reset, proxy 504, timeout) it looks the transaction hash up. Until that transaction is mined or confirmed gone, no other transaction is signed, so its nonce is never reused. "already known" counts as in flight; "replacement transaction underpriced", "insufficient funds" and nonce errors resync the nonce.
- Reads go to `MONAD_RPC_URL` first and then to `RPC_FALLBACK_URLS` with 1 s timeouts (on chain 143 the public Monad RPCs by default; never for a local fork). Transactions go to `MONAD_RPC_URL` only.
- Logs carry viem's short message and details only, and every configured RPC URL (with its path and query) is redacted, since a URL can hold an API key.
- Startup refuses an empty `.env` value as zero (empty means default), an address variable that disagrees with `SHIELD_DEPLOYMENT_FILE`, an address without code, an Executor, Repricer or forwarder factory wired to another registry or Repricer, and a second keeper on the same chain and account (lock file `keeper/.keeper-<chain>-<address>.lock`, with the pid).
- Ctrl-C stops taking heads, waits up to 10 s for a send in progress, then releases the lock.

## Round trips per pass

Sequential RPC round trips in a steady-state pass that only reprices (one batch, Hermes off), counted on 5 Oct 2026:

| | Before | After |
| --- | --- | --- |
| Borrower list | `activeCount`, `activeBorrowers` | `activeBorrowers` (one 500-borrower page) |
| Status and records | multicall | multicall, with the keeper's balance |
| Collateral per borrower | `record` again | from the multicall |
| Access list | `eth_createAccessList` | cached per batch for 200 blocks |
| Gas limit | `eth_estimateGas` | measured when the batch changes, then every 20 blocks |
| Fee data | `eth_getBlockByNumber`, `eth_maxPriorityFeePerGas` | cached for 1.5 s |
| Send | `eth_sendRawTransactionSync` | `eth_sendRawTransactionSync` |
| Total | 9 | 3 |

An exit pass still builds its access list and measures its gas fresh: 5 round trips (plus Hermes and `getUpdateFee` with a Hermes key).

## Run

```bash
cp keeper/.env.example keeper/.env   # fill in the RPC URLs, CHAIN_ID, KEEPER_PRIVATE_KEY_FILE, SHIELD_DEPLOYMENT_FILE
pnpm --filter keeper start           # or: pnpm --filter keeper dev (restarts on file changes)
pnpm --filter keeper measure         # gas of repriceMany and due exits with and without the access list
```

Keep the key out of the environment and shell history: put the 0x-prefixed key alone in a file outside the repo (for example `~/.shield/keeper.key`, written with an editor), run `chmod 600` on it and set `KEEPER_PRIVATE_KEY_FILE` to its path. The keeper refuses a key file that other users can read.

## Test

```bash
pnpm --filter keeper test            # unit tests: heads, submitter, access lists, decisions, keeper loop and sweeps, config, logs, startup
LIVE_SMOKE=1 MONAD_SMOKE_WS_URL=wss://testnet-rpc.monad.xyz pnpm --filter keeper test   # live monadNewHeads check
```

Add `MONAD_SMOKE_PRIVATE_KEY` (a funded testnet key) to the live run to also check `eth_sendRawTransactionSync` returns a receipt.
