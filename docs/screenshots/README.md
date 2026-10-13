# Design review log

Screens captured by `web/e2e/review.spec.ts` against the local fork stack (`scripts/stack.sh up`), at 375, 768 and 1440 px. Passes 1 and 2 (version 1) are dark-first; pass 3 (version 2) is light-first with dark for the key screens. File names: `<state>-<width>-<theme>.webp`. The fork is a test environment (ADR-020); it shows "Local fork" in the header.

## Pass 1 (5 Oct 2026), `pass-1/`

Critique against docs/DESIGN.md and the reference products (docs/DESIGN-RESEARCH.md):

1. **Horizontal scroll on phones (blocker).** The 375 px captures came out 514 to 610 px wide: grid items default to `min-width: auto`, so the 480 px minimum width of the reserves and history tables (meant to scroll inside their panels) widened the whole page. Fix: `minmax(0, 1fr)` columns on both page grids and `min-w-0` on every column.
2. **Crowded header at 375 px.** The theme icon overlapped the "Liquidity" link and the account button pushed past the edge. Fix: the wordmark shows only its mark below 420 px, tighter nav padding, a shorter address on phones.
3. **Order on phones.** The cover panel (the one thing a borrower came to do) sat below three history tables, and the vault's deposit panel below its tables. Fix: the side panel now follows the position or vault readings in the DOM and spans both rows on the right at desktop width, still sticky.
4. **Sparkline spilling into the next column** when the per-block premium has many digits. Fix: the sparkline sits under the figure, capped at the column width.
5. **Amber used as decoration.** The landing's step numbers were amber, but amber means the trigger. Fix: neutral numbers. Same for "Not set" in watch mode.
6. **Comparison table on phones** lost its row labels when scrolled sideways. Fix: a sticky first column with its own background and edge.
7. **Wrong network emptied the page.** The borrower saw only "Switch to Monad". Fix: the page keeps showing the position (reads are pinned to Monad) and every action button becomes "Switch to Monad to …", in line with the Hyperliquid pattern in the research.
8. Kept as designed: HF in Aave's red band while the cover reads "Protected". The research recommends Aave's bands so a reading means the same as on app.aave.com; the trigger line on the rail shows where Shield acts.

## Pass 2 (5 Oct 2026), `pass-2/`

Recaptured from a fresh fork stack after the pass 1 fixes and a Lighthouse round. Critique:

1. **Still wider than 375 px on four states (blocker), found by checking every capture's width.** The cause this time: the "opens the explorer" `sr-only` spans inside each hash link are absolutely positioned and had no positioned ancestor, so they escaped their tables' scroll containers and stretched the document to 522 px. Fix: the hash link and every scroll container are now positioned. All 375 px captures in this folder are exactly 375 px wide.
2. **A dev server and the production server shared `.next`.** The wrong-network capture runs a second build; it now uses its own directory (`NEXT_DIST_DIR`).
3. **Table cells wrapped mid-value on phones** ("0x3c44… / 93bc", "17s / ago"). Fix: cells never wrap; tables scroll inside their panels instead. Checked in `vault-after-exit-375-dark-nowrap-fix.webp`.
4. Confirmed fixed from pass 1: phone order (position, then cover, then history; vault readings, then deposit), the header at 375 px, the sparkline, neutral step numbers, the sticky comparison column, wrong network now showing the position with "Switch to Monad to opt in".

Lighthouse after pass 2 (mobile emulation, production build): see docs/TEST-REPORT.md.

## Pass 3 (5 Oct 2026), `pass-3/`: version 2

The redesign is described in docs/DESIGN.md (version 2) and the research behind it in docs/DESIGN-RESEARCH.md (Part 2). Version 2 is light by default with Instrument Sans, a new mark, token logos, a hero product card, a savings calculator, a security section, FAQ and full footers. Captured from fresh fork stacks. The states are:

- landing
- borrow-disconnected
- borrow-watching
- borrow-setup
- borrow-setup-near-one
- borrow-tx-finalised
- borrow-protected
- borrow-exited
- vault-covered (one exit funded and a new cover active)
- vault-after-exit

Critique and fixes:

1. **The landing page scrolled sideways on phones (blocker).** The 375 px capture was 407 px wide. The soft glow behind the hero card extends past the viewport; found with a script that lists every element whose right edge passes 375 px outside a scroll container. Fix: the page clips horizontal overflow (`overflow-x: clip`, which keeps the sticky header working). All 375 px captures are now exactly 375 px wide.
2. **Sub-cent figures as headlines.**
   - The protected view led with "Cover this block $0.0000000095".
   - Fix: the cover rate per year leads, and the per-block figure is a small line under the sparkline. The setup panel does the same ("$1.00 a year", then "$0.0000000095 per block").
3. **The green "Protected" slab** read like antivirus scareware next to the name Shield (app research). Fix: a neutral header with a green shield icon; only warnings are tinted.
4. **"None" in table cells.** Fix: a dash with an accessible label.
5. **Nothing in the app to verify.** Fix: a "Sources and contracts" panel shows:
   - Aave's oracle price against Pyth, with the gap an exit allows.
   - Every contract that can act on the position, each with copy and an explorer link.
6. **Layout shift on the LP page.** Lighthouse CLS was 0.37: the header readings appeared only after loading. Fix: the same readings render with skeletons sized to the real text, and the overview skeleton mirrors the loaded panel. CLS is now 0.
7. **Slider without an accessible name** (Lighthouse accessibility 90 on the landing page). Radix puts `aria-label` on the root, not the thumb. Fix: the slider passes it to the thumb; the calculator's readings were also restructured into valid `dl` groups. Accessibility is now 100 on every route.
8. **Kept as designed:** HF in Aave's red band while the page reads "Protected at 1.04", so a reading means the same as on app.aave.com; the gauge shows where Shield acts.

**Found while capturing:** `scripts/stack.sh down` matched the keeper as `tsx ...` but it runs as node with tsx loader flags, so every earlier keeper survived. Several keepers then sent transactions to each new fork, which caused nonce errors and an intermittent failure of the review run's fork-only price move. The pattern now matches both command lines. The after-exit captures in this pass were taken after a hand-run price move with `cast` (fork only).

## Pass 4 (5 Oct 2026), `pass-4/`: after the internal audit

Captured from a fresh fork stack after the audit fixes ([AUDIT.md](../AUDIT.md), web section). New state: `borrow-arming`, the waiting period after opt-in (20 seconds on the fork deployment, 900 seconds on mainnet), with its countdown, the clock time it arms and the protection check. `vault-before-exit` replaces `vault-covered`. What changed on screen since pass 3:

- "Protected" appears only when every condition an exit needs holds; otherwise the header, gauge and panel say what is missing, for example "Cover arms in 0:18 (at 16:13)" or "Not armed: ...".
- A protection check lists each condition with its state.
- A prepaid balance card whenever prepaid USDC is left, including after an exit.
- The setup panel states the minimum prepay and the waiting period before the first approval.
- The vault overview shows exit gains still unlocking into the share price.

Critique and fixes:

1. **The borrower page painted late (Lighthouse performance 76, from 94).** An audit fix rendered a skeleton for every visitor until scripts ran, so a returning wallet would not flash "Connect wallet". The page now reads `?address=` and a data-free cookie on the server: a first visit gets the connect prompt in the HTML, a link with an address opens read only, and only a returning wallet sees the skeleton. Performance is 92 again, CLS 0.
2. **"Cover arms in 0:18, arms at 15:48"** in the header. Now "Cover arms in 0:18 (at 15:48)", the same as the gauge.
3. **Before opt-in the gauge called the slider's value "Trigger, not armed".** Nothing is armed or unarmed yet; it now says "Trigger, preview".
4. **Capture artifact.** Full-page shots taken after the test had scrolled drew the sticky header and side panel mid-page. The capture now scrolls to the top first. Not a page defect.
5. Checked: every 375 px capture is exactly 375 px wide.

## Pass 5 (5 Oct 2026), `pass-5/`: analytics and the protocol share

Captured from a fresh fork stack after the protocol share (ADR-037) and the analytics work (ADR-038). New: `analytics` (the public Analytics page after the exit, light and dark), and on the borrower page the price simulator, the chance of touching the exit price and the health-factor history; on the vault page the income panel; on the landing page the lenders strip and the earnings answers in the FAQ. The header now has three links.

Critique and fixes:

1. **The video-script test set the wrong slider.** It took the first slider on the page, which is now the price simulator, so the trigger stayed at 1.04. Both specs now find the trigger slider by its name, "Trigger health factor".
2. **Lighthouse performance on the app pages fell under 90 in the default simulated mode.** RainbowKit's MetaMask entry loaded the MetaMask SDK (about 450 KB) on every page; MetaMask now connects through its extension with the same name and icon, and blocking time fell by about two thirds. The simulated score still varies (84 to 90) on a machine that was running other work; with devtools throttling every page scores 99, and in a browser at 4x CPU slowdown the largest paint lands within 0.1 s.
3. Checked: every 375 px capture is exactly 375 px wide.

## Pass 6 (13 Oct 2026), `pass-6/`: version 3, the cartoon redesign

Captured from a fresh fork stack after the version 3 rebuild (DESIGN.md, Version 3): landing, every borrower state the flow reaches (disconnected, watching, setup, a line close to Aave, arming, Shield is on, stepped in), the vault before and after the exit, and Stats. One light theme, so no dark captures.

Critique and fixes:

1. **The Stats page was 11 px wider than a 375 px phone**: the "Shield reads every protected loan in every block" pill did not wrap. It wraps now; every 375 px capture is exactly 375 px wide.
2. **The review test looked for "Monad block" in the header**, which reads "Local fork, block" on a fork; it now matches either.
3. Kept as designed: the borrower's health factor sits in "Stats for nerds"; the page leads with the price sentence ("ETH can fall 6.5% before Aave liquidates you").

