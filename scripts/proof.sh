#!/usr/bin/env bash
# Prints the README Deployments and Proof rows for a demo run, after checking each one on chain: every address must
# hold code and every transaction must have a successful receipt. Rows that fail a check say so instead of a link.
#
#   MONAD_RPC_URL=https://rpc.monad.xyz bash scripts/proof.sh     Monad mainnet (contracts/deployments/143.json)
#   bash scripts/proof.sh --fork                                  a fork rehearsal: format check only, never proof
#
# Sources:
#   addresses         contracts/deployments/143.json (fork-143.json with --fork)
#   repricing, exit   the keeper's JSON log: KEEPER_LOG [keeper.log; .fork/demo-keeper.log with --fork], as written by
#                     `scripts/demo-position.sh keeper`
#   opt-in            OPT_IN_TX if set; else the Envio endpoint ENVIO_GRAPHQL_URL (Position.optedInTx for DEMO_ADDRESS);
#                     else the broadcast of `scripts/demo-position.sh open`
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--fork" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/.fork/accounts.env"
  RPC="$FORK_RPC_URL"; DEPLOYMENT="$ROOT/contracts/deployments/fork-143.json"
  LOG="${KEEPER_LOG:-$ROOT/.fork/demo-keeper.log}"; EXPLORER=""
else
  : "${MONAD_RPC_URL:?set MONAD_RPC_URL}"
  RPC="$MONAD_RPC_URL"; DEPLOYMENT="$ROOT/contracts/deployments/143.json"
  LOG="${KEEPER_LOG:-$ROOT/keeper.log}"; EXPLORER="https://monadvision.com"
fi
[ -f "$DEPLOYMENT" ] || { echo "no deployment at $DEPLOYMENT" >&2; exit 1; }
[ -f "$LOG" ] || { echo "keeper log not found at $LOG (set KEEPER_LOG)" >&2; exit 1; }

DEPLOYMENT="$DEPLOYMENT" LOG="$LOG" RPC="$RPC" EXPLORER="$EXPLORER" \
  BROADCAST="$ROOT/contracts/broadcast/DemoPosition.s.sol/143/open-latest.json" \
  OPT_IN_TX="${OPT_IN_TX:-}" ENVIO_GRAPHQL_URL="${ENVIO_GRAPHQL_URL:-}" DEMO_ADDRESS="${DEMO_ADDRESS:-}" \
  node <<'NODE'
const fs = require("fs");
const { DEPLOYMENT, LOG, RPC, EXPLORER, BROADCAST, OPT_IN_TX, ENVIO_GRAPHQL_URL, DEMO_ADDRESS } = process.env;

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
    const b = JSON.parse(fs.readFileSync(BROADCAST, "utf8"));
    return (b.transactions || []).find((t) => (t.function || "").startsWith("optIn"))?.hash ?? null;
  }
  return null;
}

(async () => {
  const d = JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));
  console.log("Deployments");
  for (const name of ["PositionRegistry", "Repricer", "Executor", "ShieldVault", "UniswapV3Swapper"]) {
    const code = await rpc("eth_getCode", [d[name], "latest"]);
    const ok = code && code !== "0x";
    console.log(`| ${name} | ${ok ? addrLink(d[name]) : `${d[name]}: no code at this address`} |`);
  }

  const lines = fs.readFileSync(LOG, "utf8").split("\n").flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
  const included = lines.filter((l) => l.event === "tx.included" && l.status === "success");
  const reprices = included.filter((t) => t.label === "repriceMany");
  let run = null;
  for (let i = 2; i < reprices.length && !run; i++) {
    const [a, b, c] = reprices.slice(i - 2, i + 1).map((t) => BigInt(t.block));
    if (b === a + 1n && c === b + 1n) run = reprices.slice(i - 2, i + 1);
  }
  const exit = included.find((t) => t.label === "exit");

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
  } else console.log("| Three repricing txs in consecutive blocks | none in the keeper log yet (REPRICE_EVERY_N_BLOCKS=1) |");

  if (exit) {
    const b = await minedBlock(exit.hash);
    console.log(`| Exit tx (\`Exited\` event) | ${b ? `${txLink(exit.hash)} (block ${b}, gas used ${exit.gasUsed} of a ${exit.gasLimit} limit)` : `${exit.hash}: no successful receipt`} |`);
  } else console.log("| Exit tx (`Exited` event) | none in the keeper log yet |");
})();
NODE
