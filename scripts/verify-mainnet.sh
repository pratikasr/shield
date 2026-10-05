#!/usr/bin/env bash
# Verifies the Shield contracts listed in contracts/deployments/143.json: on MonadVision through Sourcify
# (https://sourcify-api-monad.blockvision.org/, no key) and, when ETHERSCAN_API_KEY is set, on Monadscan. It sends no
# transactions and never redeploys, so run it again until every contract is verified. Run it from the commit that
# was deployed: forge rebuilds the sources and the bytecode must match.
#
#   bash scripts/verify-mainnet.sh                     every contract
#   bash scripts/verify-mainnet.sh Executor Repricer   only these (PositionRegistry, ShieldVault, Repricer, Executor,
#                                                      UniswapV3Swapper)
#
# Env: MONAD_RPC_URL (Monad mainnet; local URLs are refused and the chain id must be 143), ETHERSCAN_API_KEY
# (optional; forge reads it from the environment, so it never appears on a command line).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENT="$ROOT/contracts/deployments/143.json"
SOURCIFY_URL=https://sourcify-api-monad.blockvision.org/
ALL=(PositionRegistry ShieldVault Repricer Executor UniswapV3Swapper)

source_id() {
  case "$1" in
    UniswapV3Swapper) echo "src/swappers/UniswapV3Swapper.sol:UniswapV3Swapper" ;;
    *) echo "src/$1.sol:$1" ;;
  esac
}

NAMES=("$@")
if [ "${#NAMES[@]}" -eq 0 ]; then NAMES=("${ALL[@]}"); fi
for name in "${NAMES[@]}"; do
  case " ${ALL[*]} " in
    *" $name "*) ;;
    *) awk 'NR == 1 { next } /^#/ { print; next } { exit }' "$0" >&2; echo "unknown contract: $name" >&2; exit 1 ;;
  esac
done

# shellcheck disable=SC1091
source "$ROOT/scripts/require-foundry.sh"
# shellcheck disable=SC1091
source "$ROOT/scripts/mainnet-lib.sh"
require_mainnet_rpc "${MONAD_RPC_URL:-}" MONAD_RPC_URL
[ -f "$DEPLOYMENT" ] || { echo "no mainnet deployment at contracts/deployments/143.json; run scripts/deploy-mainnet.sh first" >&2; exit 1; }
cd "$ROOT/contracts"

failed=()
for name in "${NAMES[@]}"; do
  addr=$(node -e "console.log(require(process.argv[1])[process.argv[2]] ?? '')" "$DEPLOYMENT" "$name")
  code=$(cast code "$addr" --rpc-url "$MONAD_RPC_URL" 2>/dev/null || true)
  if ! is_address "$addr" || [ -z "$code" ] || [ "$code" = "0x" ]; then
    echo "$name ${addr:-(no address)}: no code on chain, skipped" >&2
    failed+=("$name")
    continue
  fi
  echo "== $name $addr: MonadVision (Sourcify)"
  ok=1
  forge verify-contract "$addr" "$(source_id "$name")" --chain 143 --verifier sourcify --verifier-url "$SOURCIFY_URL" \
    --watch || ok=0
  if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
    echo "== $name $addr: Monadscan"
    forge verify-contract "$addr" "$(source_id "$name")" --chain 143 --verifier etherscan --rpc-url "$MONAD_RPC_URL" \
      --guess-constructor-args --watch || ok=0
  fi
  if [ "$ok" = 0 ]; then failed+=("$name"); fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "not verified: ${failed[*]}. Retry with: bash scripts/verify-mainnet.sh ${failed[*]}" >&2
  exit 1
fi
echo "verified: ${NAMES[*]}"
if [ -z "${ETHERSCAN_API_KEY:-}" ]; then echo "set ETHERSCAN_API_KEY and run again to verify on Monadscan too"; fi
