# Design review log

Screens captured by `web/e2e/review.spec.ts` against the local fork stack (`scripts/stack.sh up`), at 375, 768 and 1440 px, dark, with light for the key screens. File names: `<state>-<width>-<theme>.webp`. The fork is a test environment (ADR-020); it shows "Local fork" in the header.

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
