#!/usr/bin/env bash
# The whole Shield stack on a local fork of Monad mainnet, for tests, screenshots and rehearsals only (ADR-020).
# Nothing that runs here is demo or proof material.
#
#   bash scripts/stack.sh up      fork, deployment, LP deposit, a borrower position (no cover), Envio, keeper, web
#   bash scripts/stack.sh down    stop everything this script started, and nothing else
#
# Env: FORK_BLOCK (default latest), STACK_WEB_PORT (3200), STACK_HASURA_PORT (8088), STACK_WEB_MODE (start|dev),
#      STACK_KEEPER (1 to run the keeper, default 1), STACK_MIN_COVER_SECONDS (the fork deployment's waiting period,
#      default 20), REPRICE_WINDOW_BLOCKS (default 0: the keeper reprices every block for as long as it runs).
# Logs go to .fork/stack-*.log; accounts to .fork/accounts.env. Each process started here has a PID file in .fork/
# (anvil.pid, stack-envio.pid, stack-keeper.pid, stack-web.pid); `down` stops exactly those PIDs and their
# descendants (scripts/procs.sh), runs `envio stop` only when `up` started Envio's containers, and stops the fork
# only when `up` started it. An existing indexer/.env or web/.env.local that this script did not write is copied
# to indexer/.env.bak or web/.env.local.bak before it is replaced.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DIR="$ROOT/.fork"
WEB_PORT="${STACK_WEB_PORT:-3200}"
HASURA_PORT="${STACK_HASURA_PORT:-8088}"
mkdir -p "$DIR"
# shellcheck disable=SC1091
source "$ROOT/scripts/procs.sh"
unset ETH_PASSWORD  # fork runs sign with test keys; a keystore password file makes forge and cast reject them
FORK_MARK="$DIR/stack-started-fork"
DOCKER_MARK="$DIR/stack-started-envio-docker"
# First line of every env file the fork scripts write (here and in scripts/web-env.sh --fork).
FORK_HEADER="# fork rehearsal: written by scripts/"

wait_for() { # url, label, tries
  for _ in $(seq 1 "${3:-120}"); do
    if curl -s -o /dev/null -w "%{http_code}" "$1" | grep -q -E "200|405"; then echo "$2 ready"; return 0; fi
    sleep 1
  done
  echo "$2 did not come up at $1" >&2
  return 1
}

# Keeps a hand-written or mainnet file: only a file the fork scripts wrote (first line FORK_HEADER) is replaced unsaved.
backup_unless_ours() { # file
  if [ -f "$1" ]; then
    case "$(sed -n 1p "$1")" in
      "$FORK_HEADER"*) ;;
      *) cp -p "$1" "$1.bak" && echo "kept the previous ${1#"$ROOT"/} as ${1#"$ROOT"/}.bak" ;;
    esac
  fi
}

down() {
  stop_pidfile "$DIR/stack-web.pid" web
  stop_pidfile "$DIR/stack-keeper.pid" keeper
  stop_pidfile "$DIR/stack-envio.pid" indexer
  if [ -f "$DOCKER_MARK" ]; then
    (cd "$ROOT/indexer" && pnpm exec envio stop >/dev/null 2>&1) || true
    rm -f "$DOCKER_MARK"
    echo "stopped Envio's Postgres and Hasura containers"
  fi
  if [ -f "$FORK_MARK" ]; then
    bash "$ROOT/scripts/fork.sh" stop >/dev/null 2>&1 || true
    rm -f "$FORK_MARK"
    echo "stopped the fork"
  elif [ -f "$DIR/anvil.pid" ]; then
    echo "left running: a fork this script did not start (bash scripts/fork.sh stop stops it)"
  fi
  echo "stack stopped"
}

up() {
  down >/dev/null
  echo "== fork"
  if running=$(pid_live "$DIR/anvil.pid" anvil); then
    echo "a fork that this script did not start is running (pid $running); stop it with bash scripts/fork.sh stop" >&2
    exit 1
  fi
  : > "$FORK_MARK"
  bash scripts/fork.sh
  # shellcheck disable=SC1091
  source "$DIR/accounts.env"

  echo "== deploy (waiting period ${STACK_MIN_COVER_SECONDS:-20} s)"
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
  backup_unless_ours "$ROOT/indexer/.env"
  cat > "$ROOT/indexer/.env" <<ENV
${FORK_HEADER}stack.sh; a previous file not written by a fork run, if any, is in indexer/.env.bak
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
  : > "$DOCKER_MARK"
  (cd indexer && set -a && . ./.env && set +a && pnpm exec envio local docker up > "$DIR/stack-envio.log" 2>&1)
  wait_for "http://localhost:$HASURA_PORT/healthz" "hasura" 180
  (
    cd indexer
    set -a && . ./.env && set +a
    export ENVIO_PG_PORT=5433 ENVIO_PG_PASSWORD=testing ENVIO_PG_USER=postgres ENVIO_PG_DATABASE=envio-dev ENVIO_TUI=false
    pnpm exec envio local db-migrate setup < /dev/null >> "$DIR/stack-envio.log" 2>&1
  )
  # Each server is started so that $! is its own PID (exec replaces the subshell), never through `( ... & )`.
  (
    cd indexer
    set -a && . ./.env && set +a
    export ENVIO_PG_PORT=5433 ENVIO_PG_PASSWORD=testing ENVIO_PG_USER=postgres ENVIO_PG_DATABASE=envio-dev ENVIO_TUI=false
    exec nohup pnpm exec envio start < /dev/null >> "$DIR/stack-envio.log" 2>&1
  ) &
  pid_record $! "$DIR/stack-envio.pid"

  if [ "${STACK_KEEPER:-1}" = "1" ]; then
    echo "== keeper"
    # Fork rehearsals reprice every block for as long as the keeper runs: the Playwright run needs three consecutive
    # reprices after an opt-in that can come minutes after the keeper starts. The lock file stays in .fork/. The
    # keeper also loads keeper/.env, where a variable already in the environment wins even when empty (and empty
    # means unset to the keeper), so KEEPER_PRIVATE_KEY_FILE and the address overrides are passed empty.
    MONAD_RPC_URL="$FORK_RPC_URL" MONAD_WS_URL="$FORK_WS_URL" CHAIN_ID=143 KEEPER_PRIVATE_KEY="$KEEPER_PRIVATE_KEY" \
      KEEPER_PRIVATE_KEY_FILE='' KEEPER_LOCK_FILE="$DIR/stack-keeper.lock" REPRICE_WINDOW_BLOCKS="${REPRICE_WINDOW_BLOCKS:-0}" \
      SHIELD_DEPLOYMENT_FILE="$DEPLOYMENT" SHIELD_REGISTRY='' SHIELD_REPRICER='' SHIELD_EXECUTOR='' \
      nohup pnpm --filter keeper start < /dev/null > "$DIR/stack-keeper.log" 2>&1 &
    pid_record $! "$DIR/stack-keeper.pid"
  fi

  echo "== web"
  NEXT_PUBLIC_ENVIO_GRAPHQL_URL="http://localhost:$HASURA_PORT/v1/graphql" bash scripts/web-env.sh --fork
  if [ "${STACK_WEB_MODE:-start}" = "dev" ]; then
    (cd web && exec nohup pnpm exec next dev --port "$WEB_PORT" < /dev/null > "$DIR/stack-web.log" 2>&1) &
  else
    (cd web && pnpm build > "$DIR/stack-web-build.log" 2>&1)
    (cd web && exec nohup pnpm exec next start -p "$WEB_PORT" < /dev/null > "$DIR/stack-web.log" 2>&1) &
  fi
  pid_record $! "$DIR/stack-web.pid"
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
  *) awk 'NR == 1 { next } /^#/ { print; next } { exit }' "$0" >&2; exit 1 ;;
esac
