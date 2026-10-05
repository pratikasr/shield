#!/usr/bin/env bash
# Deploys the Envio indexer (indexer/) to Envio Cloud for Monad mainnet after the contracts are deployed.
# Needs a one-time `npx envio-cloud login` (browser) by the repo owner, and the Envio GitHub app installed on
# the repo. Reads the contract addresses and start block from contracts/deployments/143.json.
#
#   bash scripts/deploy-indexer.sh            create or update the indexer, set env vars, print the endpoint
#
# Env: ENVIO_ORG (your Envio organisation, usually your GitHub user), ENVIO_INDEXER (default shield),
#      ENVIO_API_TOKEN (HyperSync token from https://envio.dev/app/api-tokens).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENT="$ROOT/contracts/deployments/143.json"
[ -f "$DEPLOYMENT" ] || { echo "no mainnet deployment at $DEPLOYMENT; run scripts/deploy-mainnet.sh first" >&2; exit 1; }
: "${ENVIO_ORG:?set ENVIO_ORG}"
: "${ENVIO_API_TOKEN:?set ENVIO_API_TOKEN}"
NAME="${ENVIO_INDEXER:-shield}"
j() { node -e "console.log(require('$DEPLOYMENT')['$1'])"; }
cli() { npx -y envio-cloud "$@"; }

cli config set-org "$ENVIO_ORG"
if ! cli indexer get "$NAME" >/dev/null 2>&1; then
  cli indexer add --name "$NAME" --repo shield --branch main
fi
cli indexer settings set "$NAME" --root-dir indexer --config-file config.yaml --auto-deploy true || true
ENV_FILE=$(mktemp)  # holds the HyperSync token; private to this user and removed on exit
trap 'rm -f "$ENV_FILE"' EXIT
cat > "$ENV_FILE" <<ENV
ENVIO_API_TOKEN=$ENVIO_API_TOKEN
ENVIO_START_BLOCK=$(j block)
ENVIO_REGISTRY_ADDRESS=$(j PositionRegistry)
ENVIO_REPRICER_ADDRESS=$(j Repricer)
ENVIO_EXECUTOR_ADDRESS=$(j Executor)
ENVIO_VAULT_ADDRESS=$(j ShieldVault)
ENVIO_RPC_URL=https://rpc.monad.xyz
ENVIO_RPC_FOR=fallback
ENV
cli indexer env import "$NAME" "$ENV_FILE"
COMMIT=$(git -C "$ROOT" rev-parse HEAD)
echo "deploying commit $COMMIT; Envio builds on push when auto-deploy is on"
cli deployment status "$NAME" "$COMMIT" --watch-till-synced || true
cli deployment endpoint "$NAME" "$COMMIT"
echo "set NEXT_PUBLIC_ENVIO_GRAPHQL_URL in web/.env to the endpoint above and record it in the README"
