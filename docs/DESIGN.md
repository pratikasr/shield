# Shield web design

How the Shield web app looks and behaves, and why. Research behind it: [DESIGN-RESEARCH.md](DESIGN-RESEARCH.md). Part 1 covers position, risk and automation screens in Aave, Morpho, Euler, Summer.fi, DeFi Saver and Hyperliquid. Part 2 covers what makes a financial product look legitimate or like a scam, across 26 DeFi and fintech sites. Screenshots from each review pass are in [screenshots/](screenshots/).

## Version 2 (5 Oct 2026): why the design changed

The owner reviewed the first version and said it read as "a little sus". The legitimacy research in Part 2 agreed and found specific causes:

- **Anonymous and unverifiable.** The site had no footer, no disclosures, no security section, no docs links and no contract links.
- **A crypto-styled palette.** Navy with neon status colours.
- **A loud headline face.** An expanded, heavy typeface.
- **An unreadable mark.** A 16 px traffic-light glyph as the logo.
- **Tiny prices in display type.** Sub-cent dollar figures shown large, such as "$0.0000013" per block.
- **No token or network logos.**
- **Every section the same boxed card.**

Version 2 keeps every function and the health-factor instrument, and changes how they present:

| Before | After | Why (reference) |
| --- | --- | --- |
| Navy dark by default | Light by default (#f6f7f9 page, white panels, #0b1220 ink), with a neutral graphite dark theme | Stripe, Coinbase, Aave, Lido and Monad all lead with light; dark plus a sparse page reads as a token site |
| Archivo at 125% width, semibold headlines | Instrument Sans, weight 500, tracking -0.03 em, tabular figures | No reference site uses an expanded H1; weight 300 to 550 is the norm |
| Traffic-light glyph | A shield cut by one line (the trigger), ink above, brand blue below, 22 px; matching app icon | Marks are 24 to 36 px and read as a brand, not a widget |
| No token icons | Token and network logos everywhere a token is named (USDC, ETH, cbBTC, MON, AAVE, Pyth) | Aave, Morpho, Euler, Spark |
| Wallet as a hex string | Address with a gradient avatar | Every reference app |
| Per-block price as the headline | Rate per year leads; per-block figure in small type | Lido "APR*", Aave "APY"; Sky's "$0.0958" is the anti-pattern |
| Two-line comparison sentence | The sentence plus proportional bars and "You keep $X" | Aave's $10,000 growth chart, Liquity's rate table |
| No disclosures | A hero disclosure line, an unaudited and not-affiliated disclaimer in both footers, "Is Shield audited?" first in the FAQ | Mercury's hero strip, Robinhood, Aave's "Does Aave have risks?" |
| Five sections | 11 sections: hero with a live product card, proof strip, savings calculator, how it works, the exit as a transaction trace, why Monad, comparison, "Built to be checked", FAQ, call to action, full footer | Scam sites have "simpler web structures" (HICSS 2026); references run 7 to 15 sections |
| Monad jargon (MIP-8, eth_sendRawTransactionSync) | Plain numbers ("63% less gas per reprice"), with links to the technical write-up | The CFTC lists jargon as a fraud flag; Monad's own tiles are plain |

## Who it is for and what it must do

- **Borrowers** on Aave V3 Monad with WETH or cbBTC collateral and USDC debt.
  - See in one glance how close they are to liquidation.
  - Put an early exit above it.
  - Know what the exit and its cover cost.
- **LPs** who fund exits.
  - See the vault's value broken into its parts.
  - See where the yield comes from.
  - See what they can withdraw now.
- **Judges.**
  - See real Monad state move block by block without a wallet: the landing page reads mainnet live, and any position can be viewed read-only.
  - Find every claim's evidence one click away.

## Principles

1. **One instrument, everywhere.** The health-factor gauge is the product, and it appears on the landing page's product card and on the borrower page. It shows:
   - Aave's liquidation line at 1.00.
   - The borrower's trigger above it.
   - Where an exit restores the health factor to.
   - The live reading, which moves every block.
2. **Quiet surfaces, colour that means something.**
   - Surfaces and buttons are neutral, and primary actions are ink black.
   - Brand blue is used only for links, focus rings and the lower half of the mark.
   - Green means protected or saved, amber is the trigger, and red is Aave's liquidation line and penalty.
   - Monad violet appears only on the Monad logo.
3. **Evidence over adjectives.**
   - Every number on the landing page links to where it comes from: the test report, the gas figures, the calculator's assumptions.
   - Contract addresses appear in the footer as soon as a deployment exists.
   - The product card reads live mainnet prices and says so.
4. **Say the risk first.**
   - The hero names the hackathon and says the contracts are not audited.
   - The FAQ answers "Is Shield audited?" and "What can the owner change?" before anything else.
   - The footer says Shield is not affiliated with Aave, Pyth or Monad.
5. **Every state teaches the next action.** Empty, error and blocked states say what happened and what to do, without apologising.

## Tokens

### Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| background | #f6f7f9 | #0b0d12 | Page |
| card | #ffffff | #12151b | Panels |
| raised / muted | #f2f4f7 | #181c24 | Insets, tracks, skeletons |
| foreground | #0b1220 | #f2f4f7 | Text, primary buttons |
| muted-foreground | #586378 | #9aa3b2 | Labels, secondary text (AA on both surfaces) |
| border | #e3e6eb | #242a34 | Hairlines |
| brand | #2347e8 | #7b93ff | Links, focus, mark, sparkline, vault USDC share |
| safe | #067647 | #47cd89 | Protected, saved, exit target |
| caution | #b54708 | #fdb022 | Trigger, unprotected |
| danger | #c4320a | #f97066 | Liquidation line, Aave penalty, HF below 1.1 |
| monad | #6e54ff | #9d8cff | Monad mentions only |

- Health-factor colours follow Aave's own bands (red below 1.1, amber below 3, green above), so a reading means the same here as on app.aave.com.
- The "Why Monad" band and the call to action use a fixed ink (#0b1220) panel in light mode, and the card colour in dark mode.

### Type

Instrument Sans (Google Fonts, variable), chosen for its crisp grotesk shapes and true tabular figures. Schibsted Grotesk and Public Sans were compared and rejected because their tabular figures space out awkwardly.

| Role | Size and weight |
| --- | --- |
| Landing H1 | 44 px on phones, 68 px on desktop; weight 500; tracking -0.03 em; line height 1.02 |
| Section heading | 32 to 44 px; weight 500; tracking -0.03 em |
| App page title | 32 px, weight 600 |
| Big reading (HF, vault value) | 28 to 40 px, weight 600, tabular |
| Panel title | 16 px, weight 600 |
| Body | 15 px app, 18 to 20 px landing lede |
| Label | 13 px, muted |
| Table header | 12 px, medium, muted |

Every number uses tabular figures (`.num`, `.reading`).

### Shape, depth, spacing

- **Radius:** panels 14 px; inputs and buttons 8 px; chips and avatars fully round.
- **Depth:** panels have a hairline border and a 1 to 3 px shadow in light mode; the hero product card has one deeper float shadow; dark mode uses borders only.
- **Spacing:** 4 px base. Panels pad 20 to 24 px, app sections sit 24 px apart, and landing sections 96 to 128 px apart. Containers max out at 1,216 px.

### Motion

- The HF marker and its label slide to each new reading in 300 ms. The network dot pings while blocks arrive.
- Nothing else moves on its own.
- `prefers-reduced-motion` stops all of it.

## Components

| Component | Notes |
| --- | --- |
| Mark and wordmark | `ShieldMark`, `Wordmark`; `app/icon.svg` is the same mark on an ink tile |
| App header | Sticky and blurred: mark, "Protect", "Vault" and "Analytics" with an underline on the current page, Monad network chip (logo, live dot, block), theme toggle, wallet button (avatar and address, or "Connect wallet"). Below 640 px the three links sit in their own row under the bar; between 768 and 1024 px the mark shows without the word so the chip fits |
| Footers | Site: four columns (product; transparency, with contract addresses once deployed; built on), a disclaimer and the licence. App: the disclaimer and links to Security, Tests and GitHub |
| Panel | The one surface style: hairline border, 14 px radius, optional title row. Panels never nest |
| Stat | Label above a tabular value with an optional hint; `dt`/`dd` |
| TokenIcon, TokenPair, TokenAmount | Logos from `public/tokens/` (Aave's own SVGs); a lettered fallback for unknown symbols |
| Gauge (`RiskRail`) | Track from 0.95 up: red to 1.00, then amber to the trigger (hatched when not armed), then green to the exit target. Tick scale; floating "HF x.xxx" label over the knob; a legend instead of crowded inline labels; text label for screen readers |
| Cost comparison | "Aave penalty if liquidated: $X. Shield: $Y." with bars to scale and "You keep $Z" |
| Chip | Presets (triggers, prepay durations, loan sizes); pressed state is ink |
| Amount input | Token icon inside, Max button, balance above, outcome below ("You receive N shUSDC", "Lasts about N days") |
| Steps | Vertical stepper with a connector; done steps turn green; one primary button acts on the current step |
| Transaction status | Wallet, sending, "included in block N, finalising", "finalised in block N" with the hash; errors in one sentence |
| Tabs | Activity panels (Exits and Repricing; Exits, Covered positions and Vault flows) |
| Hash link | Truncated hash, copy button, explorer link |

## Formatting rules

- **USD:**
  - Two decimals; compact from $100,000 ($1.2M).
  - Below one cent, two significant digits in fixed notation.
  - Sub-cent figures appear only as small secondary text or in live meters, never as a headline.
  - Premiums lead with a rate per year.
- **Tokens:** up to four decimals, grouped thousands, symbol after, with the token's icon.
- **HF:** rounded down (as Aave does) to three decimals so per-block moves show; "No debt" when there is none.
- **Percentages:** two decimals by default; discounts in whole percents.
- **Hashes and addresses:** first six and last four characters, with copy and an explorer link.
- **Times:** relative in tables ("12s ago"), absolute in sentences.

## Screens and states

### Landing `/`

Server-rendered except for two client islands: the hero product card, which reads Monad mainnet from the browser, and the savings calculator. No wallet code ships on this route.

Sections, in order:

1. Header.
2. Hero, containing:
   - The headline.
   - A one-sentence lede.
   - "Protect a position" and "Earn as a liquidity provider".
   - A trust row (built on Aave V3 and Pyth, repriced every 300 ms, open source).
   - The disclosure line.
   - The live product card.
3. Proof strip (1% vs 5.5%, 300 ms, 63% less gas, 101 tests), each figure linked to its evidence.
4. "What an early exit saves" calculator.
5. "How an exit works": three steps, then "Inside one exit transaction" as five steps.
6. "Why this needs Monad".
7. Comparison with Morpho pre-liquidation, Euler V2 and DeFi Saver.
8. "Built to be checked": six facts, including "Not audited yet".
9. FAQ.
10. Call to action.
11. Footer.

| State | Shows |
| --- | --- |
| Loading | Placeholder readings and "Connecting to Monad" |
| Live | Block number, Pyth ETH price, example HF, gauge, cover per year, the liquidation and exit costs |
| RPC unreachable | "Monad RPC unreachable, retrying"; retries every 600 ms while the page is visible, every 3 s when hidden |

### Borrower `/app/borrow`

Layout:

- **Header band:** market chip (Aave and Monad icons), page title, cover status (Not protected, Protected at x.xx, Unprotected, or Exited), and net worth, collateral, debt and health factor on the right.
- **Left column:**
  - "Liquidation risk": the gauge; collateral price now, liquidation price and exit price; the estimated chance the collateral touches the exit price within 24 hours and 7 days (zero-drift lognormal at the cover's volatility, with its assumptions in an info note); the cost comparison; while protected, the cover rate, prepaid balance and premium paid; and "If WETH moves", a -30% to +30% simulator showing the health factor at that price, whether the exit would run or Aave could liquidate, and the cost of each.
  - "From another chain" (ADR-039), in the Top up tab, the prepaid card and the prepay step: the borrower's deposit address on Monad with copy, the USDC waiting there and "Move into premium", then Aurora Intents: source chain and stablecoin, amount, Aurora's deposit address and the exact amount to send, and a five-step status strip (waiting for deposit, deposit seen, sending to Monad, delivered on Monad, in your premium). Refunded, failed, short and expired states each say what happened and what to do. Loaded only when opened.
  - "Health factor history": a line chart of the health factor from the indexer's reprices, with the trigger, Aave's 1.00 line and exit markers, and premium paid below it; ranges This cover, Last hour, 24 hours and All; hover and keyboard readout and a table alternative. Loaded after the page is interactive.
  - "Activity": Exits and Repricing tabs.
  - "Your assets on Aave".
  - "Sources and contracts": Aave's oracle price against Pyth, with the gap an exit allows (2%), and every contract that can act on the position, each linked to the explorer.
- **Right column (sticky):** the cover panel.
- **On phones**, the cover panel follows the risk panel.

| State | Shows | Next action |
| --- | --- | --- |
| Not configured | "Shield is not configured" with the variables to set | Set the env |
| Disconnected | Wallet icon, what Shield does, "Connect wallet", "view any address read only" | Connect or view |
| Watching (`?address=`) | Full read-only page, banner "Viewing 0x…, read only" | Stop viewing or connect |
| Wrong network | Banner with switch; actions ask to switch | Switch to Monad |
| Loading | Skeletons that match the final layout | Wait |
| RPC error | "Could not read Aave" with the RPC's message | Reload |
| No Aave position | Aave and Monad icons, "No Aave position on this wallet" | Open Aave on Monad |
| eMode | Why eMode is not covered (1% bonus) | Leave eMode on Aave |
| No WETH or cbBTC collateral | What Shield takes | Supply on Aave |
| No USDC debt | What Shield repays | Borrow USDC |
| Not covered | Gauge with the chosen trigger (hatched, "not armed"), exit price, comparison, setup panel | Approve, approve, prepay, opt in |
| Trigger at or above HF | Amber note: the exit would run at the next block | Raise HF or accept |
| Trigger at 1.02 or below | Acknowledgement checkbox required | Confirm |
| Pending transaction | Button reads "Check your wallet", status line below | Wait |
| Confirmed | "Included in block N, finalising", then "finalised" with the hash | Next step |
| Transaction error | The error in one sentence with its fix | Retry |
| Protected | Neutral header with a green shield icon, "Protected"; trigger, max discount and collateral; cover rate per year with sparkline; prepaid runway; management tabs | Manage |
| Unprotected, balance used up | Amber header | Top up |
| Unprotected, approval revoked | Red header with "Approve again" | Approve |
| Exit due | Amber header: the keeper exits next block | Wait |
| Waiting for a Pyth price | Amber header | Wait |
| Exited | Green banner "Exited in block N: penalty avoided $X" with the hash; "Exit completed" card (penalty avoided, debt repaid, HF before and after) above the form to protect again | Protect again |
| Indexer missing or failing | Activity says which variable or what failed | Configure |

### Vault `/app/vault`

Layout:

- **Header band:** "Shield vault, USDC" chip, title "The vault that funds exits", a one-line explanation that it is funded by the protocol, and vault value, premium rate now and share price on the right.
- **Left column:**
  - "Vault overview": a composition bar (USDC, collateral from exits, premium to sweep), then premium earned, exits executed and average discount captured.
  - "Income since launch": all of Shield's income goes to the protocol (10% of premiums to the treasury directly, the rest and the exit discounts through the vault the treasury owns), the two risk lines (exit income depends on volatility and timing; the vault carries seized collateral until the unwind, and a flash-assisted exit pays a flash-loan fee), and outside liquidity providers as a labelled roadmap line.
  - "Activity": Exits, Covered positions and Vault flows tabs.
- **Right column (sticky):** for an allowlisted account (the treasury at launch), deposit and withdraw, with "Fund from another chain" (the treasury's deposit address and a sweep button); for anyone else, why deposits are closed, and withdraw for anyone holding shares (ADR-039).

| State | Shows | Next action |
| --- | --- | --- |
| Disconnected | All vault readings and tables; the side panel asks to connect | Connect |
| Loading | Skeleton bar and readings | Wait |
| Live | Readings above, refreshed every block | Deposit |
| No exits or covers yet | Each tab says what will appear and when | |
| Deposit over balance | Red hint with the wallet balance | Lower the amount |
| Withdraw over the liquid amount | "Available now" and why seized collateral must be sold first | Lower the amount |
| Wrong network, pending, confirmed, error | As on the borrower page | |

### Analytics `/app/analytics`

Public, no wallet needed. Earnings come from the Envio indexer; live figures from Monad on the proposed block (ADR-038).

- **Header band:** title, one line on what the page shows and where the numbers come from, the period selector (24 hours, 7 days, 30 days, All time; times in UTC) and "Indexed to block N".
- **Key figures:** protocol earnings (with the live share, "10% of premiums"), liquidity providers' earnings (premiums plus gross exit discounts), penalty avoided for borrowers, exits, debt protected now and active covers. Sub-cent figures read "<$0.01" with the exact amount in the hint.
- **Earnings over time:** a stacked bar chart in neutral greys ordered by lightness (premiums to liquidity providers, premiums to the protocol, exit discounts), hourly for 24 hours and 7 days and daily otherwise, with a hover and keyboard readout and "Show as table". Beside it, the earnings breakdown for the period and all time, including the protocol share paid to the treasury and the share waiting for the next sweep.
- **Live on Monad:** the last ten blocks from `monadNewHeads`, each moving through Proposed, Voted, Finalized and Verified, with Shield's reprices marked; average block time, reprices seen and the protocol share earned while the page is open. On a local fork it polls, labels blocks "Mined" and says commit states are Monad-only.
- **Keeper and cost:** reprices, gas and MON per reprice from the latest receipts, and how close to the trigger each exit ran.
- **Tables:** covered positions and exits, scrolling inside their panels on phones.
- **Worked example:** the one liquidation in Aave Monad's history, what the borrower paid above the debt and what a Shield exit would have cost, with the transaction and the sources.
- **Lenders on Monad:** Aave V3 live; Euler V2, Morpho Blue, Curvance and Neverland coming soon, each with its Monad TVL from DefiLlama and the date. Names and initials only, no third-party logos.

| State | Shows |
| --- | --- |
| Loading | Skeletons sized like the loaded figures and chart |
| Indexer down or stale | The live figures still show; each indexer section says history is unavailable and why |
| No data in the period | The chart says what will appear and when |
| Socket closed | "Reconnecting in N s", retries back off from 1 s to 15 s |

## Flows

### Borrower

1. Open `/app/borrow` and connect, or view an address read-only.
2. Read the position: the header band, the gauge, the liquidation price, and "Aave penalty if liquidated: $X. Shield: $Y."
3. Choose a trigger with the slider or a preset chip.
   - The gauge moves the hatched trigger.
   - The panel gives the collateral price at which the exit runs, how far below today that is, and the HF an exit restores.
   - At 1.02 or below an acknowledgement appears.
   - At or above the current HF, a note says the exit would run at once.
4. Read the cover cost per year, with the per-block rate below it.
5. Set the prepay by typing an amount, pressing Max, or choosing 30 days, 90 days or 1 year. The hint says how long it lasts.
6. Optionally open Advanced and set the most discount you accept (1% by default).
7. Run the four steps, each with wallet, sending, included in block N and finalised:
   1. Approve the aToken for the Executor.
   2. Approve USDC.
   3. Prepay.
   4. Opt in.
8. The panel shows the "Protected" header, the gauge's trigger turns solid amber, and the cover rate and premium tick every block.
9. Manage the cover: top up, withdraw unused, move the trigger, or opt out.
10. If the HF reaches the trigger:
    - The header reads "Exit due".
    - The keeper exits.
    - The page shows the green exit banner and the "Exit completed" card with the transaction.

### LP

1. Open `/app/vault`. Read the vault value, its composition and the activity tabs without connecting.
2. Connect and deposit: approve USDC, then deposit, each with its transaction status. "You receive" previews the shUSDC.
3. Watch premium earned and the vault value move every block.
4. Withdraw up to "Available now"; the panel explains why collateral taken at exits is not instantly withdrawable.

## Accessibility

- **Keyboard:**
  - Every control is a native button, link, input or `details`.
  - Every control has a visible 2 px focus ring in brand blue.
  - A skip link leads to the content.
  - Tabs and sliders come from Radix.
- **The gauge** is an image with a full text label (HF, trigger, liquidation line, exit target).
- **Live regions:**
  - Live readings are `aria-live="off"`, so screen readers are not flooded every 300 ms.
  - Transaction status is `aria-live="polite"`.
  - Errors use `role="alert"`.
- **Contrast** meets AA in both themes.
- **Layout:**
  - Works from 375 px with no horizontal page scroll.
  - Wide tables scroll inside their own panel.
  - The comparison table keeps its first column fixed.

## Review log

Pass 1 and pass 2 (version 1) and pass 3 (version 2) critiques, fixes and screenshots are listed in [screenshots/README.md](screenshots/README.md).
