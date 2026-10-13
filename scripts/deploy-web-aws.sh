#!/usr/bin/env bash
# Hosts the web app on an AWS Lightsail container service: builds the image (web/Dockerfile), pushes it, deploys it
# as a new version, waits until that version is live, checks the pages and prints the HTTPS URL. Safe to rerun: the
# first run creates the service, later runs only deploy a new version. Rerun after the mainnet deployment so the app
# picks up the contract addresses.
#
#   bash scripts/deploy-web-aws.sh            build, push, deploy, wait, check, print the URL
#   bash scripts/deploy-web-aws.sh --check    only check the live site
#
# Values compiled into the app (NEXT_PUBLIC_*, fixed at build time):
#   contract addresses    contracts/deployments/143.json when it exists (PositionRegistry, Repricer, Executor,
#                         ShieldVault, ShieldForwarderFactory); before the mainnet deployment they are empty: the
#                         landing page and Stats work, Protect and Vault say Shield is not configured
#   network               SHIELD_WEB_NETWORK=testnet builds the Monad testnet staging app instead (ADR-040):
#                         contracts/deployments/10143.json and the Aave V3 market in aave-10143.json, chain 10143
#   Aurora app key        NEXT_PUBLIC_AURORA_APP_KEY, else the file AURORA_APP_KEY_FILE [~/.shield/aurora-app-key]
#   Envio, WalletConnect  NEXT_PUBLIC_ENVIO_GRAPHQL_URL, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID from the environment
# The Monad RPC URL and the E2E test variables are never passed, so the hosted app reads Monad's public RPC, and
# .dockerignore keeps every .env file (web/.env.local holds the local fork's settings) out of the image.
#
# The check asks for /, /app/borrow, /app/vault and /app/stats and needs a 200 from each; before a push it also scans
# the image's JavaScript for a local RPC (localhost:8545, 127.0.0.1) and for the Aurora key, without printing the key.
#
# Env: AWS credentials as for the AWS CLI; AWS_REGION [aws configure get region, else us-east-1];
#      SHIELD_WEB_SERVICE [shield-web]; SHIELD_WEB_POWER [micro: 0.25 vCPU, 1 GB, USD 10 a month];
#      SHIELD_WEB_SCALE [1]; SHIELD_WEB_URL (check this URL instead, e.g. a custom domain);
#      SHIELD_WEB_WAIT_SECONDS [900].
# Needs Docker with buildx, the AWS CLI v2, node, and the lightsailctl plugin: `brew install aws/tap/lightsailctl`,
# or the binary from https://s3.us-west-2.amazonaws.com/lightsailctl/latest/darwin-arm64/lightsailctl on your PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
usage() { awk 'NR == 1 { next } /^#/ { print; next } { exit }' "$0" >&2; exit 1; }
MODE=deploy
case "${1:-}" in
  "") ;;
  --check) MODE=check ;;
  *) usage ;;
esac

REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"
REGION="${REGION:-us-east-1}"
SERVICE="${SHIELD_WEB_SERVICE:-shield-web}"
POWER="${SHIELD_WEB_POWER:-micro}"
SCALE="${SHIELD_WEB_SCALE:-1}"
WAIT="${SHIELD_WEB_WAIT_SECONDS:-900}"
PAGES=(/ /app/borrow /app/vault /app/stats)
ls_() { aws lightsail --region "$REGION" "$@"; }
service_field() { ls_ get-container-services --service-name "$SERVICE" --query "containerServices[0].$1" --output text; }

aurora_key() {
  if [ -n "${NEXT_PUBLIC_AURORA_APP_KEY:-}" ]; then printf %s "$NEXT_PUBLIC_AURORA_APP_KEY"; return; fi
  local file="${AURORA_APP_KEY_FILE:-$HOME/.shield/aurora-app-key}"
  [ -r "$file" ] && tr -d '[:space:]' < "$file"
  return 0
}

# Every page answers 200 on the live URL.
check_live() {
  local url="${SHIELD_WEB_URL:-$(service_field url)}" failed=0 code
  url="${url%/}"
  echo "checking $url"
  for page in "${PAGES[@]}"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$url$page" || true)
    printf '  %-12s %s\n' "$page" "$code"
    [ "$code" = 200 ] || failed=1
  done
  [ "$failed" = 0 ] || { echo "a page did not answer 200" >&2; return 1; }
  echo "live: $url"
}

# The image's JavaScript (everything the site serves, and the server's own chunks) must not name a local RPC, and must
# carry the Aurora key when one was given. Prints the matching file names, never the key.
scan_image() {
  local image="$1" hits
  hits=$(docker run --rm --platform linux/amd64 --entrypoint sh "$image" -c \
    "grep -rlE 'localhost:8545|127\.0\.0\.1' /app/web/.next/static /app/web/.next/server || true")
  if [ -n "$hits" ]; then echo "the image names a local RPC; refusing to push:" >&2; echo "$hits" >&2; return 1; fi
  echo "image scan: no localhost:8545 or 127.0.0.1 in the app's JavaScript"
  if [ -n "${NEXT_PUBLIC_AURORA_APP_KEY:-}" ]; then
    if docker run --rm --platform linux/amd64 -e NEXT_PUBLIC_AURORA_APP_KEY --entrypoint sh "$image" -c \
      'grep -rqF "$NEXT_PUBLIC_AURORA_APP_KEY" /app/web/.next/static'; then
      echo "image scan: Aurora app key is in the client bundle"
    else
      echo "the Aurora app key is missing from the client bundle" >&2; return 1
    fi
  else
    echo "image scan: no Aurora app key given; cross-chain top-ups will say they are not configured"
  fi
}

if [ "$MODE" = check ]; then check_live; exit; fi

command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
command -v lightsailctl >/dev/null || { echo "lightsailctl is missing; see the header of this script" >&2; exit 1; }

# Build values. Contract addresses only from a real deployment file: mainnet, or testnet staging when asked.
NETWORK="${SHIELD_WEB_NETWORK:-mainnet}"
DEPLOYMENT="$ROOT/contracts/deployments/143.json"
j() { node -e "const d = require(process.argv[1]); console.log(d[process.argv[2]] ?? '')" "$DEPLOYMENT" "$1"; }
NEXT_PUBLIC_CHAIN_ID="" NEXT_PUBLIC_AAVE_POOL="" NEXT_PUBLIC_AAVE_ORACLE="" NEXT_PUBLIC_AAVE_DATA_PROVIDER=""
NEXT_PUBLIC_AAVE_USDC="" NEXT_PUBLIC_AAVE_WETH=""
case "$NETWORK" in
  mainnet) ;;
  testnet)
    DEPLOYMENT="$ROOT/contracts/deployments/10143.json"
    AAVE="$ROOT/contracts/deployments/aave-10143.json"
    [ -f "$DEPLOYMENT" ] && [ -f "$AAVE" ] || { echo "testnet needs $DEPLOYMENT and $AAVE" >&2; exit 1; }
    a() { node -e "console.log(require(process.argv[1])[process.argv[2]])" "$AAVE" "$1"; }
    NEXT_PUBLIC_CHAIN_ID=10143
    NEXT_PUBLIC_AAVE_POOL="$(a Pool)" NEXT_PUBLIC_AAVE_ORACLE="$(a AaveOracle)"
    NEXT_PUBLIC_AAVE_DATA_PROVIDER="$(a ProtocolDataProvider)"
    NEXT_PUBLIC_AAVE_USDC="$(a USDC)" NEXT_PUBLIC_AAVE_WETH="$(a WETH)"
    echo "network: Monad testnet staging (Aave V3 pool $NEXT_PUBLIC_AAVE_POOL)" ;;
  *) echo "SHIELD_WEB_NETWORK must be mainnet or testnet" >&2; exit 1 ;;
esac
export NEXT_PUBLIC_CHAIN_ID NEXT_PUBLIC_AAVE_POOL NEXT_PUBLIC_AAVE_ORACLE NEXT_PUBLIC_AAVE_DATA_PROVIDER
export NEXT_PUBLIC_AAVE_USDC NEXT_PUBLIC_AAVE_WETH
NEXT_PUBLIC_SHIELD_REGISTRY="" NEXT_PUBLIC_SHIELD_REPRICER="" NEXT_PUBLIC_SHIELD_EXECUTOR=""
NEXT_PUBLIC_SHIELD_VAULT="" NEXT_PUBLIC_SHIELD_FORWARDERS=""
if [ -f "$DEPLOYMENT" ]; then
  NEXT_PUBLIC_SHIELD_REGISTRY="$(j PositionRegistry)"
  NEXT_PUBLIC_SHIELD_REPRICER="$(j Repricer)"
  NEXT_PUBLIC_SHIELD_EXECUTOR="$(j Executor)"
  NEXT_PUBLIC_SHIELD_VAULT="$(j ShieldVault)"
  NEXT_PUBLIC_SHIELD_FORWARDERS="$(j ShieldForwarderFactory)"
  echo "contracts: $DEPLOYMENT (registry $NEXT_PUBLIC_SHIELD_REGISTRY)"
else
  echo "contracts: no $DEPLOYMENT yet; the Protect and Vault pages will say Shield is not configured"
fi
export NEXT_PUBLIC_SHIELD_REGISTRY NEXT_PUBLIC_SHIELD_REPRICER NEXT_PUBLIC_SHIELD_EXECUTOR
export NEXT_PUBLIC_SHIELD_VAULT NEXT_PUBLIC_SHIELD_FORWARDERS
NEXT_PUBLIC_AURORA_APP_KEY="$(aurora_key)"
export NEXT_PUBLIC_AURORA_APP_KEY
export NEXT_PUBLIC_ENVIO_GRAPHQL_URL="${NEXT_PUBLIC_ENVIO_GRAPHQL_URL:-}"
export NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}"
echo "envio: ${NEXT_PUBLIC_ENVIO_GRAPHQL_URL:-none}; walletconnect: $([ -n "$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" ] && echo set || echo none)"

# The service: create it on the first run and wait until it can take images.
if ! ls_ get-container-services --service-name "$SERVICE" >/dev/null 2>&1; then
  echo "creating Lightsail container service $SERVICE in $REGION ($POWER x $SCALE)"
  ls_ create-container-service --service-name "$SERVICE" --power "$POWER" --scale "$SCALE" \
    --tags key=project,value=shield >/dev/null
fi
deadline=$((SECONDS + WAIT))
until case "$(service_field state)" in READY | RUNNING) true ;; *) false ;; esac; do
  [ "$SECONDS" -lt "$deadline" ] || { echo "service $SERVICE did not become ready" >&2; exit 1; }
  sleep 10
done

# Build for the service's CPU (amd64), scan, push.
TAG="$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- web .dockerignore || echo -dirty)"
IMAGE="shield-web:$TAG-$(date +%Y%m%d%H%M%S)"
echo "building $IMAGE"
docker buildx build --platform linux/amd64 --load -f "$ROOT/web/Dockerfile" -t "$IMAGE" \
  --build-arg NEXT_PUBLIC_SHIELD_REGISTRY --build-arg NEXT_PUBLIC_SHIELD_REPRICER \
  --build-arg NEXT_PUBLIC_SHIELD_EXECUTOR --build-arg NEXT_PUBLIC_SHIELD_VAULT \
  --build-arg NEXT_PUBLIC_SHIELD_FORWARDERS --build-arg NEXT_PUBLIC_AURORA_APP_KEY \
  --build-arg NEXT_PUBLIC_ENVIO_GRAPHQL_URL --build-arg NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID \
  --build-arg NEXT_PUBLIC_CHAIN_ID --build-arg NEXT_PUBLIC_AAVE_POOL --build-arg NEXT_PUBLIC_AAVE_ORACLE \
  --build-arg NEXT_PUBLIC_AAVE_DATA_PROVIDER --build-arg NEXT_PUBLIC_AAVE_USDC --build-arg NEXT_PUBLIC_AAVE_WETH \
  "$ROOT"
scan_image "$IMAGE"
echo "pushing $IMAGE"
PUSHED=$(ls_ push-container-image --service-name "$SERVICE" --label web --image "$IMAGE" 2>&1 | tee /dev/stderr \
  | grep -oE "\":$SERVICE\.web\.[0-9]+\"" | tr -d '"' | tail -1 || true)
[ -n "$PUSHED" ] || { echo "push did not report an image name" >&2; exit 1; }

# Deploy: one container on port 3000; the load balancer's health check asks for /.
CONTAINERS=$(printf '{"web":{"image":"%s","ports":{"3000":"HTTP"},"environment":{"NODE_ENV":"production"}}}' "$PUSHED")
ENDPOINT='{"containerName":"web","containerPort":3000,"healthCheck":{"path":"/","successCodes":"200-399","intervalSeconds":10,"timeoutSeconds":5,"healthyThreshold":2,"unhealthyThreshold":3}}'
VERSION=$(ls_ create-container-service-deployment --service-name "$SERVICE" --containers "$CONTAINERS" \
  --public-endpoint "$ENDPOINT" --query 'containerService.nextDeployment.version' --output text)
echo "deploying $PUSHED as version $VERSION"
deadline=$((SECONDS + WAIT))
while :; do
  STATE=$(ls_ get-container-service-deployments --service-name "$SERVICE" \
    --query "deployments[?version==\`$VERSION\`].state | [0]" --output text)
  case "$STATE" in
    ACTIVE) break ;;
    FAILED | INACTIVE) echo "version $VERSION is $STATE; the previous version keeps serving. Logs:" >&2
      ls_ get-container-log --service-name "$SERVICE" --container-name web --query 'logEvents[-30:].message' \
        --output text >&2 || true
      exit 1 ;;
  esac
  [ "$SECONDS" -lt "$deadline" ] || { echo "version $VERSION is still $STATE" >&2; exit 1; }
  sleep 10
done
echo "version $VERSION is live"
check_live
