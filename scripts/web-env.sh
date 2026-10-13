#!/usr/bin/env bash
# Writes web/.env.local from a deployment file so the web app talks to that deployment.
#
#   bash scripts/web-env.sh                    Monad mainnet: contracts/deployments/143.json, public RPC
#   bash scripts/web-env.sh --fork             local fork rehearsal: fork-143.json, the fork's RPC, the local Envio
#                                              endpoint and the fork test wallet (account 2 in .fork/accounts.env)
#   bash scripts/web-env.sh --testnet          Monad testnet staging (ADR-040): 10143.json, the Aave V3 market in
#                                              aave-10143.json, the public testnet RPC and explorer
# Env: NEXT_PUBLIC_ENVIO_GRAPHQL_URL (hosted indexer endpoint, mainnet), NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
# An existing web/.env.local is copied to web/.env.local.bak first, unless a fork run wrote it (its first line says
# so), so a hand-written or mainnet file is never lost to a rehearsal.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORK_HEADER="# fork rehearsal: written by scripts/"
if [ "${1:-}" = "--fork" ]; then
  FILE="$ROOT/contracts/deployments/fork-143.json"
  # shellcheck disable=SC1091
  source "$ROOT/.fork/accounts.env"
  RPC="$FORK_RPC_URL"; ENVIO="${NEXT_PUBLIC_ENVIO_GRAPHQL_URL-http://localhost:8088/v1/graphql}"; E2E="$DEMO_ADDRESS"  # set but empty: no indexer
  HEADER="${FORK_HEADER}web-env.sh --fork; a previous file not written by a fork run, if any, is in web/.env.local.bak"
elif [ "${1:-}" = "--testnet" ]; then
  FILE="$ROOT/contracts/deployments/10143.json"
  RPC=""; ENVIO="${NEXT_PUBLIC_ENVIO_GRAPHQL_URL:-}"; E2E=""
  HEADER="# Monad testnet staging: written by scripts/web-env.sh --testnet from contracts/deployments/10143.json"
else
  FILE="$ROOT/contracts/deployments/143.json"
  RPC=""; ENVIO="${NEXT_PUBLIC_ENVIO_GRAPHQL_URL:-}"; E2E=""
  HEADER="# Monad mainnet: written by scripts/web-env.sh from contracts/deployments/143.json"
fi
[ -f "$FILE" ] || { echo "no deployment at $FILE" >&2; exit 1; }
j() { node -e "console.log(require('$FILE')['$1'])"; }
OUT="$ROOT/web/.env.local"
if [ -f "$OUT" ]; then
  case "$(sed -n 1p "$OUT")" in
    "$FORK_HEADER"*) ;;
    *) cp -p "$OUT" "$OUT.bak" && echo "kept the previous web/.env.local as web/.env.local.bak" ;;
  esac
fi
cat > "$OUT" <<ENV
$HEADER
NEXT_PUBLIC_SHIELD_REGISTRY=$(j PositionRegistry)
NEXT_PUBLIC_SHIELD_REPRICER=$(j Repricer)
NEXT_PUBLIC_SHIELD_EXECUTOR=$(j Executor)
NEXT_PUBLIC_SHIELD_VAULT=$(j ShieldVault)
NEXT_PUBLIC_SHIELD_FORWARDERS=$(j ShieldForwarderFactory)
NEXT_PUBLIC_AURORA_APP_KEY=${NEXT_PUBLIC_AURORA_APP_KEY:-}
NEXT_PUBLIC_MONAD_RPC_URL=$RPC
NEXT_PUBLIC_ENVIO_GRAPHQL_URL=$ENVIO
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}
NEXT_PUBLIC_E2E_ACCOUNT=$E2E
ENV
if [ "${1:-}" = "--testnet" ]; then
  AAVE="$ROOT/contracts/deployments/aave-10143.json"
  [ -f "$AAVE" ] || { echo "no Aave testnet market at $AAVE" >&2; exit 1; }
  a() { node -e "console.log(require('$AAVE')['$1'])"; }
  cat >> "$OUT" <<ENV
NEXT_PUBLIC_CHAIN_ID=10143
NEXT_PUBLIC_AAVE_POOL=$(a Pool)
NEXT_PUBLIC_AAVE_ORACLE=$(a AaveOracle)
NEXT_PUBLIC_AAVE_DATA_PROVIDER=$(a ProtocolDataProvider)
NEXT_PUBLIC_AAVE_USDC=$(a USDC)
NEXT_PUBLIC_AAVE_WETH=$(a WETH)
ENV
fi
echo "wrote web/.env.local for $FILE"
