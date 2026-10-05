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
# Attach the keeper's own record of each reprice in the captured run: wall-clock receipt time and latency.
node -e '
  const fs = require("fs");
  const [resultPath, logPath] = process.argv.slice(1);
  const r = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const byHash = new Map(lines.filter((l) => l.event === "tx.included").map((l) => [l.hash.toLowerCase(), l]));
  for (const x of r.consecutiveReprices ?? []) {
    const k = byHash.get(x.tx.toLowerCase());
    if (k) { x.keeperReceiptAt = k.ts; x.latencyMs = k.latencyMs; x.gasUsed = k.gasUsed; x.mode = k.mode; }
  }
  const exit = r.exitTx && byHash.get(r.exitTx.toLowerCase());
  if (exit) r.exitKeeper = { receiptAt: exit.ts, latencyMs: exit.latencyMs, gasUsed: exit.gasUsed, gasLimit: exit.gasLimit, mode: exit.mode };
  fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));
' "$ROOT/.fork/e2e-result.json" "$ROOT/.fork/stack-keeper.log"
echo "== result"
cat "$ROOT/.fork/e2e-result.json"
