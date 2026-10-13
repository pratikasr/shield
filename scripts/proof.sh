#!/usr/bin/env bash
# Prints the README Deployments and Proof rows for a demo run, after checking each one on chain: every address must
# hold code and every transaction must have a successful receipt. Rows that fail a check say so instead of a link.
#
#   MONAD_RPC_URL=https://rpc.monad.xyz bash scripts/proof.sh     Monad mainnet (contracts/deployments/143.json);
#                                                                 local RPC URLs are refused, the chain id must be 143
#   bash scripts/proof.sh --fork                                  a fork rehearsal: format check only, never proof
#
# Sources:
#   addresses         contracts/deployments/143.json (fork-143.json with --fork)
#   repricing, exit   the keeper's JSON log: KEEPER_LOG [keeper.log; .fork/demo-keeper.log with --fork], as written by
#                     `scripts/demo-position.sh keeper`. Only `tx.included` lines sent to this deployment count:
#                     repriceMany to its Repricer, exit to its Executor; lines without a `to` field are ignored
#   opt-in            OPT_IN_TX if set; else the Envio endpoint ENVIO_GRAPHQL_URL (Position.optedInTx for DEMO_ADDRESS);
#                     else the optIn call in the broadcast of `scripts/demo-position.sh open`, only when it went to
#                     this deployment's PositionRegistry and, on mainnet, has a successful receipt there (forks are
#                     chain 143 too and write the same broadcast file)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-}" in
  --fork) MODE=fork ;;
  "") MODE=mainnet ;;
  *) awk 'NR == 1 { next } /^#/ { print; next } { exit }' "$0" >&2; exit 1 ;;
esac
if [ "$MODE" = fork ]; then
  # shellcheck disable=SC1091
  source "$ROOT/.fork/accounts.env"
  RPC="$FORK_RPC_URL"; DEPLOYMENT="$ROOT/contracts/deployments/fork-143.json"
  LOG="${KEEPER_LOG:-$ROOT/.fork/demo-keeper.log}"; EXPLORER=""
else
  # shellcheck disable=SC1091
  source "$ROOT/scripts/require-foundry.sh"
  # shellcheck disable=SC1091
  source "$ROOT/scripts/mainnet-lib.sh"
  require_mainnet_rpc "${MONAD_RPC_URL:-}" MONAD_RPC_URL
  RPC="$MONAD_RPC_URL"; DEPLOYMENT="$ROOT/contracts/deployments/143.json"
  LOG="${KEEPER_LOG:-$ROOT/keeper.log}"; EXPLORER="https://monadvision.com"
fi
[ -f "$DEPLOYMENT" ] || { echo "no deployment at $DEPLOYMENT" >&2; exit 1; }
[ -f "$LOG" ] || { echo "keeper log not found at $LOG (set KEEPER_LOG)" >&2; exit 1; }

DEPLOYMENT="$DEPLOYMENT" LOG="$LOG" RPC="$RPC" EXPLORER="$EXPLORER" MODE="$MODE" \
  BROADCAST="$ROOT/contracts/broadcast/DemoPosition.s.sol/143/open-latest.json" \
  OPT_IN_TX="${OPT_IN_TX:-}" ENVIO_GRAPHQL_URL="${ENVIO_GRAPHQL_URL:-}" DEMO_ADDRESS="${DEMO_ADDRESS:-}" \
  node <<'NODE'
const fs = require("fs");
const { DEPLOYMENT, LOG, RPC, EXPLORER, MODE, BROADCAST, OPT_IN_TX, ENVIO_GRAPHQL_URL, DEMO_ADDRESS } = process.env;
const d = JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

async function rpc(method, params) {
  try {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    return (await res.json()).result ?? null;
  } catch {
    return null;
  }
}
const short = (h) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const txLink = (h) => (EXPLORER ? `[${short(h)}](${EXPLORER}/tx/${h})` : `\`${h}\``);
const addrLink = (a) => (EXPLORER ? `[${a}](${EXPLORER}/address/${a})` : `\`${a}\``);
async function minedBlock(hash) {
  const r = await rpc("eth_getTransactionReceipt", [hash]);
  return r && r.status === "0x1" ? BigInt(r.blockNumber) : null;
}

async function optInTx() {
  if (OPT_IN_TX) return OPT_IN_TX;
  if (ENVIO_GRAPHQL_URL && DEMO_ADDRESS) {
    try {
      const res = await fetch(ENVIO_GRAPHQL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: `{ Position(where: { id: { _eq: "${DEMO_ADDRESS.toLowerCase()}" } }) { optedInTx } }` }),
      });
      const tx = (await res.json()).data?.Position?.[0]?.optedInTx;
      if (tx) return tx;
    } catch {}
  }
  if (fs.existsSync(BROADCAST)) {
    // Only an optIn sent to this deployment's registry; on mainnet it must also have a successful receipt there,
    // since a fork run (also chain 143) writes the same broadcast file.
    const b = JSON.parse(fs.readFileSync(BROADCAST, "utf8"));
    const t = (b.transactions || []).find(
      (x) => (x.function || "").startsWith("optIn") && (same(x.contractAddress, d.PositionRegistry) || same(x.transaction?.to, d.PositionRegistry)),
    );
    if (t?.hash && (MODE !== "mainnet" || (await minedBlock(t.hash)))) return t.hash;
  }
  return null;
}

(async () => {
  console.log("Deployments");
  for (const name of ["PositionRegistry", "Repricer", "Executor", "ShieldVault", "UniswapV3Swapper", "ShieldForwarderFactory"]) {
    const code = await rpc("eth_getCode", [d[name], "latest"]);
    const ok = code && code !== "0x";
    console.log(`| ${name} | ${ok ? addrLink(d[name]) : `${d[name]}: no code at this address`} |`);
  }
  // Where the protocol's share of premiums goes (ADR-037), read from the registry rather than the deployment file.
  const word = async (selector) => rpc("eth_call", [{ to: d.PositionRegistry, data: selector }, "latest"]);
  const treasuryWord = await word("0x61d027b3"); // treasury()
  const shareWord = await word("0x37ed3f1e"); // protocolShareBps()
  if (treasuryWord && shareWord) {
    const treasury = `0x${treasuryWord.slice(-40)}`;
    const shareBps = Number(BigInt(shareWord));
    console.log(`| Treasury (receives ${shareBps / 100}% of premiums) | ${addrLink(treasury)} |`);
  }

  const lines = fs.readFileSync(LOG, "utf8").split("\n").flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
  // Only transactions this deployment's contracts received: a log can hold lines from an older deployment or a fork.
  const included = lines.filter((l) => l.event === "tx.included" && l.status === "success" && typeof l.to === "string");
  const reprices = included.filter((t) => t.label === "repriceMany" && same(t.to, d.Repricer));
  let run = null;
  for (let i = 2; i < reprices.length && !run; i++) {
    const [a, b, c] = reprices.slice(i - 2, i + 1).map((t) => BigInt(t.block));
    if (b === a + 1n && c === b + 1n) run = reprices.slice(i - 2, i + 1);
  }
  // Without three in consecutive blocks (a keeper far from the RPC waits longer than a block for each receipt), the
  // three closest successive reprices, with their real block gaps.
  let closest = null;
  if (!run) {
    for (let i = 2; i < reprices.length; i++) {
      const trio = reprices.slice(i - 2, i + 1);
      const span = BigInt(trio[2].block) - BigInt(trio[0].block);
      if (!closest || span < closest.span) closest = { trio, span };
    }
  }
  const exit = included.find((t) => t.label === "exit" && same(t.to, d.Executor));

  console.log("\nProof");
  const opt = await optInTx();
  if (opt) {
    const b = await minedBlock(opt);
    console.log(`| Opt-in tx | ${b ? `${txLink(opt)} (block ${b})` : `${opt}: no successful receipt`} |`);
  } else console.log("| Opt-in tx | not found: set OPT_IN_TX, or ENVIO_GRAPHQL_URL and DEMO_ADDRESS |");

  if (run) {
    const parts = [];
    for (const t of run) {
      const b = await minedBlock(t.hash);
      parts.push(b ? `${txLink(t.hash)} (block ${b}, receipt ${t.ts})` : `${t.hash}: no successful receipt`);
    }
    const gaps = run.slice(1).map((t, i) => Date.parse(t.ts) - Date.parse(run[i].ts));
    console.log(`| Three repricing txs in consecutive blocks | ${parts.join("<br>")}<br>receipts ${gaps.join(" ms and ")} ms apart |`);
  } else if (closest) {
    const parts = [];
    for (const t of closest.trio) {
      const b = await minedBlock(t.hash);
      parts.push(b ? `${txLink(t.hash)} (block ${b}, receipt ${t.ts})` : `${t.hash}: no successful receipt`);
    }
    const blocks = closest.trio.map((t) => BigInt(t.block));
    const gaps = closest.trio.slice(1).map((t, i) => Date.parse(t.ts) - Date.parse(closest.trio[i].ts));
    console.log(`| Three successive repricing txs (${blocks[1] - blocks[0]} and ${blocks[2] - blocks[1]} blocks apart) | ${parts.join("<br>")}<br>receipts ${gaps.join(" ms and ")} ms apart |`);
  } else console.log("| Three successive repricing txs | none in the keeper log yet (the keeper reprices every block for REPRICE_WINDOW_BLOCKS blocks after it starts) |");

  if (exit) {
    const b = await minedBlock(exit.hash);
    console.log(`| Exit tx (\`Exited\` event) | ${b ? `${txLink(exit.hash)} (block ${b}, gas used ${exit.gasUsed} of a ${exit.gasLimit} limit)` : `${exit.hash}: no successful receipt`} |`);
  } else console.log("| Exit tx (`Exited` event) | none in the keeper log yet |");

  // The protocol share paid to the treasury (ADR-037): the latest ProtocolPremiumPaid from this deployment's Repricer.
  const PAID = "0xfd39072c2b34476c7ed9336cfc10d31d8fef474d73ee23607e478aa6e3101301"; // ProtocolPremiumPaid(address,uint256)
  const fromBlock = `0x${BigInt(d.block || 0).toString(16)}`;
  const paid = await rpc("eth_getLogs", [{ address: d.Repricer, topics: [PAID], fromBlock, toBlock: "latest" }]);
  const last = Array.isArray(paid) && paid.length ? paid[paid.length - 1] : null;
  if (last) {
    const units = BigInt(last.data);
    console.log(`| Protocol share paid to the treasury (\`ProtocolPremiumPaid\`) | ${txLink(last.transactionHash)} (block ${BigInt(last.blockNumber)}, ${units} USDC units of 6 decimals) |`);
  } else console.log("| Protocol share paid to the treasury | none yet: anyone can call Repricer.sweepProtocol() once a whole USDC unit is owed |");
})();
NODE
