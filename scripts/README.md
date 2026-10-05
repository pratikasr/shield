# scripts

Deployment, demo position setup, the repricing capture used in the video, and the local fork used for tests. Each script starts with a header comment that says what it does, its commands and its environment; the scripts that take a command print that header when given an unknown one.

| Script | What it does |
| --- | --- |
| `deploy-mainnet.sh` | Deploys the contracts to Monad mainnet and writes `contracts/deployments/143.json` only after every contract has code on chain; refuses when that file exists (`--force` keeps a timestamped backup), `--resume` finishes a broadcast that stopped part way, `--fork` deploys to the local fork with a 20-second waiting period. |
| `verify-mainnet.sh` | Verifies the contracts in `143.json` on MonadVision (Sourcify) and, with `ETHERSCAN_API_KEY`, on Monadscan; sends nothing, so it can be retried for any contract. |
| `deploy-indexer.sh` | Creates or updates the Envio hosted indexer for the mainnet deployment and prints its endpoint. |
| `web-env.sh` | Writes `web/.env.local` for the mainnet deployment (or `--fork`), keeping a file it did not write as `web/.env.local.bak`. |
| `demo-position.sh` | The demo's on-chain steps: `seed`, `position`, `open`, `keeper`, `nudge` (with a preflight, `--force-nudge` to override) and `all`; `--fork` for the local fork. |
| `proof.sh` | Prints the README Deployments and Proof rows after checking every address and receipt on chain, using only keeper log lines sent to this deployment. |
| `fork.sh` | Starts (or `stop`s) a local Anvil fork of Monad mainnet with funded test accounts; refuses a port already in use. Tests and rehearsals only. |
| `stack.sh` | `up` runs the whole stack on the fork (deployment, LP deposit, position, Envio, keeper, web); `down` stops exactly the processes `up` started. Tests only. |
| `e2e.sh` | Brings the stack up and runs the Playwright video-script test against it; stops the stack afterwards. Tests only. |
| `export-abi.sh` | Copies the Foundry ABIs into the keeper, web and indexer packages after a contract change. |
| `require-foundry.sh` | Sourced: stops with the fix when forge is missing or older than 1.8. |
| `mainnet-lib.sh` | Sourced: refuses local or non-143 RPC URLs on mainnet paths, and picks each signer (Foundry keystore account, else a key from the environment). |
| `procs.sh` | Sourced: PID files and a process-tree stop for `fork.sh` and `stack.sh`. |

Mainnet commands never need a key on the command line: signers are Foundry keystores (`DEPLOYER_ACCOUNT`, `DEMO_ACCOUNT`, `LP_ACCOUNT`) and the keeper reads a chmod 600 key file (`KEEPER_PRIVATE_KEY_FILE`). The runbook is Part 2 of [docs/DEMO.md](../docs/DEMO.md).
