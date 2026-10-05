# Shield web design

How the Shield web app looks and behaves, and why. Research behind it: [DESIGN-RESEARCH.md](DESIGN-RESEARCH.md) (Aave, Morpho, Euler, Summer.fi, DeFi Saver and Hyperliquid, studied 5 Oct 2026). Screenshots from each review pass: [screenshots/](screenshots/).

## Who it is for and what it must do

- **Borrowers** on Aave V3 Monad with WETH or cbBTC collateral and USDC debt. They need to see in one glance how close they are to liquidation, put an early exit above it, and know what that exit and its cover cost.
- **LPs** who fund exits. They need the vault's value broken into its parts, where the yield comes from, and what they can withdraw now.
- **Judges.** They need to see real Monad state move block by block without a wallet: the landing page reads mainnet live, and any position can be viewed read-only.

## Principles

1. **One instrument, everywhere.** The health-factor rail is the product: Aave's liquidation line at 1.00, the borrower's trigger above it (the amber tripwire), where an exit restores HF to, and the live HF marker. It appears on the landing page, the borrower page, and in the wordmark.
2. **Colour means something or it is not used.** Teal, amber and red are the health bands. Amber is also the trigger. Monad violet appears only where Monad is named. Buttons and surfaces are neutral.
3. **The danger zone is loud.** Shield lives between HF 1.0 and 1.1, so the rail is zoomed to that range (0.95 up) and HF uses Aave's own bands: red below 1.1 is the normal state of a protected position, not an alarm about Shield. (Research: avoid a calm UI near liquidation, avoid a danger zone that is a sliver of the scale.)
4. **Every number is live and honest.** Readings refresh every proposed block (about 300 ms). Estimates say "est." and explain their assumptions in a tooltip. Fork rehearsals say "Local fork" in amber in the header.
5. **Every state teaches the next action.** Empty, error and blocked states say what happened and what to do, in the interface's voice, without apologising.

## Tokens

### Colour

| Token | Dark (default) | Light | Use |
| --- | --- | --- | --- |
| background | #0e1424 | #f4f6fa | Page ground: a deep instrument navy, not neutral near-black |
| card | #141b2e | #ffffff | Panels |
| raised | #1a2339 | #eef1f7 | Panels inside panels (the "At the trigger" box) |
| foreground | #e7ebf3 | #0e1424 | Text, primary buttons (inverted) |
| muted-foreground | #97a1b9 | #4f5a73 | Labels and secondary text (AA on card in both themes) |
| border | #27314b | #d6dce8 | Rules and panel edges |
| safe | #3dd9a8 | #087a57 | HF of 3 and above, success, savings |
| caution | #ffb224 | #9a5b00 | HF 1.1 to below 3, the trigger, warnings |
| danger | #ff6b6b | #c62f2f | HF below 1.1, the liquidation line, errors, penalties |
| monad | #a597ff | #5442d6 | The word Monad only |
| *-soft | 12% (dark) or 9 to 10% (light) of the colour | | Zone fills on the rail, status banners |

Text pairs meet WCAG AA (computed 5 Oct 2026): muted-foreground on card 6.6:1 dark and 6.9:1 light, on raised 6.0:1 and 6.1:1; caution text 9.5:1 dark and 5.4:1 light (the light theme uses #9a5b00 because the dark-mode amber fails on white); safe 9.5:1 and 5.3:1; danger 6.2:1 and 5.5:1; foreground on card 14.3:1.

### Type

One family, Archivo (variable, Google Fonts), used at two widths: normal (100%) for reading text and expanded (112.5% to 125%) for headings and numeric readings, with tabular figures (`.num`, `.reading`). No monospace: figures align through `tnum`.

| Role | Size / line height | Width, weight |
| --- | --- | --- |
| Landing headline | 56 px (40 px mobile) / 1.15 | 125%, 600 |
| Page title | 28 px / 1.15 | 112.5%, 600 |
| Section title | 16 to 18 px | 112.5%, 600 |
| Big reading (HF, vault value) | 36 px / 1 | 112.5%, 600, tabular |
| Reading | 20 px | 112.5%, 600, tabular |
| Body | 15 px / 1.55 | 100%, 400 |
| Label, hint | 13 px | 100%, 400 |
| Rail labels | 12 px | 100%, 500, tabular |

Sentence case everywhere. No all-caps labels, no eyebrows above headings, no arrows in button text, no middle-dot meta strings.

### Spacing and shape

A 4 px grid: 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64. Panels use 20 px (mobile) or 28 px padding. Radii follow hierarchy: 14 px panels, 10 px inner boxes, 6 px controls, full circles for the HF marker and step numbers. No drop shadows; panels separate by surface tone and a 1 px border. Touch targets are at least 40 px.

### Motion

One moving thing: the HF marker slides to its new position each block (300 ms, linear), so the rail visibly tracks the chain. Spinners only for in-flight transactions. `prefers-reduced-motion` turns all of it off.

## Components

| Component | File | Notes |
| --- | --- | --- |
| Risk rail | `components/risk/risk-rail.tsx` | SVG track 0.95 to max(1.3, marks + 0.08); zones, ticks, liquidation, trigger, exit target, trail of the last 30 readings; HTML marker; labels align inward at the edges; exit label hidden below 640 px |
| Stat | `components/data/stat.tsx` | Label, reading, hint; optional tone |
| Sparkline | `components/data/sparkline.tsx` | Recent per-block premiums; decorative, the number carries the meaning |
| Hash link | `components/data/hash-link.tsx` | `0x1234…abcd`, copy button, explorer link (MonadVision), full value on hover |
| Info | `components/data/info.tsx` | Focusable tooltip that explains a derived number |
| Transaction status | `components/tx/tx-status.tsx` | Confirm in wallet, sending, included in block N, finalised, or the error with its fix |
| Header | `components/shell/app-header.tsx` | Wordmark, nav, live block pill (amber "Local fork" on a fork), theme toggle, connect |
| Network guard | `components/shell/network-guard.tsx` | Banner plus "Switch to Monad to …" primary buttons |
| Cover setup | `components/borrow/cover-panel.tsx` | Trigger slider with derived price, discount ceiling, prepay with runway, "At the trigger" box, near-1.00 acknowledgement, four numbered steps |
| Cover manage | same | Status banner, trigger and ceiling, tabs: top up, withdraw, trigger, opt out |
| Position panel | `components/borrow/position-panel.tsx` | HF, collateral, debt, threshold; rail; comparison line; premium ticker; prepaid and runway |
| Vault view | `components/vault/vault-view.tsx` | NAV with components, premium rate (variable), earned, exits, average discount, share price; deposit and withdraw; exits, covers and activity tables |
| Live demo | `components/landing/live-demo.tsx` | Landing instrument: mainnet block and Pyth ETH price, no wallet libraries |

shadcn/ui (Radix base) supplies Button, Slider, Tabs, Tooltip, Input, Label, Skeleton and Badge, re-skinned through the tokens above.

## Formatting rules

- USD: two decimals; compact from $100,000 ($1.2M); below one cent, two significant digits in fixed notation ($0.0000014). Per-block premiums are tiny by design and are never rounded to $0.00.
- Tokens: up to four decimals, grouped thousands, symbol after.
- HF: rounded down (as Aave does) to three decimals so per-block moves show; "No debt" when there is none.
- Percentages: two decimals by default; discounts in whole percents.
- Hashes and addresses: first six and last four characters, copy, explorer link.
- Times: relative in tables ("12s ago"), absolute in sentences.

## Screens and states

### Landing `/`

Static except for the live demo, which reads Monad mainnet from the browser (no wallet code ships on this route). Sections: headline and two actions; live demo; how an exit works (three numbered steps, a real sequence); comparison with Morpho pre-liquidation, Euler V2 and DeFi Saver; why this needs Monad; what Shield does not do.

| State | Shows |
| --- | --- |
| Loading | Placeholder readings and "Connecting to Monad" |
| Live | Block number, Pyth ETH price, example HF, cover per block and per year, rail |
| RPC unreachable | "Monad RPC unreachable, retrying"; retries every 600 ms while visible, 3 s when hidden |

### Borrower `/app/borrow`

| State | Shows | Next action |
| --- | --- | --- |
| Not configured | "Shield is not configured" with the variables to set | Set the env |
| Disconnected | What Shield does; connect; "view an address" | Connect or view |
| Watching (`?address=`) | Full read-only page, banner "Viewing 0x…, read only" | Stop viewing or connect |
| Wrong network | Banner with switch; page asks to switch | Switch to Monad |
| Loading | Skeletons for readings, rail and side panel | Wait |
| RPC error | "Could not read Aave" with the RPC's message | Reload |
| No Aave position | "No Aave position on this wallet" | Open Aave on Monad |
| eMode | Why eMode is not covered (1% bonus) | Leave eMode on Aave |
| No WETH or cbBTC collateral | What Shield takes | Supply on Aave |
| No USDC debt | What Shield repays | Borrow USDC |
| Not covered | Rail with the chosen trigger (dashed, "not armed"), comparison line, setup panel | Approve, approve, prepay, opt in |
| Trigger at or above HF | Note: the exit would run at the next block | Raise HF or accept |
| Trigger at 1.02 or below | Acknowledgement checkbox required | Confirm |
| Pending transaction | Button reads "Check your wallet", status line below | Wait |
| Confirmed | "Included in block N, finalising", then "finalised" with the hash | Next step |
| Transaction error | The error in one sentence with its fix | Retry |
| Protected | Teal banner, premium ticker, prepaid runway | Manage |
| Unprotected, balance used up | Amber banner | Top up |
| Unprotected, approval revoked | Red banner with "Approve again" | Approve |
| Exit due | Amber banner: the keeper exits next block | Wait |
| Waiting for a Pyth price | Amber banner | Wait |
| Exited | "Exited … penalty avoided $X", exit row with hash, setup panel to protect again | Protect again |
| Indexer missing or failing | History panels say which variable or what failed | Configure |

### LP `/app/vault`

| State | Shows | Next action |
| --- | --- | --- |
| Disconnected | All vault readings and tables; side panel asks to connect | Connect |
| Loading | Skeleton readings | Wait |
| Live | Vault value with components, premium rate (variable), premium earned, exits, average discount, share price | Deposit |
| No exits or covers yet | Each table says what will appear and when | |
| Deposit over balance | Red hint with the wallet balance | Lower the amount |
| Withdraw over the liquid amount | Explanation that seized collateral must be sold first | Lower the amount |
| Wrong network, pending, confirmed, error | As on the borrower page | |

## Flows

### Borrower

1. Open `/app/borrow` and connect (or view an address read-only).
2. Read the position: HF (Aave bands), collateral, debt, threshold, the rail and "Aave penalty if liquidated: $X. Shield: $Y."
3. Choose a trigger with the slider. The rail moves the dashed tripwire; the text gives the collateral price that reaches it at today's debt and the HF an exit restores. At 1.02 or below an acknowledgement appears; at or above the current HF a note says the exit would run at once.
4. Choose the most discount you accept (1% default).
5. Set the prepay; the hint gives the per-block and yearly premium and how long it lasts.
6. Check "At the trigger": debt repaid, collateral taken, your cost, Aave's penalty.
7. Step 1, approve the aToken for the Executor (max). Step 2, approve USDC for the prepay. Step 3, prepay. Step 4, opt in. Each step shows wallet, sending, included in block N, finalised.
8. The panel turns into the teal "Protected" banner; the rail's tripwire turns solid amber; the premium ticks every block.
9. Manage: top up, withdraw unused, move the trigger, opt out.
10. If HF reaches the trigger, the banner reads "Exit due", the keeper exits next block, and the page shows "Exited, penalty avoided $X" with the transaction.

### LP

1. Open `/app/vault`; read the vault value and its parts, the premium rate and the exits table without connecting.
2. Connect; deposit: approve USDC, then deposit, each with transaction status.
3. Watch premium earned and the vault value move every block.
4. Withdraw up to the liquid amount; the panel explains why collateral taken at exits is not instantly withdrawable.

## Accessibility

Keyboard: every control is a native button, link or input, with a visible 2 px focus ring; a skip link leads to the content; tabs and slider come from Radix. The rail is an image with a full text label (HF, trigger, liquidation line, exit target). Live readings are `aria-live="off"` so screen readers are not flooded every 300 ms; transaction status is `aria-live="polite"`; errors use `role="alert"`. Contrast meets AA in both themes. Layouts work from 375 px with no horizontal page scroll; wide tables scroll inside their own panel.

## Review log

Pass 1 and pass 2 critiques, fixes and screenshots are listed in [screenshots/README.md](screenshots/README.md).
