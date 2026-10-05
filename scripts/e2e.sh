#!/usr/bin/env bash
# Round 2 end-to-end test: the video script from docs/SPEC.md, walked by Playwright through the real web app on a
# fresh local fork of Monad mainnet (tests only, ADR-020; nothing here is demo or proof material).
#
#   bash scripts/e2e.sh                 fresh fork at the latest block, then the full run
#   FORK_BLOCK=110600000 bash scripts/e2e.sh
#
# Starts: Anvil fork (scripts/fork.sh), Shield deployment, an LP deposit, a borrower position (no cover yet),
# the Envio indexer (Docker, Hasura on E2E_HASURA_PORT), the keeper, and a production build of the web app on
# E2E_WEB_PORT. Then runs web/e2e/*.spec.ts. Results: .fork/e2e-result.json; logs in .fork/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DIR="$ROOT/.fork"
WEB_PORT="${E2E_WEB_PORT:-3200}"
HASURA_PORT="${E2E_HASURA_PORT:-8088}"
mkdir -p "$DIR"
PIDS=()

stop_ours() {
  # The servers outlive their wrapping subshells, so stop them by command line (only this script's processes).
  pkill -f "next start -p $WEB_PORT" 2>/dev/null || true
  pkill -f "tsx --env-file-if-exists=.env src/index.ts" 2>/dev/null || true
  pkill -f "$ROOT/indexer/node_modules/.bin/../envio/bin.mjs" 2>/dev/null || true
}

cleanup() {
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  stop_ours
  if [ "${E2E_KEEP:-0}" != "1" ]; then
    (cd "$ROOT/indexer" && pnpm exec envio stop >/dev/null 2>&1) || true
    bash "$ROOT/scripts/fork.sh" stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for() { # url, label, tries
  for _ in $(seq 1 "${3:-120}"); do
    if curl -s -o /dev/null -w "%{http_code}" "$1" | grep -q -E "200|405"; then echo "$2 ready"; return 0; fi
    sleep 1
  done
  echo "$2 did not come up at $1" >&2
  return 1
}

stop_ours
echo "== fork"
bash scripts/fork.sh stop >/dev/null 2>&1 || true
bash scripts/fork.sh
# shellcheck disable=SC1091
source "$DIR/accounts.env"

echo "== deploy"
bash scripts/deploy-mainnet.sh --fork > "$DIR/e2e-deploy.log" 2>&1
DEPLOYMENT="$ROOT/contracts/deployments/fork-143.json"
j() { node -e "console.log(require('$DEPLOYMENT')['$1'])"; }

echo "== LP deposit and borrower position"
VAULT_SEED=50000000 bash scripts/demo-position.sh seed --fork > "$DIR/e2e-seed.log" 2>&1
(cd contracts && DEPLOYMENT_FILE="$DEPLOYMENT" DEMO_WETH=50000000000000000 DEMO_HF_BPS=10700 \
  forge script script/DemoPosition.s.sol:DemoPosition --sig "openPosition()" --rpc-url "$FORK_RPC_URL" \
  --private-key "$DEMO_PRIVATE_KEY" --broadcast --slow) > "$DIR/e2e-position.log" 2>&1
grep -E "health factor" "$DIR/e2e-position.log" || true

echo "== indexer"
cat > "$ROOT/indexer/.env" <<ENV
ENVIO_API_TOKEN=not-set
ENVIO_START_BLOCK=$(j block)
ENVIO_REGISTRY_ADDRESS=$(j PositionRegistry)
ENVIO_REPRICER_ADDRESS=$(j Repricer)
ENVIO_EXECUTOR_ADDRESS=$(j Executor)
ENVIO_VAULT_ADDRESS=$(j ShieldVault)
ENVIO_RPC_URL=$FORK_RPC_URL
ENVIO_RPC_FOR=sync
ENVIO_TUI=false
HASURA_EXTERNAL_PORT=$HASURA_PORT
HASURA_GRAPHQL_ENDPOINT=http://localhost:$HASURA_PORT/v1/metadata
ENV
# `envio dev` stalls without a terminal, so bring up Postgres and Hasura, reset the schema, then `envio start`.
(cd indexer && pnpm exec envio stop >/dev/null 2>&1 || true)
(cd indexer && set -a && . ./.env && set +a && pnpm exec envio local docker up > "$DIR/e2e-envio.log" 2>&1)
wait_for "http://localhost:$HASURA_PORT/healthz" "hasura" 180
(cd indexer && set -a && . ./.env && set +a && export ENVIO_PG_PORT=5433 ENVIO_PG_PASSWORD=testing ENVIO_PG_USER=postgres \
  ENVIO_PG_DATABASE=envio-dev ENVIO_TUI=false && pnpm exec envio local db-migrate setup >> "$DIR/e2e-envio.log" 2>&1 \
  && pnpm exec envio start < /dev/null >> "$DIR/e2e-envio.log" 2>&1) &
PIDS+=($!)

echo "== keeper"
(MONAD_RPC_URL="$FORK_RPC_URL" MONAD_WS_URL="$FORK_WS_URL" CHAIN_ID=143 KEEPER_PRIVATE_KEY="$KEEPER_PRIVATE_KEY" \
  SHIELD_DEPLOYMENT_FILE="$DEPLOYMENT" pnpm --filter keeper start > "$DIR/e2e-keeper.log" 2>&1) &
PIDS+=($!)

echo "== web"
NEXT_PUBLIC_ENVIO_GRAPHQL_URL="http://localhost:$HASURA_PORT/v1/graphql" bash scripts/web-env.sh --fork
(cd web && pnpm build > "$DIR/e2e-web-build.log" 2>&1)
(cd web && pnpm exec next start -p "$WEB_PORT" > "$DIR/e2e-web.log" 2>&1) &
PIDS+=($!)
wait_for "http://localhost:$WEB_PORT/" "web" 120

echo "== playwright"
(cd contracts && forge build > "$DIR/e2e-forge-build.log" 2>&1)   # the spec deploys the fork-only price feed artifact
E2E_BASE_URL="http://localhost:$WEB_PORT" E2E_RPC_URL="$FORK_RPC_URL" E2E_DEPLOYMENT="$DEPLOYMENT" \
  E2E_BORROWER="$DEMO_ADDRESS" E2E_ADMIN_KEY="$DEPLOYER_PRIVATE_KEY" E2E_RESULT="$DIR/e2e-result.json" \
  pnpm --filter web exec playwright test
echo "== result"
cat "$DIR/e2e-result.json"
