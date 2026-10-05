#!/usr/bin/env bash
# The demo's on-chain steps. Every step is a real transaction signed by a key from the environment.
#
#   bash scripts/demo-position.sh seed      LP deposits VAULT_SEED USDC units into the ShieldVault (LP_PRIVATE_KEY)
#   bash scripts/demo-position.sh open      borrower supplies DEMO_WETH, borrows USDC to DEMO_HF_BPS, approves the
#                                           Executor on aWETH, opts in with DEMO_TRIGGER_BPS, prepays DEMO_PREPAY
#   bash scripts/demo-position.sh keeper    starts the keeper (KEEPER_PRIVATE_KEY) against the deployment
#   bash scripts/demo-position.sh nudge     borrower borrows more until HF is DEMO_NUDGE_HF_BPS, at or under the
#                                           trigger, so the keeper exits on the next block
#   bash scripts/demo-position.sh all       seed, open, then keeper
#
# Add --fork to run against the local fork from scripts/fork.sh (test keys from .fork/accounts.env).
# Mainnet env: MONAD_RPC_URL, MONAD_WS_URL, DEMO_PRIVATE_KEY, LP_PRIVATE_KEY, KEEPER_PRIVATE_KEY.
# Sizing (defaults in brackets): DEMO_WETH [0.05 WETH in wei], DEMO_HF_BPS [10700], DEMO_TRIGGER_BPS [10500],
# DEMO_NUDGE_HF_BPS [10450], DEMO_PREPAY [5000000 = 5 USDC], VAULT_SEED [100000000 = 100 USDC].
# WETH's LTV is below its liquidation threshold, so borrowing alone stops at HF 1.0435; the default trigger of
# 1.05 can therefore be reached either by the market or by the nudge.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CMD="${1:-}"
MODE="${2:-}"
[ "$CMD" = "--fork" ] && { CMD="${2:-}"; MODE="--fork"; }

if [ "$MODE" = "--fork" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/.fork/accounts.env"
  RPC="$FORK_RPC_URL"; WS="$FORK_WS_URL"; DEPLOYMENT="$ROOT/contracts/deployments/fork-143.json"
else
  : "${MONAD_RPC_URL:?set MONAD_RPC_URL}"
  RPC="$MONAD_RPC_URL"; WS="${MONAD_WS_URL:-}"; DEPLOYMENT="$ROOT/contracts/deployments/143.json"
fi
[ -f "$DEPLOYMENT" ] || { echo "no deployment at $DEPLOYMENT; run scripts/deploy-mainnet.sh first" >&2; exit 1; }

export DEPLOYMENT_FILE="$DEPLOYMENT"
export DEMO_WETH="${DEMO_WETH:-50000000000000000}"
export DEMO_HF_BPS="${DEMO_HF_BPS:-10700}"
export DEMO_TRIGGER_BPS="${DEMO_TRIGGER_BPS:-10500}"
export DEMO_PREPAY="${DEMO_PREPAY:-5000000}"
export VAULT_SEED="${VAULT_SEED:-100000000}"

forge_run() { # key target [forge args...]
  local key="$1" target="$2"
  shift 2
  (cd "$ROOT/contracts" && forge script "$target" "$@" --rpc-url "$RPC" --private-key "$key" --broadcast --slow)
}

seed() {
  : "${LP_PRIVATE_KEY:?set LP_PRIVATE_KEY}"
  forge_run "$LP_PRIVATE_KEY" script/SeedVault.s.sol:SeedVault
}

open() {
  : "${DEMO_PRIVATE_KEY:?set DEMO_PRIVATE_KEY}"
  forge_run "$DEMO_PRIVATE_KEY" script/DemoPosition.s.sol:DemoPosition --sig "open()"
}

nudge() {
  : "${DEMO_PRIVATE_KEY:?set DEMO_PRIVATE_KEY}"
  DEMO_HF_BPS="${DEMO_NUDGE_HF_BPS:-10450}" forge_run "$DEMO_PRIVATE_KEY" script/DemoPosition.s.sol:DemoPosition --sig "borrowTo()"
}

keeper() {
  : "${KEEPER_PRIVATE_KEY:?set KEEPER_PRIVATE_KEY}"
  cd "$ROOT"
  MONAD_RPC_URL="$RPC" MONAD_WS_URL="$WS" CHAIN_ID=143 KEEPER_PRIVATE_KEY="$KEEPER_PRIVATE_KEY" \
    SHIELD_DEPLOYMENT_FILE="$DEPLOYMENT" pnpm --filter keeper start
}

case "$CMD" in
  seed) seed ;;
  open) open ;;
  nudge) nudge ;;
  keeper) keeper ;;
  all) seed; open; keeper ;;
  *) sed -n '2,21p' "$0"; exit 1 ;;
esac
