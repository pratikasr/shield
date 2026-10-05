#!/usr/bin/env bash
# The demo's on-chain steps. Every step is a real transaction, signed by a Foundry keystore account or by a key from
# the environment; no key is ever needed on the command line.
#
#   bash scripts/demo-position.sh seed      LP deposits VAULT_SEED USDC units into the ShieldVault
#   bash scripts/demo-position.sh position  borrower supplies DEMO_WETH and borrows USDC to DEMO_HF_BPS, no cover
#                                           (for the video, where the opt-in happens in the web app on camera)
#   bash scripts/demo-position.sh open      borrower supplies DEMO_WETH, borrows USDC to DEMO_HF_BPS, approves the
#                                           Executor on aWETH, opts in with DEMO_TRIGGER_BPS, prepays DEMO_PREPAY
#   bash scripts/demo-position.sh keeper    starts the keeper against the deployment; its JSON log also goes to
#                                           KEEPER_LOG [keeper.log, or .fork/demo-keeper.log on a fork]
#   bash scripts/demo-position.sh nudge     checks the cover first (active, waiting period over, aWETH approval,
#                                           vault liquidity, a live keeper log), then the borrower borrows more
#                                           until HF is DEMO_NUDGE_HF_BPS, at or under the trigger, so the keeper exits
#   bash scripts/demo-position.sh all       seed, open, then keeper
#
# Options, after the command and in any order: --fork (any command) runs against the local fork from scripts/fork.sh
# with the test keys in .fork/accounts.env; --force-nudge (nudge only) borrows even when a check fails.
# Mainnet signers: DEMO_ACCOUNT and LP_ACCOUNT name Foundry keystores in ~/.foundry/keystores (preferred; forge
# prompts for the password, or reads it from the file named by ETH_PASSWORD), else DEMO_PRIVATE_KEY and
# LP_PRIVATE_KEY. DEMO_ADDRESS and LP_ADDRESS (recommended) save a password prompt, and forge refuses a key that does
# not match them. The keeper takes KEEPER_PRIVATE_KEY_FILE (a chmod 600 file holding the key, preferred) or
# KEEPER_PRIVATE_KEY.
# Mainnet env: MONAD_RPC_URL (local URLs are refused; the chain id must be 143), MONAD_WS_URL.
# Sizing (defaults in brackets): DEMO_WETH [0.05 WETH in wei], DEMO_HF_BPS [10700], DEMO_TRIGGER_BPS [10500],
# DEMO_NUDGE_HF_BPS [10450], DEMO_PREPAY [5000000 = 5 USDC], VAULT_SEED [100000000 = 100 USDC].
# WETH's LTV is below its liquidation threshold, so borrowing alone stops at HF 1.0435; the default trigger of
# 1.05 can therefore be reached either by the market or by the nudge.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALLER_DIR="$PWD"
usage() { awk 'NR == 1 { next } /^#/ { print; next } { exit }' "$0" >&2; exit 1; }

CMD="${1:-}"
case "$CMD" in seed | position | open | nudge | keeper | all) shift ;; *) usage ;; esac
FORK=0 FORCE_NUDGE=0
for arg in "$@"; do
  case "$arg" in
    --fork) FORK=1 ;;
    --force-nudge) if [ "$CMD" = nudge ]; then FORCE_NUDGE=1; else usage; fi ;;
    *) usage ;;
  esac
done

# shellcheck disable=SC1091
source "$ROOT/scripts/require-foundry.sh"
# shellcheck disable=SC1091
source "$ROOT/scripts/mainnet-lib.sh"
if [ "$FORK" = 1 ]; then
  # Fork runs sign with the throwaway test keys only, never with a mainnet keystore or key file from the shell.
  unset DEMO_ACCOUNT LP_ACCOUNT KEEPER_ACCOUNT KEEPER_PRIVATE_KEY_FILE ETH_PASSWORD
  [ -f "$ROOT/.fork/accounts.env" ] || { echo "no fork running: start one with bash scripts/fork.sh" >&2; exit 1; }
  # shellcheck disable=SC1091
  source "$ROOT/.fork/accounts.env"
  RPC="$FORK_RPC_URL"; WS="$FORK_WS_URL"; DEPLOYMENT="$ROOT/contracts/deployments/fork-143.json"
  KEEPER_LOG="${KEEPER_LOG:-$ROOT/.fork/demo-keeper.log}"
else
  require_mainnet_rpc "${MONAD_RPC_URL:-}" MONAD_RPC_URL
  if [ -n "${MONAD_WS_URL:-}" ]; then require_not_local "$MONAD_WS_URL" MONAD_WS_URL; fi
  RPC="$MONAD_RPC_URL"; WS="${MONAD_WS_URL:-}"; DEPLOYMENT="$ROOT/contracts/deployments/143.json"
  KEEPER_LOG="${KEEPER_LOG:-$ROOT/keeper.log}"
fi
[ -f "$DEPLOYMENT" ] || { echo "no deployment at $DEPLOYMENT; run scripts/deploy-mainnet.sh first" >&2; exit 1; }

export DEPLOYMENT_FILE="$DEPLOYMENT"
export DEMO_WETH="${DEMO_WETH:-50000000000000000}"
export DEMO_HF_BPS="${DEMO_HF_BPS:-10700}"
export DEMO_TRIGGER_BPS="${DEMO_TRIGGER_BPS:-10500}"
export DEMO_PREPAY="${DEMO_PREPAY:-5000000}"
export VAULT_SEED="${VAULT_SEED:-100000000}"

A_WETH=0x4377b53aAA8b8e3fF7AA2843832CAF004f5Cb8b6
USDC_DEBT=0x9F555aB84C4e0a531B50283f09Dba7A97134c4e4
RECORD_SIG="record(address)(uint32,uint16,uint8,uint8,uint64,uint32,uint64,uint128,uint128,uint96,uint32,uint64)"
STATUS_NAMES=(Ready NotActive CoverLapsed AboveTrigger EModeUnsupported DiscountAboveMax NothingToRepay AllowanceTooLow
  PythStale OracleDeviation TargetUnreachable CoverWarmingUp)

dep() { node -e "console.log(require(process.argv[1])[process.argv[2]])" "$DEPLOYMENT" "$1"; }
# `cast call --json` prints a flat JSON array (big numbers as strings); this turns it into space-separated values.
call() { cast call "$@" --rpc-url "$RPC" --json | tr -d '[]" \n\t' | tr ',' ' '; }
big_ge() { node -e 'process.exit(BigInt(process.argv[1]) >= BigInt(process.argv[2]) ? 0 : 1)' "$1" "$2"; }
units() { # value decimals [decimal places shown, default 6]
  node -e 'const [v, d, p] = process.argv.slice(1).map(BigInt); const b = 10n ** d;
    if (v >= 2n ** 255n) console.log("unlimited");
    else console.log(`${v / b}.${(v % b).toString().padStart(Number(d), "0").slice(0, Number(p))}`);' "$1" "$2" "${3:-6}"
}
# Seconds since the newest line with a `ts` field in the keeper's JSON log, or nothing when there is none.
log_age() {
  node -e 'const fs = require("fs"); const f = process.argv[1];
    if (!fs.existsSync(f)) process.exit(0);
    const fd = fs.openSync(f, "r"); const size = fs.fstatSync(fd).size; const n = Math.min(size, 262144);
    const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, size - n);
    for (const l of buf.toString("utf8").split("\n").reverse()) {
      let j; try { j = JSON.parse(l); } catch { continue; }
      const t = j && typeof j.ts === "string" ? Date.parse(j.ts) : NaN;
      if (!Number.isNaN(t)) { console.log(((Date.now() - t) / 1000).toFixed(1)); break; }
    }' "$1"
}

forge_run() { # ROLE target [forge args...]
  local role="$1" target="$2"
  shift 2
  signer_args "$role"
  (cd "$ROOT/contracts" && forge script "$target" "$@" --rpc-url "$RPC" "${SIGNER_ARGS[@]}" --broadcast --slow)
}

seed() { forge_run LP script/SeedVault.s.sol:SeedVault; }
open() { forge_run DEMO script/DemoPosition.s.sol:DemoPosition --sig "open()"; }
position() { forge_run DEMO script/DemoPosition.s.sol:DemoPosition --sig "openPosition()"; }

# Checks that an exit can follow the nudge. Prints one line per check; returns 1 when a required check fails.
preflight() { # borrower
  local b="$1" registry executor vault fail=0 rec flags opted min now ready bal allowance avail debt age
  registry=$(dep PositionRegistry); executor=$(dep Executor); vault=$(dep ShieldVault)
  rec=$(call "$registry" "$RECORD_SIG" "$b") || { echo "could not read the registry record of $b" >&2; exit 1; }
  read -r -a rec <<< "$rec"
  flags="${rec[2]}"; opted="${rec[6]}"
  if [ $((flags & 1)) -eq 0 ]; then
    echo "FAIL  cover: not active for $b (flags $flags); opt in first (web app, or the open command)"; fail=1
  elif [ $((flags & 2)) -ne 0 ]; then
    echo "FAIL  cover: lapsed, the prepaid balance ran out; top it up in the web app"; fail=1
  else
    echo "ok    cover: active, trigger $(units "${rec[0]}" 4 2)"
  fi

  min=$(call "$executor" "minCoverSeconds()(uint32)")
  now=$(cast block latest --field timestamp --rpc-url "$RPC")
  ready=$((opted + min))
  if [ "$now" -ge "$ready" ]; then
    echo "ok    waiting period: over (opted in at $opted, minCoverSeconds $min, latest block $now)"
  else
    echo "FAIL  waiting period: $((ready - now)) seconds left (opted in at $opted + minCoverSeconds $min; latest block $now)"; fail=1
  fi

  bal=$(call "$A_WETH" "balanceOf(address)(uint256)" "$b")
  allowance=$(call "$A_WETH" "allowance(address,address)(uint256)" "$b" "$executor")
  if big_ge "$allowance" "$bal"; then
    echo "ok    aWETH approval to the Executor: $(units "$allowance" 18), balance $(units "$bal" 18)"
  else
    echo "FAIL  aWETH approval to the Executor is $(units "$allowance" 18), below the aWETH balance $(units "$bal" 18); approve the Executor on aWETH (the web app's \"Approve WETH for exits\")"; fail=1
  fi

  avail=$(call "$vault" "availableLiquidity()(uint256)")
  debt=$(call "$USDC_DEBT" "balanceOf(address)(uint256)" "$b")
  if big_ge "$avail" "$debt"; then
    echo "ok    vault liquidity: $(units "$avail" 6) USDC, borrower's debt $(units "$debt" 6) USDC"
  else
    echo "warn  vault liquidity: $(units "$avail" 6) USDC is below the borrower's debt $(units "$debt" 6) USDC; a large exit uses the flash-loan fallback"
  fi

  age=$(log_age "$KEEPER_LOG")
  if [ -z "$age" ]; then
    echo "warn  keeper: no log lines in $KEEPER_LOG; is the keeper running (bash scripts/demo-position.sh keeper)?"
  elif node -e 'process.exit(Number(process.argv[1]) <= 10 ? 0 : 1)' "$age"; then
    echo "ok    keeper: last log line ${age} s ago"
  else
    echo "warn  keeper: last log line in $KEEPER_LOG is ${age} s old; is the keeper still running?"
  fi
  return "$fail"
}

nudge() {
  local borrower executor out status hf
  borrower=$(signer_address DEMO)
  executor=$(dep Executor)
  echo "preflight for borrower $borrower"
  if ! preflight "$borrower"; then
    if [ "$FORCE_NUDGE" = 1 ]; then
      echo "a check failed; borrowing anyway because of --force-nudge"
    else
      echo "a check failed, so nothing was borrowed. Fix it and run again, or add --force-nudge to borrow anyway." >&2
      exit 1
    fi
  fi
  DEMO_HF_BPS="${DEMO_NUDGE_HF_BPS:-10450}" forge_run DEMO script/DemoPosition.s.sol:DemoPosition --sig "borrowTo()"
  out=$(call "$executor" "previewExit(address)(uint8,uint256,uint256,uint256)" "$borrower") \
    || { echo "could not read previewExit" >&2; exit 1; }
  read -r -a out <<< "$out"
  status="${STATUS_NAMES[${out[0]}]:-status ${out[0]}}"
  hf=$(units "${out[3]}" 18 4)
  echo "previewExit after the nudge: $status, HF $hf"
  case "$status" in
    Ready) echo "the keeper should exit within a few blocks" ;;
    PythStale | OracleDeviation)
      echo "with PYTH_HERMES_API_KEY set, the keeper retries the exit with a fresh Pyth update every few blocks;"
      echo "without one it waits for Pyth's push feed to update on chain" ;;
    CoverWarmingUp) echo "the waiting period is not over; the keeper exits once it is" ;;
    *) echo "the Executor will not exit in this state" ;;
  esac
}

keeper() {
  local key="" file="" extra=()
  if [ "$FORK" = 1 ]; then
    key="$KEEPER_PRIVATE_KEY"
    # Fork rehearsals keep their lock file in .fork/ and use the mainnet repricing cadence (every block for the first
    # REPRICE_WINDOW_BLOCKS, then every 200): a keeper that reprices every block always has a transaction waiting for
    # the next block, and while one waits Anvil fails every "pending" query, which forge's gas estimate for the nudge
    # uses. Monad's pending tag is the proposed block, so mainnet has no such failure.
    extra=(KEEPER_LOCK_FILE="$ROOT/.fork/demo-keeper.lock")
    if [ -n "${REPRICE_WINDOW_BLOCKS:-}" ]; then extra+=(REPRICE_WINDOW_BLOCKS="$REPRICE_WINDOW_BLOCKS"); fi
  else
    key="${KEEPER_PRIVATE_KEY:-}"; file="${KEEPER_PRIVATE_KEY_FILE:-}"
    if [ -n "$file" ] && [ -n "$key" ]; then
      echo "set KEEPER_PRIVATE_KEY_FILE or KEEPER_PRIVATE_KEY, not both" >&2; exit 1
    fi
    if [ -z "$file" ] && [ -z "$key" ]; then
      echo "set KEEPER_PRIVATE_KEY_FILE (a chmod 600 file holding the keeper key, preferred) or KEEPER_PRIVATE_KEY" >&2
      exit 1
    fi
    if [ -n "$file" ]; then
      case "$file" in /*) ;; *) file="$CALLER_DIR/$file" ;; esac  # the keeper runs in keeper/: pass an absolute path
      [ -r "$file" ] || { echo "KEEPER_PRIVATE_KEY_FILE: cannot read $file" >&2; exit 1; }
    fi
  fi
  cd "$ROOT"
  # The keeper also loads keeper/.env, where a variable already in the environment wins even when empty, and it
  # treats empty as unset. So the unused key variable and the address overrides are passed empty: a stray
  # keeper/.env can neither add a second key nor point the keeper at other contracts. The variables are exported in
  # a subshell rather than passed through `env`, so a key never appears in a process's argument list.
  (
    export MONAD_RPC_URL="$RPC" MONAD_WS_URL="$WS" CHAIN_ID=143 KEEPER_PRIVATE_KEY="$key" KEEPER_PRIVATE_KEY_FILE="$file"
    export SHIELD_DEPLOYMENT_FILE="$DEPLOYMENT" SHIELD_REGISTRY='' SHIELD_REPRICER='' SHIELD_EXECUTOR=''
    if [ "${#extra[@]}" -gt 0 ]; then export "${extra[@]}"; fi
    pnpm --filter keeper start 2>&1 | tee -a "$KEEPER_LOG"
  )
}

case "$CMD" in
  seed) seed ;;
  position) position ;;
  open) open ;;
  nudge) nudge ;;
  keeper) keeper ;;
  all) seed; open; keeper ;;
esac
