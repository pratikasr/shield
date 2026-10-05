#!/usr/bin/env bash
# Round 2 end-to-end test: the video script from docs/SPEC.md, walked by Playwright through the real web app on a
# fresh local fork of Monad mainnet (tests only, ADR-020; nothing here is demo or proof material).
#
#   bash scripts/e2e.sh                 fresh fork at the latest block, then the full run
#   FORK_BLOCK=110600000 bash scripts/e2e.sh
#   E2E_KEEP=1 bash scripts/e2e.sh      leave the stack running afterwards
#
# Brings the stack up with scripts/stack.sh, runs web/e2e/video-script.spec.ts, writes .fork/e2e-result.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export STACK_WEB_PORT="${E2E_WEB_PORT:-3200}"

cleanup() { if [ "${E2E_KEEP:-0}" != "1" ]; then bash scripts/stack.sh down >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT

bash scripts/stack.sh up
# shellcheck disable=SC1091
source "$ROOT/.fork/accounts.env"

echo "== playwright"
E2E_BASE_URL="http://localhost:$STACK_WEB_PORT" E2E_RPC_URL="$FORK_RPC_URL" \
  E2E_DEPLOYMENT="$ROOT/contracts/deployments/fork-143.json" E2E_BORROWER="$DEMO_ADDRESS" \
  E2E_ADMIN_KEY="$DEPLOYER_PRIVATE_KEY" E2E_RESULT="$ROOT/.fork/e2e-result.json" \
  pnpm --filter web exec playwright test video-script
echo "== result"
cat "$ROOT/.fork/e2e-result.json"
