#!/usr/bin/env bash
# Deploys the Shield contracts to Monad mainnet with forge script. The addresses reach
# contracts/deployments/143.json only after the broadcast succeeded and every contract has code on chain.
# Verification is a separate step that can be retried on its own: bash scripts/verify-mainnet.sh.
#
#   bash scripts/deploy-mainnet.sh             deploy; refuses when contracts/deployments/143.json already exists
#   bash scripts/deploy-mainnet.sh --force     deploy again; the old 143.json is kept as 143.json.<UTC time>.bak
#   bash scripts/deploy-mainnet.sh --resume    finish a broadcast that stopped part way (forge script --resume),
#                                              then check the contracts and write 143.json
#   bash scripts/deploy-mainnet.sh --fork      rehearsal on the local fork from scripts/fork.sh; writes
#                                              contracts/deployments/fork-143.json, no checks, no verification
#
# Mainnet env:
#   MONAD_RPC_URL             a Monad mainnet RPC; local URLs are refused and the chain id must be 143
#   DEPLOYER_ACCOUNT          Foundry keystore name in ~/.foundry/keystores (preferred). forge prompts for its
#                             password; ETH_PASSWORD may instead name a chmod 600 file that holds it
#   DEPLOYER_PRIVATE_KEY      the alternative to DEPLOYER_ACCOUNT, for forks and CI
#   DEPLOYER_ADDRESS          optional: saves a second password prompt, and forge refuses a key that does not match
#   KEEPER_ADDRESS            required: becomes the vault's unwinder. Checked against KEEPER_ACCOUNT,
#                             KEEPER_PRIVATE_KEY_FILE or KEEPER_PRIVATE_KEY when one of them is set
#   SHIELD_MIN_COVER_SECONDS  optional waiting period before new cover can exit; the contract default is 900
# Fork env: STACK_MIN_COVER_SECONDS (the fork deployment's waiting period, default 20 seconds).
# No key is ever printed or needed on the command line.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENTS="$ROOT/contracts/deployments"
FINAL="$DEPLOYMENTS/143.json"
PENDING_NAME=143.pending
PENDING="$DEPLOYMENTS/$PENDING_NAME.json"
BROADCAST="$ROOT/contracts/broadcast/Deploy.s.sol/143/run-latest.json"
CONTRACTS=(PositionRegistry ShieldVault Repricer Executor UniswapV3Swapper)

usage() { awk 'NR == 1 { next } /^#/ { print; next } { exit }' "$0" >&2; exit 1; }
FORK=0 FORCE=0 RESUME=0
for arg in "$@"; do
  case "$arg" in
    --fork) FORK=1 ;;
    --force) FORCE=1 ;;
    --resume) RESUME=1 ;;
    *) usage ;;
  esac
done
if [ "$FORK" = 1 ] && [ $((FORCE + RESUME)) -gt 0 ]; then usage; fi

# shellcheck disable=SC1091
source "$ROOT/scripts/require-foundry.sh"
cd "$ROOT/contracts"

if [ "$FORK" = 1 ]; then
  if [ -f "$PENDING" ]; then
    echo "an unfinished mainnet deployment is waiting in contracts/deployments/$PENDING_NAME.json. A fork deployment" >&2
    echo "would overwrite contracts/broadcast/Deploy.s.sol/143/ (forks are chain 143 too), which forge script --resume" >&2
    echo "needs. Finish it first with bash scripts/deploy-mainnet.sh --resume, or remove the file if nothing was sent." >&2
    exit 1
  fi
  [ -f "$ROOT/.fork/accounts.env" ] || { echo "no fork running: start one with bash scripts/fork.sh" >&2; exit 1; }
  # shellcheck disable=SC1091
  source "$ROOT/.fork/accounts.env"
  unset ETH_PASSWORD  # a keystore password file makes forge reject --private-key
  # A short waiting period so scripted rehearsals and the Playwright run reach an exit within about 90 seconds.
  export DEPLOYMENT_NAME=fork-143 KEEPER_ADDRESS SHIELD_MIN_COVER_SECONDS="${STACK_MIN_COVER_SECONDS:-20}"
  echo "fork deployment, waiting period $SHIELD_MIN_COVER_SECONDS seconds"
  forge script script/Deploy.s.sol:Deploy --rpc-url "$FORK_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --slow
  echo "fork deployment written to contracts/deployments/fork-143.json"
  exit 0
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/mainnet-lib.sh"
require_mainnet_rpc "${MONAD_RPC_URL:-}" MONAD_RPC_URL

if [ -f "$FINAL" ] && [ "$FORCE" = 0 ]; then
  echo "contracts/deployments/143.json exists: Shield is already deployed on Monad mainnet. Refusing to deploy again." >&2
  echo "Verification failed or is missing? Run bash scripts/verify-mainnet.sh; it never redeploys." >&2
  echo "To replace the deployment on purpose, add --force (the old file is kept as a timestamped .bak)." >&2
  exit 1
fi
if [ "$RESUME" = 0 ] && [ -f "$PENDING" ] && [ "$FORCE" = 0 ]; then
  echo "contracts/deployments/$PENDING_NAME.json exists: an earlier deployment did not finish. If forge stopped part way," >&2
  echo "finish it with bash scripts/deploy-mainnet.sh --resume. If nothing was sent, remove that file and run again." >&2
  exit 1
fi
if [ "$RESUME" = 1 ] && [ ! -f "$PENDING" ]; then
  echo "nothing to resume: contracts/deployments/$PENDING_NAME.json does not exist" >&2
  exit 1
fi

signer_args DEPLOYER
DEPLOYER=$(signer_address DEPLOYER)

: "${KEEPER_ADDRESS:=}"
if [ -z "$KEEPER_ADDRESS" ]; then
  echo "set KEEPER_ADDRESS: the keeper's address becomes the vault's unwinder" >&2
  exit 1
fi
is_address "$KEEPER_ADDRESS" || { echo "KEEPER_ADDRESS is not an address" >&2; exit 1; }
if [ -n "${KEEPER_PRIVATE_KEY:-}" ] && [ -n "${KEEPER_PRIVATE_KEY_FILE:-}" ]; then
  echo "set KEEPER_PRIVATE_KEY_FILE or KEEPER_PRIVATE_KEY, not both" >&2
  exit 1
fi
KEEPER_DERIVED=$(derived_address KEEPER)
if [ -n "$KEEPER_DERIVED" ]; then
  if [ "$(lower "$KEEPER_DERIVED")" != "$(lower "$KEEPER_ADDRESS")" ]; then
    echo "KEEPER_ADDRESS $KEEPER_ADDRESS does not match the keeper's key or account ($KEEPER_DERIVED)" >&2
    exit 1
  fi
  echo "keeper $KEEPER_ADDRESS matches its key"
else
  echo "keeper $KEEPER_ADDRESS (not checked against a key: set KEEPER_ACCOUNT or KEEPER_PRIVATE_KEY_FILE to check it)"
fi

if [ -n "${SHIELD_MIN_COVER_SECONDS:-}" ]; then
  case "$SHIELD_MIN_COVER_SECONDS" in '' | *[!0-9]*) echo "SHIELD_MIN_COVER_SECONDS must be a whole number of seconds" >&2; exit 1 ;; esac
  echo "waiting period ${SHIELD_MIN_COVER_SECONDS} seconds (SHIELD_MIN_COVER_SECONDS; the contract default is 900)"
else
  echo "waiting period 900 seconds (the contract default)"
fi
echo "deployer $DEPLOYER balance $(cast balance "$DEPLOYER" --rpc-url "$MONAD_RPC_URL" --ether) MON"
export DEPLOYMENT_NAME="$PENDING_NAME" KEEPER_ADDRESS
RESUME_CMD="bash scripts/deploy-mainnet.sh --resume"
if [ -f "$FINAL" ]; then RESUME_CMD="$RESUME_CMD --force"; fi

broadcast_failed() {
  if [ ! -f "$PENDING" ]; then
    # Deploy.s.sol writes the planned addresses at the end of forge's simulation, before any broadcast.
    echo "forge stopped before or during its simulation, so nothing was sent and 143.json was not written. Fix the error above and run again." >&2
    exit 1
  fi
  cat >&2 <<MSG

The broadcast did not finish, so contracts/deployments/143.json was not written.
Some transactions may already be on chain: forge keeps them in contracts/broadcast/Deploy.s.sol/143/run-latest.json,
and the planned addresses are in contracts/deployments/$PENDING_NAME.json.
  - If forge stopped part way (RPC error, timeout, gas or balance), top up if needed and finish the same deployment:
      $RESUME_CMD
    (forge script --resume, then the same code check). Do not run a fork deployment first: forks are chain 143
    too and would overwrite that broadcast file.
  - If nothing was sent (check the deployer on the explorer), remove contracts/deployments/$PENDING_NAME.json and
    run again.
MSG
  exit 1
}

if [ "$RESUME" = 1 ]; then
  # The broadcast file must be this deployer's run, not a fork run that overwrote it.
  node - "$BROADCAST" "$PENDING" "$DEPLOYER" <<'NODE' || exit 1
const fs = require("fs");
const [file, pendingFile, deployer] = process.argv.slice(2);
if (!fs.existsSync(file)) { console.error(`no broadcast record at ${file}; nothing to resume`); process.exit(1); }
const txs = JSON.parse(fs.readFileSync(file, "utf8")).transactions || [];
const pending = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
const created = new Set(txs.filter((t) => t.contractAddress && t.transactionType === "CREATE").map((t) => t.contractAddress.toLowerCase()));
const foreign = txs.filter((t) => (t.transaction?.from || "").toLowerCase() !== deployer.toLowerCase());
const missing = ["PositionRegistry", "ShieldVault", "Repricer", "Executor", "UniswapV3Swapper"].filter((n) => !created.has(String(pending[n]).toLowerCase()));
if (foreign.length || missing.length) {
  console.error("the broadcast record does not match this deployment (a fork run may have overwritten it); not resuming.");
  console.error("Check the deployer's transactions on the explorer before deploying again with --force.");
  process.exit(1);
}
NODE
  forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_RPC_URL" "${SIGNER_ARGS[@]}" --resume --slow || broadcast_failed
else
  rm -f "$PENDING"
  forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_RPC_URL" "${SIGNER_ARGS[@]}" --broadcast --slow || broadcast_failed
fi

[ -f "$PENDING" ] || { echo "forge did not write contracts/deployments/$PENDING_NAME.json" >&2; exit 1; }
missing=0
for name in "${CONTRACTS[@]}"; do
  addr=$(node -e "console.log(require(process.argv[1])[process.argv[2]] ?? '')" "$PENDING" "$name")
  code=$(cast code "$addr" --rpc-url "$MONAD_RPC_URL" 2>/dev/null || true)
  if is_address "$addr" && [ -n "$code" ] && [ "$code" != "0x" ]; then
    echo "$name $addr has code"
  else
    echo "$name ${addr:-(no address)} has no code on chain" >&2
    missing=1
  fi
done
if [ "$missing" = 1 ]; then
  echo "contracts/deployments/143.json was not written. If the broadcast is still settling, wait a few seconds and" >&2
  echo "run $RESUME_CMD; otherwise see contracts/broadcast/Deploy.s.sol/143/run-latest.json." >&2
  exit 1
fi

if [ -f "$FINAL" ]; then
  backup="$FINAL.$(date -u +%Y%m%dT%H%M%SZ).bak"
  cp -p "$FINAL" "$backup"
  echo "previous deployment kept as ${backup#"$ROOT"/}"
fi
mv "$PENDING" "$FINAL"
echo "deployment written to contracts/deployments/143.json"
echo "next: bash scripts/verify-mainnet.sh (MonadVision through Sourcify; Monadscan too with ETHERSCAN_API_KEY)"
