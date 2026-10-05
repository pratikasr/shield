# Demo: rehearsals and the mainnet runbook

This file has two parts. The first records the Round 5 rehearsals: the SPEC.md video script run end to end on a local fork of Monad mainnet, twice from a clean state, plus one run of the scripted mainnet flow. Those are tests. Their transaction hashes exist only on a throwaway fork and must never appear in the README Proof table or the video. The second part is the runbook for the real thing on Monad mainnet, which needs the owner's funds and keys.

Demo path (ADR-015): a real Aave V3 Monad position, WETH collateral and USDC debt (ADR-016). The exit is reached either by the market or by a real extra borrow that moves the health factor (HF) under the trigger.

## Part 1: rehearsals on a fork (tests only)

### How each run starts from a clean state

`bash scripts/e2e.sh` stops anything left from an earlier run, then `scripts/stack.sh up`:

1. Starts a fresh Anvil fork of Monad mainnet at the latest block with 300 ms blocks (`scripts/fork.sh`), funds four throwaway Anvil accounts (0 deployer, 1 keeper, 2 borrower, 3 LP).
2. Deploys Shield with the mainnet deploy script (`scripts/deploy-mainnet.sh --fork`).
3. LP deposits 50 USDC (`scripts/demo-position.sh seed --fork`).
4. Borrower supplies 0.05 WETH to Aave and borrows USDC to HF 1.07, no cover (`DemoPosition.s.sol:openPosition()`).
5. Starts Postgres and Hasura with `envio local docker up` on a reset schema, then the Envio indexer, the keeper and a production build of the web app on port 3200.

Playwright (`web/e2e/video-script.spec.ts`) then walks the video script in a real browser and checks each claim against the fork's receipts and logs. Afterwards `scripts/e2e.sh` adds the keeper's receipt time, latency and gas for each transaction from the keeper's JSON log.

### Click path

| # | Where | Action | What the page shows |
| --- | --- | --- | --- |
| 1 | http://localhost:3200/app/borrow | Connect, then "Fork test wallet" | The position panel: HF 1.069, WETH collateral, USDC debt; the cover panel "Protect this position" |
| 2 | Cover panel, trigger slider | Focus the slider, press the right arrow twice (1.04 to 1.06) | Trigger 1.06, the trigger price, the premium quote, "Aave penalty if liquidated: $X. Shield: $Y." |
| 3 | Prepay, USDC | Type 5 | "Prepay $5.00" step enabled |
| 4 | Cover panel | Click "Approve WETH for exits" | "Approval finalised in block N" with the hash |
| 5 | Cover panel | Click "Approve USDC" | "USDC approval finalised in block N" |
| 6 | Cover panel | Click "Prepay $5.00" | "Prepayment finalised in block N" |
| 7 | Cover panel | Click "Opt in at 1.06" | Heading "Protected"; "Premium paid so far" rises every block; "Cover this block" shows the per-block premium |
| 8 | (fork only) | The test moves Aave's WETH price down 1.6% through a fork-only oracle source | HF 1.0529, under the trigger |
| 9 | Borrower page | Nothing to click | The keeper exits; the exit history reads "penalty avoided" with the amount from the `Exited` event and an explorer link |
| 10 | http://localhost:3200/app/vault | Open the LP page | Exits executed 1, the exit transaction in the table, premium earned above zero, average discount captured |

Step 8 is the only part of the rehearsal that cannot happen on mainnet. On mainnet the HF reaches the trigger through the market or through `scripts/demo-position.sh nudge`, a real extra borrow (Part 2).

### Run 1, 5 Oct 2026 (fork, test only)

Command: `bash scripts/e2e.sh`. Outcome: 1 passed, exit code 0. Fork of mainnet block 110642017; the deployment landed in fork block 110642035.

| Step | Fork block | Transaction |
| --- | --- | --- |
| Approve WETH for exits | | `0x22f80372a3ba2f8f7aebfdfb54e56b7f035e53a159d21235f59fe6431f2c1ea7` |
| Approve USDC | | `0x4a2f3b3f446961c3be3cc9f477813f57a145cbe912bdfc276b6ccd6541c4da92` |
| Prepay $5.00 | | `0x0c90e5d60859dca9735d7e9c367fbf170fd1bb6f5ca48896cbf9e20778640efb` |
| Opt in at 1.06 (`OptedIn`, trigger 10,600) | 110642413 | `0x0fd1222d7f5f008aaaf95d0c81de5f03168f0509e28f2edea3bed3520e808220` |
| Reprice 1 | 110642416 | `0x1f3d4ede1d47327403b49204e3ef1a5254460bfd9d38cd9110602ed2f30dc91d`, keeper receipt 03:16:56.184Z, 290 ms after send, 247,550 gas |
| Reprice 2 | 110642417 | `0xc5eef6f1bfdea775a63200f3deb03fc0f43a034c0a0ed1e7fe99e8f1fe797120`, keeper receipt 03:16:56.485Z (301 ms later), 292 ms after send, 210,498 gas |
| Reprice 3 | 110642418 | `0x2236befbb9b8859db62e4a0ef844929fc28dd21520fb84d20c89772ba32a4dd1`, keeper receipt 03:16:56.785Z (300 ms later), 292 ms after send, 193,498 gas |
| Price move (fork only) | | `0x4407cbd5b2d82113724a568113e804bb7c7c0adc9b4cf0ee2b5272e36c9786c3`, WETH $2,728.68 to $2,685.02 |
| Exit (`Exited`) | 110642449 | `0x309236e1e6bb45d386d795baf3833f21e848a8b547ea0bcca0f5ed8e4523e3d3`, repaid 26.470777 USDC, penalty avoided 1.191184 USDC, HF 1.0529 to 1.1200, 656,395 gas of a 754,855 limit, receipt 278 ms after send |

LP page after the exit: exits executed 1, premium earned $0.0000030, average discount captured 0.99%. Cover this block showed $0.00000010.

### Run 2, 5 Oct 2026 (fork, test only)

Command: `bash scripts/e2e.sh`, again from a clean state. Outcome: 1 passed, exit code 0. Fork of mainnet block 110642711; the deployment landed in fork block 110642729.

| Step | Fork block | Transaction |
| --- | --- | --- |
| Approve WETH for exits | | `0x22f80372a3ba2f8f7aebfdfb54e56b7f035e53a159d21235f59fe6431f2c1ea7` |
| Approve USDC | | `0x4a2f3b3f446961c3be3cc9f477813f57a145cbe912bdfc276b6ccd6541c4da92` |
| Prepay $5.00 | | `0x0c90e5d60859dca9735d7e9c367fbf170fd1bb6f5ca48896cbf9e20778640efb` |
| Opt in at 1.06 (`OptedIn`, trigger 10,600) | 110643135 | `0x0fd1222d7f5f008aaaf95d0c81de5f03168f0509e28f2edea3bed3520e808220` |
| Reprice 1 | 110643138 | `0x4eacb23b2e71ca6e6a513e2c252e4d7090b187920ffdad1f943284d3c233bf52`, keeper receipt 03:20:45.383Z, 294 ms after send, 247,550 gas |
| Reprice 2 | 110643139 | `0x93fde1874e4892184cb87c5bee7d1c6549335a58018f12333479bdc05bf85099`, keeper receipt 03:20:45.683Z (300 ms later), 291 ms after send, 210,498 gas |
| Reprice 3 | 110643140 | `0x69527c30910a7aa942a8f3a0a78300f957624e6bd0b6e11df9ce0402d4d74211`, keeper receipt 03:20:45.983Z (300 ms later), 287 ms after send, 193,498 gas |
| Price move (fork only) | | `0x4407cbd5b2d82113724a568113e804bb7c7c0adc9b4cf0ee2b5272e36c9786c3`, WETH $2,726.37 to $2,682.75 |
| Exit (`Exited`) | 110643168 | `0xe31c6f0b5134e4248f55300db9bc495723e5168d6c798c37a566df7c7f9de211`, repaid 26.448228 USDC, penalty avoided 1.190170 USDC, HF 1.0529 to 1.1200, 656,395 gas of a 754,855 limit, receipt 283 ms after send |

LP page after the exit: exits executed 1, premium earned $0.0000030, average discount captured 0.99%.

The four borrower transactions and the price-move transaction have the same hashes in both runs. That is expected: each fork starts from the same Anvil accounts with the same nonces, and those transactions carry the same calldata to the same addresses (the deployment addresses are deterministic too), so the signed bytes are identical. The opt-in lands in a different block, and every keeper transaction differs because its Pyth data and block differ.

The three repricing transactions sit in consecutive blocks and the keeper received their receipts 300 ms apart in both runs. Monad block timestamps are whole seconds, so the three blocks share one timestamp (1791170213 in run 1, 1791170442 in run 2); the keeper's receipt times are the sub-second evidence. On mainnet the explorer shows the same: three consecutive block numbers.

### Run 3: the scripted mainnet flow, no browser, 5 Oct 2026 (fork, test only)

The exact commands from Part 2, run with `--fork`:

```bash
bash scripts/fork.sh
bash scripts/deploy-mainnet.sh --fork
bash scripts/demo-position.sh seed --fork
bash scripts/demo-position.sh open --fork          # supply, borrow to HF 1.07, approve, opt in at 1.05, prepay 5 USDC
bash scripts/demo-position.sh keeper --fork        # in a second terminal
bash scripts/demo-position.sh nudge --fork         # borrow to HF 1.045
DEMO_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC bash scripts/proof.sh --fork
```

Fork of mainnet block 110644465. Every command exited 0. HF after `open` 1.0700; after `nudge` 1.0450.

| Item | Fork block | Transaction |
| --- | --- | --- |
| Opt-in (from the `open` broadcast) | 110644605 | `0xfcf29fffabad0cfdbce1cb0fc95ccd8b0230e63ce236c0054aa25ba3170b46cf` |
| Reprice 1 | 110644624 | `0x5d5707fc4e7614ed1a9c69667cac6019b6dbf09c164d4a3e4076d4bf47e57188`, receipt 03:27:09.478Z |
| Reprice 2 | 110644625 | `0x59119d064717c1a0b96e7b5a76656f59cfd5a00b23c43b1699dff94d4d809a6f`, receipt 03:27:09.777Z (299 ms later) |
| Reprice 3 | 110644626 | `0x256a44e7ec0083efdd08a18eebfa9cc0be0a58f1307a0621a45d0d45834512ea`, receipt 03:27:10.078Z (301 ms later) |
| Exit | 110644689 | `0xb973c01b6aa47354b2343fc57620f9c3cd4298cc612baff6a42b5be8f74263c7`, 683,186 gas of a 785,664 limit |

The keeper saw HF 1.0449 at block 110644686 and decided to exit at 03:27:28.164Z; the receipt arrived at 03:27:29.755Z, three blocks later. The send itself took 291 ms. The rest went to gas estimation and access-list creation against the fork, which fetches any state it has not cached from the public RPC; the mainnet timing will be measured in M6.

`scripts/proof.sh --fork` checked every address for code and every hash for a successful receipt and printed the README rows. On mainnet the same script prints them with MonadVision links.

## Part 2: the mainnet runbook

Everything here spends real MON and moves real tokens, so it is run by the repo owner. Use four fresh accounts. Keys go in environment variables only, never in a file inside the repo.

### Accounts and funding

Prices on 5 Oct 2026: gas 102 gwei on mainnet, WETH $2,726.39 on Aave's oracle, MON $0.0334.

| Account | Env var for its key | Send to it on Monad mainnet (chain 143) | What it pays for |
| --- | --- | --- | --- |
| Deployer | `DEPLOYER_PRIVATE_KEY` | 5 MON | The deploy script estimates 17,602,721 gas for the five contracts and wiring; at 102 gwei with forge's 1.3x limit that is about 2.3 MON |
| Keeper | `KEEPER_PRIVATE_KEY` | 100 MON | About 0.025 MON per every-block reprice of one borrower (limit about 246,000 gas) and about 0.08 MON per exit. Three 600-block (3-minute) recording windows cost about 45 MON; idle repricing every 200 blocks costs about 36 MON a day, so stop the keeper between sessions |
| Borrower | `DEMO_PRIVATE_KEY` | 0.05 WETH (`0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242`) and 5 MON | Supplies the WETH to Aave and borrows about $107 USDC itself, which pays the 5 USDC prepay; MON covers about seven transactions |
| LP | `LP_PRIVATE_KEY` | 100 USDC (`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`) and 1 MON | Seeds the vault, which funds the exit (about $27 at this size) |

Create each account with `cast wallet new` and export its key in the shell that runs the commands. The keeper address also becomes the vault's unwinder.

Position size sets the dollar figures on screen. At 0.05 WETH the exit repays about $27 and the penalty avoided is about $1.20 (4.5% of the amount repaid: Aave's 5.5% bonus minus Shield's 1% discount). Both scale with the position: 1 WETH gives about $545 repaid and $24 avoided, and then the LP seed must be at least $600 USDC so the vault, not the flash-loan fallback, funds the exit. Set `DEMO_WETH` (wei) and `VAULT_SEED` (USDC units, 6 decimals) to change them.

### Commands, in order

```bash
export PATH="$HOME/.foundry/bin:$PATH"        # Foundry 1.8 or later; the scripts stop with the fix if not
export MONAD_RPC_URL=https://rpc.monad.xyz MONAD_WS_URL=wss://rpc.monad.xyz
export DEPLOYER_PRIVATE_KEY=0x... KEEPER_PRIVATE_KEY=0x... DEMO_PRIVATE_KEY=0x... LP_PRIVATE_KEY=0x...
export KEEPER_ADDRESS=$(cast wallet address --private-key "$KEEPER_PRIVATE_KEY")
export DEMO_ADDRESS=$(cast wallet address --private-key "$DEMO_PRIVATE_KEY")

# 1. Deploy and verify on MonadVision (add ETHERSCAN_API_KEY to also verify on Monadscan)
bash scripts/deploy-mainnet.sh                  # writes contracts/deployments/143.json

# 2. Indexer on Envio's hosted service (one-time: npx envio-cloud login, Envio GitHub app on the repo)
ENVIO_ORG=<your Envio org> ENVIO_API_TOKEN=<HyperSync token> bash scripts/deploy-indexer.sh

# 3. Web app against the mainnet deployment
NEXT_PUBLIC_ENVIO_GRAPHQL_URL=<endpoint from step 2> bash scripts/web-env.sh
pnpm --filter web build && pnpm --filter web start   # http://localhost:3000; NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID adds WalletConnect

# 4. LP deposit
bash scripts/demo-position.sh seed

# 5. Borrower position at HF 1.07 without cover (the opt-in happens on camera)
bash scripts/demo-position.sh position

# 6. Keeper, in its own terminal, started just before recording; logs to keeper.log. It reprices every block for
#    600 blocks (3 minutes) from its start, then every 200 blocks; restart it to open a new window
REPRICE_WINDOW_BLOCKS=600 bash scripts/demo-position.sh keeper
```

Then record the video (below). When the borrower is protected, move the HF under the trigger with a real extra borrow:

```bash
DEMO_NUDGE_HF_BPS=10450 bash scripts/demo-position.sh nudge   # HF 1.045, under a 1.05 trigger
```

Borrowing alone cannot take a WETH position below HF 1.0435 (Aave allows borrowing up to the LTV, 80.5%, and liquidates at the threshold, 84%), so the trigger for the nudge path must be 1.05 or higher. A trigger of 1.04, as in the SPEC.md script, is reached only by the market.

After the exit:

```bash
ENVIO_GRAPHQL_URL=<endpoint from step 2> bash scripts/proof.sh   # README Deployments and Proof rows, each checked on chain
```

Paste the output into the README Deployments and Proof tables.

To run the opt-in from the command line instead of the browser, replace step 5 with `bash scripts/demo-position.sh open` (trigger `DEMO_TRIGGER_BPS`, default 10500, prepay `DEMO_PREPAY`, default 5 USDC).

### Video, 3 minutes

The SPEC.md script with the mainnet steps above:

1. Borrower page at the web app: connect a browser wallet (MetaMask or Rabby) holding the borrower key, on Monad mainnet. HF 1.07, WETH collateral, USDC debt. Set the trigger to 1.05 with the slider, prepay 5 USDC, run the four steps. The premium quote ticks every block; the comparison line reads "Aave penalty if liquidated: $X. Shield: $Y."
2. MonadVision: the opt-in transaction, then three repricing transactions in consecutive blocks (the keeper log has the hashes; `scripts/proof.sh` prints them).
3. Run the nudge. HF falls to 1.045; the keeper exits within a few blocks (three on the fork). Show the `Exited` event on MonadVision and the borrower page reading "penalty avoided".
4. LP page: premium earned, exits executed, average discount captured.
5. The comparison table on the landing page, 10 seconds.
6. One sentence on why Monad: per-block repricing and a page-warmed registry.

Every transaction in the video is on Monad mainnet. The fork rehearsals above are not shown.
