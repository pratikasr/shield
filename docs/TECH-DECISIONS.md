# Shield: Technical Decisions

Decision log in ADR form. Each entry is a decision that is already made; agents build on it rather than reopening it. To change one, add a new entry that supersedes it and say why. Dates are when the decision was recorded.

## ADR-001 One monorepo, not separate repos (5 Oct 2026)

Decision: `pratikasr/shield` holds contracts, keeper, web, indexer, docs and scripts.

Why: Metropolis takes one repo link and judges the commit history of that repo. Contracts, keeper and web share ABIs and change together; a split would mean four repos to keep in sync and four histories to show. No GitHub organization: repos under the personal account are easier to connect to build agents and to submit.

Layout:

```
shield/
  contracts/    Foundry: PositionRegistry, Repricer, Executor, ShieldVault, tests, deploy scripts
  keeper/       TypeScript on viem: proposed-block watcher, exit submitter
  web/          Next.js with wagmi: borrower opt-in, LP vault dashboard
  indexer/      Envio HyperIndex: positions, repricing, exits (Envio bounty)
  docs/         SPEC.md, TECH-DECISIONS.md, PROGRESS.md
  scripts/      deployment, demo position setup, repricing capture
  CLAUDE.md     agent guide (AGENTS.md points here)
```

TypeScript packages (`keeper`, `web`, `indexer`) live in one pnpm workspace at the repo root. `contracts/` is a standalone Foundry project; its `out/` ABIs are consumed by the TypeScript packages through a small `abi` export step in `scripts/`.

## ADR-002 Contracts: Solidity with Foundry (5 Oct 2026)

Decision: Solidity 0.8.x (latest Foundry default at M1; record the exact version under Verified facts), Foundry for build, test and deploy. Dependencies: OpenZeppelin Contracts v5 (`ERC4626`, `SafeERC20`, `ReentrancyGuard`, `Ownable2Step`), Aave V3 interfaces from `aave-v3-origin` (`IPool`, `IAToken`, `IPoolAddressesProvider`, `IFlashLoanSimpleReceiver`), Pyth `pyth-sdk-solidity` (`IPyth`, `PythStructs`).

Why: Foundry gives mainnet-fork tests for every Aave interaction, gas snapshots for the "measured and documented" claim, and one-command deploys with verification. Nothing in Shield needs an upgradeable proxy; contracts are immutable with an owner for parameters only.

EVM target: set `evm_version` in `foundry.toml` to what Monad supports; VERIFY on docs.monad.xyz/developer-essentials/differences at M1 and record it.

## ADR-003 Keeper in TypeScript on viem (5 Oct 2026)

Decision: Node 22, TypeScript, viem, vitest. One long-running process.

Why: viem exposes raw RPC calls (`client.request`) so `eth_sendRawTransactionSync`, the `pending` block tag and `monadNewHeads` subscriptions are one-liners; ABIs come straight from the Foundry build and are shared with `web/` with full typing. Rust was considered and rejected on merit: no ABI sharing with the web app, slower iteration, and nothing in the keeper is CPU-bound.

## ADR-004 Web in Next.js 15 with wagmi and viem (5 Oct 2026)

Decision: Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, wagmi v2 + viem, RainbowKit for wallet connection. Live values (HF, premium per block, prepaid balance) are read directly from RPC on the proposed tag; history (positions, repricing, exits, vault flows) comes from the Envio indexer's GraphQL endpoint.

## ADR-005 Indexer on Envio HyperIndex (5 Oct 2026)

Decision: an Envio HyperIndex project indexing `OptedIn`, `TriggerSet`, `OptedOut`, `Repriced`, `Exited`, `Deposit`, `Withdraw` on Monad mainnet, deployed to Envio's hosted service. This is the Envio bounty deliverable and the README says so.

Verified 5 Oct 2026: Envio HyperSync supports Monad mainnet (chain 143, `https://143.hypersync.xyz`) and Monad testnet (chain 10143, `https://10143.hypersync.xyz`). Source: docs.envio.dev/docs/HyperIndex/supported-networks.

## ADR-006 Oracles: Pyth for pricing, Aave's own view for the trigger (5 Oct 2026)

Decision: the Repricer uses Pyth pull-oracle prices (update attached to the calldata) for realised volatility and distance. The trigger and the post-exit safety check use Aave's `getUserAccountData`, which reflects Aave's own Chainlink SVR feeds. The two never disagree about whether an exit is allowed, because only Aave's HF decides that.

Why: Aave's HF is what liquidators act on; pricing premium off a different feed is fine, gating exits off a different feed is not.

Verified 5 Oct 2026 (docs.monad.xyz/tooling-and-infra/oracles): Pyth is live on Monad mainnet and testnet. Testnet price feeds contract `0x2880aB155794e7179c9eE2e38200202908C17B43`; MON/USD feed id `0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1`. Mainnet contract address: VERIFY at M0 (Pyth's EVM address page did not list Monad when checked; use Monad's oracle page or Pyth's Monad entry).

## ADR-007 Networks (5 Oct 2026)

Decision: Monad mainnet (chain id 143) for deployment, proof and the demo. Monad testnet (chain id 10143) for staging only. Local Anvil forks of mainnet for Foundry tests and nothing else; a fork never appears in the video.

Verified 5 Oct 2026 (docs.monad.xyz/developer-essentials/network-information): mainnet chain id 143, native token MON, public RPCs `https://rpc.monad.xyz`, `https://rpc1.monad.xyz`, `https://rpc2.monad.xyz`, `https://rpc3.monad.xyz`, `https://rpc-mainnet.monadinfra.com`; explorers `https://monadvision.com` and `https://monadscan.com`.

## ADR-008 Registry storage layout for MIP-8 (5 Oct 2026)

Decision: each borrower record is packed into as few slots as possible and placed at a page-aligned base slot derived from the borrower address, so one EIP-2930 access-list entry warms the whole record. Field packing: trigger (uint32, HF x 1e4), maxDiscountBps (uint16), prepaid balance (uint128), accrued premium (uint128), last repriced block (uint64), flags (uint8). The exact slot arithmetic follows MIP-8's page definition; VERIFY the page size and warm/cold costs against mips.monad.xyz/MIPs/MIP-8 at M2 and record them.

## ADR-009 Pricing parameters (5 Oct 2026)

Decision: `k` per collateral asset, `d_min`, and the volatility window `N` are registry parameters set by the owner and published in the README. Initial values are a human decision before mainnet deployment (see CLAUDE.md). The Repricer is pure given those inputs, so it is unit-tested with fixed price series.

## ADR-010 Flash-loan fallback (5 Oct 2026)

Decision: when the vault cannot fund the full repay, the Executor borrows the gap with Aave `flashLoanSimple` and repays it from the seized aTokens (withdrawn to the underlying) in the same transaction. The flash-loan premium is a cost to the LPs, taken out of the 1% discount. VERIFY Aave Monad's current flash-loan premium at M0.

## ADR-011 Testing and CI (5 Oct 2026)

Decision:

- Foundry unit tests for the Repricer math and registry packing; fork tests (`--fork-url` mainnet) for every Aave call path including the flash-loan fallback and the HF invariant; `forge snapshot` committed for the Executor's gas.
- Keeper: vitest with a recorded RPC fixture; one live smoke test against testnet behind an env flag.
- Web: Playwright smoke of the opt-in page against testnet.
- GitHub Actions on every push: `forge fmt --check`, `forge build`, `forge test` (fork tests use an RPC URL secret and are skipped if absent), `pnpm lint`, `pnpm test`, `pnpm build`. Added in M1.

## ADR-012 Secrets (5 Oct 2026)

Decision: deployer key and keeper key only in environment variables (`.env`, ignored). `.env.example` lists names with empty values. Deployment uses `forge script` with `--private-key` from the environment or a Foundry keystore, never a key in a file in the repo.

## ADR-013 License, visibility, disclosures (5 Oct 2026)

Decision: MIT from the first commit (OSI-approved, required by Metropolis). The repo is private at creation and must be flipped to public before submission; commit history is unaffected by the flip. All code in this repo is written for this hackathon; OpenZeppelin, Aave interfaces and the Pyth SDK are dependencies, not pre-existing project code. AI tools: Claude (Anthropic) via Claude Code and Cowork, named in the README and the submission.

## ADR-014 Out of scope (5 Oct 2026)

Execution Events SDK (mentioned as the path to sub-block latency, not used); Chainlink CRE bounty; EIP-7702 delegated accounts; LP governance over holding versus unwinding seized collateral (hackathon build unwinds immediately).

## Verified facts

Append one line per fact, with the date checked and the source. Agents append here as M0 items are resolved.

- 5 Oct 2026: Monad mainnet chain id 143, token MON, RPCs and explorers as in ADR-007. Source: docs.monad.xyz/developer-essentials/network-information.
- 5 Oct 2026: Monad testnet chain id 10143. Source: docs.envio.dev/docs/HyperIndex/supported-networks.
- 5 Oct 2026: Envio HyperSync supports Monad 143 and 10143. Source: same page.
- 5 Oct 2026: Pyth live on Monad mainnet and testnet; testnet price feeds contract and MON/USD feed id as in ADR-006. Source: docs.monad.xyz/tooling-and-infra/oracles.
- 4 Oct 2026: Aave V3 on Monad launched July 2026 with Chainlink SVR via Atlas from day one. Source: monad.xyz/blog/aave-third-largest-fee-generator.
- 4 Oct 2026: MIP-12 300 ms blocks; MIP-8 page-ified storage live since 2 Sep 2026. Source: mips.monad.xyz.
- 4 Oct 2026: Metropolis submission closes 13 Oct 2026 11:59pm ET; judging five criteria at 20% each; OSI license and public repo required; AI tools must be disclosed. Source: hackathon.monad.xyz rules (gated) as quoted in an entrant's README.
