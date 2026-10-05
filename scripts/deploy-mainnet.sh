#!/usr/bin/env bash
# Deploys the Shield contracts to Monad mainnet with forge script and verifies each one on MonadVision
# (Sourcify, no API key) and, when ETHERSCAN_API_KEY is set, on Monadscan. Writes the addresses to
# contracts/deployments/143.json.
#
#   MONAD_RPC_URL=https://rpc.monad.xyz DEPLOYER_PRIVATE_KEY=0x... KEEPER_ADDRESS=0x... bash scripts/deploy-mainnet.sh
#   bash scripts/deploy-mainnet.sh --fork     rehearsal on the local fork from scripts/fork.sh (no verification,
#                                             writes contracts/deployments/fork-143.json)
#
# The key is read from the environment only. KEEPER_ADDRESS (optional) becomes the vault's unwinder.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/contracts"

if [ "${1:-}" = "--fork" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/.fork/accounts.env"
  export DEPLOYMENT_NAME=fork-143 KEEPER_ADDRESS
  forge script script/Deploy.s.sol:Deploy --rpc-url "$FORK_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --slow
  echo "fork deployment written to contracts/deployments/fork-143.json"
  exit 0
fi

: "${MONAD_RPC_URL:?set MONAD_RPC_URL}"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY}"
CHAIN_ID=$(cast chain-id --rpc-url "$MONAD_RPC_URL")
if [ "$CHAIN_ID" != "143" ]; then echo "expected Monad mainnet (143), RPC reports $CHAIN_ID" >&2; exit 1; fi
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
echo "deployer $DEPLOYER balance $(cast balance "$DEPLOYER" --rpc-url "$MONAD_RPC_URL" --ether) MON"

export DEPLOYMENT_NAME=143 KEEPER_ADDRESS="${KEEPER_ADDRESS:-}"
forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --slow \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/

if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
  for name in PositionRegistry ShieldVault Repricer Executor UniswapV3Swapper; do
    addr=$(node -e "console.log(require('./deployments/143.json')['$name'])")
    forge verify-contract "$addr" "$name" --chain 143 --verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY" \
      --guess-constructor-args --watch || echo "Monadscan verification of $name needs a retry"
  done
fi
echo "deployment written to contracts/deployments/143.json"
