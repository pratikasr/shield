#!/usr/bin/env bash
# Starts a local Anvil fork of Monad mainnet for tests and rehearsals only (ADR-020). Nothing that runs here
# appears in the demo or the README proof tables.
#
#   bash scripts/fork.sh            start the fork in the background, fund the test accounts, print them
#   bash scripts/fork.sh stop       stop it
#
# Writes .fork/anvil.json (Anvil's throwaway accounts and keys) and .fork/accounts.env. Accounts:
#   0 deployer and owner, 1 keeper, 2 borrower, 3 LP. The borrower and LP get WETH and USDC moved from
#   Aave's aWETH and aUSDC contracts (which hold the underlying) through Anvil impersonation.
# Env: MONAD_RPC_URL (default https://rpc.monad.xyz), FORK_BLOCK (default latest), FORK_PORT (default 8545),
#      FORK_BLOCK_TIME (default 0.3 seconds).
# Refuses to start when something already listens on FORK_PORT. `stop` kills only the Anvil whose PID this script
# recorded in .fork/anvil.pid (scripts/procs.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/.fork"
PORT="${FORK_PORT:-8545}"
RPC="http://127.0.0.1:$PORT"
mkdir -p "$DIR"
# shellcheck disable=SC1091
source "$ROOT/scripts/procs.sh"
unset ETH_PASSWORD  # a keystore password file makes cast reject the unlocked sends below

if [ "${1:-}" = "stop" ]; then
  stop_pidfile "$DIR/anvil.pid" anvil anvil
  echo "fork stopped"
  exit 0
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/require-foundry.sh"
port_busy() {
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
  cast chain-id --rpc-url "$RPC" >/dev/null 2>&1
}
if port_busy; then
  echo "port $PORT is already in use, so no fork was started. If it is this repo's fork, stop it with" >&2
  echo "bash scripts/fork.sh stop (or bash scripts/stack.sh down); otherwise set FORK_PORT to a free port." >&2
  exit 1
fi
UPSTREAM="${MONAD_RPC_URL:-https://rpc.monad.xyz}"
BLOCK="${FORK_BLOCK:-$(cast block-number --rpc-url "$UPSTREAM")}"
ARGS=(--fork-url "$UPSTREAM" --fork-block-number "$BLOCK" --block-time "${FORK_BLOCK_TIME:-0.3}" --port "$PORT"
  --no-rate-limit --retries 12 --timeout 30000 --config-out "$DIR/anvil.json")
if [ -z "${MONAD_RPC_URL:-}" ]; then
  ARGS+=(--fork-url https://rpc1.monad.xyz)
fi

anvil "${ARGS[@]}" > "$DIR/anvil.log" 2>&1 &
pid_record $! "$DIR/anvil.pid"
for _ in $(seq 1 120); do
  if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
cast chain-id --rpc-url "$RPC" >/dev/null

key() { node -e "console.log(require('$DIR/anvil.json').private_keys[$1])"; }
addr() { node -e "console.log(require('$DIR/anvil.json').available_accounts[$1])"; }

WETH=0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242
USDC=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
A_WETH=0x4377b53aAA8b8e3fF7AA2843832CAF004f5Cb8b6
A_USDC=0x35a73BAcb179d3740395A3ceCc87FF2e581d6042
fund() { # holder token to amount
  cast rpc anvil_impersonateAccount "$1" --rpc-url "$RPC" >/dev/null
  cast rpc anvil_setBalance "$1" 0x56BC75E2D63100000 --rpc-url "$RPC" >/dev/null
  cast send "$2" "transfer(address,uint256)" "$3" "$4" --from "$1" --unlocked --rpc-url "$RPC" >/dev/null
  cast rpc anvil_stopImpersonatingAccount "$1" --rpc-url "$RPC" >/dev/null
}
BORROWER=$(addr 2)
LP=$(addr 3)
fund "$A_WETH" "$WETH" "$BORROWER" 10000000000000000000   # 10 WETH
fund "$A_USDC" "$USDC" "$BORROWER" 1000000000             # 1,000 USDC for prepaid premium
fund "$A_USDC" "$USDC" "$LP" 100000000000                 # 100,000 USDC for the vault

cat > "$DIR/accounts.env" <<ENV
FORK_RPC_URL=$RPC
FORK_WS_URL=ws://127.0.0.1:$PORT
FORK_BLOCK=$BLOCK
DEPLOYER_ADDRESS=$(addr 0)
DEPLOYER_PRIVATE_KEY=$(key 0)
KEEPER_ADDRESS=$(addr 1)
KEEPER_PRIVATE_KEY=$(key 1)
DEMO_ADDRESS=$BORROWER
DEMO_PRIVATE_KEY=$(key 2)
LP_ADDRESS=$LP
LP_PRIVATE_KEY=$(key 3)
ENV
echo "fork of Monad mainnet block $BLOCK running at $RPC (pid $(sed -n 1p "$DIR/anvil.pid"))"
echo "accounts in .fork/accounts.env (throwaway Anvil keys; never use them on a real network)"
