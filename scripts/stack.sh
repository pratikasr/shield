#!/usr/bin/env bash
# The whole Shield stack on a local fork of Monad mainnet, for tests, screenshots and rehearsals only (ADR-020).
# Nothing that runs here is demo or proof material.
#
#   bash scripts/stack.sh up      fork, deployment, LP deposit, a borrower position (no cover), Envio, keeper, web
#   bash scripts/stack.sh down    stop everything this script started
#
# Env: FORK_BLOCK (default latest), STACK_WEB_PORT (3200), STACK_HASURA_PORT (8088), STACK_WEB_MODE (start|dev),
#      STACK_KEEPER (1 to run the keeper, default 1). Logs go to .fork/stack-*.log; accounts to .fork/accounts.env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DIR="$ROOT/.fork"
WEB_PORT="${STACK_WEB_PORT:-3200}"
HASURA_PORT="${STACK_HASURA_PORT:-8088}"
mkdir -p "$DIR"

stop_ours() {
  # Servers outlive their wrapping subshells, so stop them by command line (only this repo's processes).
  pkill -f "next start -p $WEB_PORT" 2>/dev/null || true
  pkill -f "next dev --port $WEB_PORT" 2>/dev/null || true
  # The keeper runs as node with tsx loader flags, not as "tsx ...", so match the part both command lines share.
  pkill -f -- "--env-file-if-exists=.env src/index.ts" 2>/dev/null || true
  pkill -f "$ROOT/indexer/node_modules/.bin/../envio/bin.mjs" 2>/dev/null || true
}

wait_for() { # url, label, tries
  for _ in $(seq 1 "${3:-120}"); do
    if curl -s -o /dev/null -w "%{http_code}" "$1" | grep -q -E "200|405"; then echo "$2 ready"; return 0; fi
    sleep 1
  done
  echo "$2 did not come up at $1" >&2
  return 1
}

down() {
  stop_ours
  (cd "$ROOT/indexer" && pnpm exec envio stop >/dev/null 2>&1) || true
  bash "$ROOT/scripts/fork.sh" stop >/dev/null 2>&1 || true
  echo "stack stopped"
}

up() {
  down >/dev/null
  echo "== fork"
  bash scripts/fork.sh
  # shellcheck disable=SC1091
  source "$DIR/accounts.env"

  echo "== deploy"
  bash scripts/deploy-mainnet.sh --fork > "$DIR/stack-deploy.log" 2>&1
  DEPLOYMENT="$ROOT/contracts/deployments/fork-143.json"
  j() { node -e "console.log(require('$DEPLOYMENT')['$1'])"; }

  echo "== LP deposit and borrower position"
  VAULT_SEED=50000000 bash scripts/demo-position.sh seed --fork > "$DIR/stack-seed.log" 2>&1
  (cd contracts && DEPLOYMENT_FILE="$DEPLOYMENT" DEMO_WETH="${STACK_WETH:-50000000000000000}" DEMO_HF_BPS="${STACK_HF_BPS:-10700}" \
    forge script script/DemoPosition.s.sol:DemoPosition --sig "openPosition()" --rpc-url "$FORK_RPC_URL" \
    --private-key "$DEMO_PRIVATE_KEY" --broadcast --slow) > "$DIR/stack-position.log" 2>&1
  grep -E "health factor" "$DIR/stack-position.log" || true

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
  (cd indexer && set -a && . ./.env && set +a && pnpm exec envio local docker up > "$DIR/stack-envio.log" 2>&1)
  wait_for "http://localhost:$HASURA_PORT/healthz" "hasura" 180
  (cd indexer && set -a && . ./.env && set +a && export ENVIO_PG_PORT=5433 ENVIO_PG_PASSWORD=testing ENVIO_PG_USER=postgres \
    ENVIO_PG_DATABASE=envio-dev ENVIO_TUI=false && pnpm exec envio local db-migrate setup >> "$DIR/stack-envio.log" 2>&1 \
    && nohup pnpm exec envio start < /dev/null >> "$DIR/stack-envio.log" 2>&1 &)

  if [ "${STACK_KEEPER:-1}" = "1" ]; then
    echo "== keeper"
    (MONAD_RPC_URL="$FORK_RPC_URL" MONAD_WS_URL="$FORK_WS_URL" CHAIN_ID=143 KEEPER_PRIVATE_KEY="$KEEPER_PRIVATE_KEY" \
      SHIELD_DEPLOYMENT_FILE="$DEPLOYMENT" nohup pnpm --filter keeper start > "$DIR/stack-keeper.log" 2>&1 &)
  fi

  echo "== web"
  NEXT_PUBLIC_ENVIO_GRAPHQL_URL="http://localhost:$HASURA_PORT/v1/graphql" bash scripts/web-env.sh --fork
  if [ "${STACK_WEB_MODE:-start}" = "dev" ]; then
    (cd web && nohup pnpm exec next dev --port "$WEB_PORT" > "$DIR/stack-web.log" 2>&1 &)
  else
    (cd web && pnpm build > "$DIR/stack-web-build.log" 2>&1)
    (cd web && nohup pnpm exec next start -p "$WEB_PORT" > "$DIR/stack-web.log" 2>&1 &)
  fi
  wait_for "http://localhost:$WEB_PORT/" "web" 180
  (cd contracts && forge build > "$DIR/stack-forge-build.log" 2>&1)  # artifacts for fork-only test helpers
  cat <<MSG
stack up
  web      http://localhost:$WEB_PORT  (connect "Fork test wallet": the borrower ${DEMO_ADDRESS})
  graphql  http://localhost:$HASURA_PORT/v1/graphql
  rpc      $FORK_RPC_URL
  stop     bash scripts/stack.sh down
MSG
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
