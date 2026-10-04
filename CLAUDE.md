# CLAUDE.md: agent guide for Shield

You are building Shield, an opt-in early exit for Aave V3 borrowers on Monad, for Track 01 (Onchain Finance and Trading) of Monad Metropolis. Submission closes 13 Oct 2026 11:59pm ET (14 Oct 09:29 IST). Every session works toward four contracts live on Monad mainnet, a keeper that exits a real position, a video of real transactions, and a README a judge can verify from addresses and tx hashes alone.

## Read first, in this order

1. `docs/PROGRESS.md`: what is done, what is next, what is blocked. Start every session here and end every session by updating it.
2. `docs/SPEC.md`: the product, the contracts, the pricing model, the Monad-specific design, the demo plan, the video script, the submission checklist, the VERIFY list. Source of truth for what to build.
3. `docs/TECH-DECISIONS.md`: stack, layout, networks, oracles, storage layout, testing. These are decided; build on them. To change one, add a superseding ADR with the reason.

## Rules

- Real chain only. Contracts are deployed to Monad mainnet (chain 143) for the proof and the video. Forks are for Foundry tests only and never appear in the demo. No mock lender, no mock oracle in anything a judge sees. If the own-Morpho-market demo path is used, the README says the market and oracle are ours.
- Secrets never enter the repo: deployer key, keeper key, RPC keys. `.env` is ignored; `.env.example` lists variable names with empty values and a one-line comment each. Scan your diff for secrets before every commit.
- Commit small and often with messages that say what changed and why. Push after every green milestone. Metropolis judges the commit history and it must fall inside 1 Sep to 13 Oct 2026.
- MIT license stays in the repo from the first commit. The repo must be public before submission (it is private at creation).
- Verify before you rely. Any external fact (Aave address, Pyth feed id, RPC method support, MIP-8 costs, library version) is checked against the live source first, then recorded in `docs/TECH-DECISIONS.md` under Verified facts with the date. Do not build on memory of how a protocol used to work.
- No placeholders in user-facing files. If a value is unknown, write `VERIFY:` followed by the exact command or URL that resolves it.
- Keep the README's Status, Deployments and Proof tables and `docs/PROGRESS.md` current at the end of every session.
- Gas is paid as gas_limit x price on Monad. Every keeper transaction uses a measured limit; the Executor's gas use is recorded from `forge snapshot` in the README.
- Do not estimate hours, effort or capacity anywhere in this repo. Report what is done and what is next.
- Ask the human only for the items under Human decisions below, for funds, for account logins, and for anything that spends real money. Everything else, decide, record, proceed.
- Write in plain English. No em-dashes.

## Toolchain

- Foundry (forge, cast, anvil), latest stable.
- Node 22 and `pnpm` (workspace at repo root for `keeper`, `web`, `indexer`).
- Envio CLI (`pnpx envio`).

Commands once scaffolds exist (M1 creates them and updates this section):

```
cd contracts && forge build && forge test
pnpm install && pnpm -r build
pnpm --filter keeper dev
pnpm --filter web dev
```

## Milestones

Work them in order. Each has acceptance criteria; a milestone is done when every criterion is met and `docs/PROGRESS.md` says so with the commit hash.

### M0 Verify

Resolve every VERIFY item in `docs/SPEC.md` plus the Pyth mainnet address, the Aave Monad flash-loan premium, the Monad EVM version for `foundry.toml`, and MIP-8 page size and costs. Record each under Verified facts in `docs/TECH-DECISIONS.md` with date and source. Pick the demo path (SPEC.md, Demo plan) and record it as an ADR.

Done when: all VERIFY boxes in SPEC.md are ticked, the extra facts are recorded, the demo path is an ADR.

### M1 Scaffold

- `contracts/`: `forge init --no-git`, dependencies from ADR-002, `foundry.toml` with Monad RPC profiles and `evm_version`, empty contract files with NatSpec headers, a passing placeholder test.
- Root `pnpm-workspace.yaml`; `keeper/` (TypeScript, viem, vitest), `web/` (`pnpm create next-app`, wagmi, viem, RainbowKit, shadcn/ui), `indexer/` (`envio init` against Monad 143).
- `scripts/export-abi.sh` copying Foundry ABIs into the TypeScript packages.
- `.github/workflows/ci.yml` per ADR-011. `.env.example` in each package.
- Root `README.md` Status table updated.

Done when: CI is green on main and every package builds locally.

### M2 Contracts

- `PositionRegistry` with the packed, page-aligned record layout (ADR-008); `optIn`, `setTrigger`, `optOut`, `record`, parameter setters, events.
- `Repricer`: premium formula from SPEC.md, realised volatility from the last N Pyth prices, accrual against prepaid balance, `topUp`, `withdrawUnused`, `Repriced` event.
- `Executor`: `exit(borrower, pythUpdate)`; vault funding then flash-loan fallback; `Pool.repay(asset, amount, 2, borrower)`; `aToken.transferFrom(borrower, vault, repaid x 1.01)`; revert unless HF after exit is above 1.0 and above pre-exit HF; `Exited` event with `savedVsAave`.
- `ShieldVault`: ERC-4626, `fund`, `receiveCollateral`, unwind seized aTokens to the vault asset.
- Foundry: unit tests for Repricer math and packing; fork tests for every Aave path; invariant test that `exit` never leaves HF at or below 1.0; `forge snapshot` committed.

Done when: `forge test` is green including fork tests, and the gas snapshot exists.

### M3 Keeper

- Subscribe to `monadNewHeads` with `commitState`; fallback polling on the `pending` tag if subscriptions are unavailable on the chosen RPC.
- Per proposed block: read `getUserAccountData` for every active record (from the indexer or registry enumeration); compare HF to trigger.
- Build `exit` with a fresh Pyth update and an EIP-2930 access list covering the registry page and the Aave reserve slots; submit with `eth_sendRawTransactionSync`; measured gas limit.
- Repricing loop: call `reprice` for active records each block on testnet first, then mainnet.
- Structured logs with block number, HF, decision, tx hash.

Done when: on testnet, the keeper reprices every block and exits a test position at its trigger, with tx hashes in the log.

### M4 Web

- Borrower: connect, list Aave positions, opt in (trigger, max discount, aToken approval, prepay), live premium ticking per block, comparison line ("Aave penalty if liquidated: $X. Shield: $Y."), position status including "unprotected" when the balance runs out, exit history with "penalty avoided".
- LP: deposit and withdraw, vault NAV, premium earned, exits executed, average discount captured.
- Data: live values from RPC on the proposed tag; history from the Envio GraphQL endpoint.

Done when: the video script in SPEC.md can be walked through on testnet without a terminal.

### M5 Indexer

- Envio config and handlers for `OptedIn`, `TriggerSet`, `OptedOut`, `Repriced`, `Exited`, `Deposit`, `Withdraw`; entities for Position, Reprice, Exit, VaultFlow.
- Deployed to Envio hosted service for Monad mainnet; endpoint recorded in the README.

Done when: the web history views read from the hosted endpoint and the README names Envio under Bounties.

### M6 Mainnet deployment and proof

- Deploy the four contracts to Monad mainnet with `forge script`, verify on the explorer, record addresses in the README Deployments table.
- Open the demo position(s) per the chosen demo path (human supplies funds); opt in; run the keeper; capture three consecutive repricing txs 300 ms apart and one real exit; record every tx hash in the README Proof table.
- Record the 3-minute video following the SPEC.md script; link it in the README.

Done when: a judge can open every address and tx hash in the README on monadvision.com or monadscan.com and watch the video.

### M7 Submission

- README final: Why Monad, comparison table, contract addresses, tx hashes, gas numbers, Envio bounty statement, pre-existing code disclosure (none), AI tools disclosure (Claude), license.
- Flip the repo to public.
- Submit on hackathon.monad.xyz: Track 01, Envio bounty, video link, write-up.

Done when: the portal shows the submission before the deadline and `docs/PROGRESS.md` records the confirmation time.

## Human decisions (ask, do not guess)

- Demo path: real Aave position only, or real Aave position for proof plus own Morpho Blue market for the scripted video (SPEC.md recommends both).
- Vault asset: USDC (default) or AUSD.
- Initial pricing parameters per collateral asset: `k`, `d_min`, `N` (ADR-009).
- Mainnet funding: MON for gas and deployment, vault seed amount, the demo position's collateral and debt sizes.
- Date to flip the repo to public (must be before submission).

## Definition of done for any change

Builds, tests pass (fork tests included when an RPC is available), no secrets in the diff, gas snapshot updated if the Executor changed, docs updated where behaviour changed, `docs/PROGRESS.md` updated if a milestone item moved.

## Session protocol

1. Read `docs/PROGRESS.md`. Pick the first unchecked item in the current milestone.
2. Verify any external fact you are about to depend on. Record it.
3. Build, test, commit, push.
4. Update `docs/PROGRESS.md`: what moved, commit hash, what is next, anything blocked and why.
