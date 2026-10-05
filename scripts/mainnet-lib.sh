#!/usr/bin/env bash
# Sourced by the scripts that can act on Monad mainnet: deploy-mainnet.sh, verify-mainnet.sh, demo-position.sh and
# proof.sh. Needs cast on PATH (source require-foundry.sh first).
#
#   require_mainnet_rpc URL NAME   stop unless URL is a non-local RPC that reports chain id 143. Local URLs
#                                  (localhost, 127.x, 0.0.0.0, [::1]) are refused because they are forks, which also
#                                  report 143. Messages name the host only, since RPC URLs can carry an API key.
#   require_not_local URL NAME     the same local-URL refusal without the chain id check (for websocket URLs)
#   signer_args ROLE               set SIGNER_ARGS to forge's signer flags for ROLE (DEPLOYER, DEMO or LP):
#                                  --account ${ROLE}_ACCOUNT, a Foundry keystore in ~/.foundry/keystores (preferred;
#                                  forge prompts for its password, or reads it from the file named by ETH_PASSWORD),
#                                  else --private-key ${ROLE}_PRIVATE_KEY from the environment (forks and CI). When
#                                  ${ROLE}_ADDRESS is set, --sender is added, so forge refuses to sign with a key that
#                                  does not match it.
#   signer_address ROLE            ${ROLE}_ADDRESS when set, else the address of ${ROLE}_ACCOUNT,
#                                  ${ROLE}_PRIVATE_KEY_FILE or ${ROLE}_PRIVATE_KEY. Never prints a key.
#   derived_address ROLE           the address of the account or key only, ignoring ${ROLE}_ADDRESS (empty when
#                                  none is set)
# ETH_PASSWORD (forge's and cast's --password-file) works with keystores only: with it set, both reject
# --private-key. So the private-key paths here run without it.

url_host() {
  local u
  u=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  u="${u#*://}"
  u="${u%%/*}"
  u="${u%%\?*}"
  u="${u##*@}"
  case "$u" in
    \[*) printf '%s]' "${u%%]*}" ;;
    *) printf '%s' "${u%%:*}" ;;
  esac
}

is_local_url() {
  case "$(url_host "$1")" in
    localhost | localhost. | *.localhost | 0 | 0.0.0.0 | 127.* | ::1 | '[::1]' | '[::]' | '[0:0:0:0:0:0:0:1]' | '[::ffff:127.'*) return 0 ;;
  esac
  return 1
}

require_not_local() {
  if is_local_url "$1"; then
    echo "$2 points at $(url_host "$1"), a local address. Mainnet commands refuse local RPCs: a local node is a fork," >&2
    echo "which also reports chain 143. Use --fork for a rehearsal, or set $2 to a Monad mainnet RPC." >&2
    exit 1
  fi
}

require_mainnet_rpc() {
  local id
  if [ -z "$1" ]; then
    echo "set $2 to a Monad mainnet RPC (for example https://rpc.monad.xyz)" >&2
    exit 1
  fi
  require_not_local "$1" "$2"
  id=$(cast chain-id --rpc-url "$1" 2>/dev/null || true)
  if [ "$id" != "143" ]; then
    echo "$2 (host $(url_host "$1")) reports chain id ${id:-nothing, no answer}; Monad mainnet is 143" >&2
    exit 1
  fi
}

is_address() {
  case "$1" in 0x*) ;; *) return 1 ;; esac
  [ "${#1}" -eq 42 ] && [ -z "$(printf '%s' "${1#0x}" | tr -d '0-9a-fA-F')" ]
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

signer_args() {
  local acct="${1}_ACCOUNT" key="${1}_PRIVATE_KEY" addr="${1}_ADDRESS"
  if [ -n "${!acct:-}" ]; then
    SIGNER_ARGS=(--account "${!acct}")
  elif [ -n "${!key:-}" ]; then
    SIGNER_ARGS=(--private-key "${!key}")
    unset ETH_PASSWORD
  else
    echo "set $acct (a Foundry keystore name, preferred) or $key" >&2
    return 1
  fi
  if [ -n "${!addr:-}" ]; then SIGNER_ARGS+=(--sender "${!addr}"); fi
}

derived_address() {
  local acct="${1}_ACCOUNT" key="${1}_PRIVATE_KEY" file="${1}_PRIVATE_KEY_FILE" out pk
  if [ -n "${!acct:-}" ]; then
    out=$(cast wallet address --account "${!acct}") || { echo "could not open keystore account ${!acct}" >&2; return 1; }
  elif [ -n "${!file:-}" ]; then
    [ -r "${!file}" ] || { echo "$file: cannot read ${!file}" >&2; return 1; }
    pk=$(tr -d '[:space:]' < "${!file}")
    out=$(env -u ETH_PASSWORD cast wallet address --private-key "$pk" 2>/dev/null) \
      || { echo "$file does not hold a valid private key" >&2; return 1; }
  elif [ -n "${!key:-}" ]; then
    out=$(env -u ETH_PASSWORD cast wallet address --private-key "${!key}" 2>/dev/null) \
      || { echo "$key is not a valid private key" >&2; return 1; }
  else
    return 0
  fi
  printf '%s\n' "$out" | grep -E '^0x[0-9a-fA-F]{40}$' | tail -n 1
}

signer_address() {
  local addr="${1}_ADDRESS" out
  if [ -n "${!addr:-}" ]; then
    is_address "${!addr}" || { echo "$addr is not an address" >&2; return 1; }
    printf '%s\n' "${!addr}"
    return 0
  fi
  out=$(derived_address "$1") || return 1
  [ -n "$out" ] || { echo "set ${1}_ADDRESS, ${1}_ACCOUNT or ${1}_PRIVATE_KEY" >&2; return 1; }
  printf '%s\n' "$out"
}
