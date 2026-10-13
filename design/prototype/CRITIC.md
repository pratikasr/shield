# Critic review: Shield prototype v4 ("Sticker arcade")

Reviewed 13 Oct 2026 against the brief, DESIGN-RESEARCH.md Part 3, design/prototype/README.md, the contracts and the keeper. I drove the prototype at http://127.0.0.1:4400/ with Playwright at 390 and 1440, normal and reduced motion. My captures are in `scratchpad/critic-shots/`.

## Verdict

**Ship to build with fixes.** The level metaphor, mascot moods, preset cards and copy voice work, and no new design round is needed.

The must-fix items below are flow, honesty and mobile-order fixes. Build them into the real app from the first commit, not after it.

What already passes, measured:

- No sideways scroll on any route at 390.
- Every text element passes AA. The lowest ratio found was 13.7:1, under 0.85 opacity.
- Reduced motion leaves 0 running animations on the landing, stepped-in, stats, arming and low-fuel screens.
- Desktop passes the 3-second test on Not protected, Protected, Out of fuel and Stepped in.
- The sample numbers reconcile with the contracts:
  - $2,539 Aave line, 6.5% down.
  - Presets $2,691, $2,640 and $2,589.
  - Costs scale as 1/distance.
  - $26.00 repaid, $26.26 taken, $27.43 for Aave, $1.17 kept.
  - 84% threshold.
  - 15-minute wait (`minCoverSeconds = 900`).
  - Re-arm after a refill (`creditPrepaid` restarts cover).
- The sky base is the right call: it carries "lava is down there" without a label. Keep it.

## Must fix

1. **Protect > Protected > "Turn off" leads to the "Out of fuel" screen.**
   - What is wrong: turning off (`optOut`) is a choice, not a lapse. The user lands on a red "Out of fuel" alert and an "Add fuel" button, and is never shown that their leftover fuel is still theirs.
   - Fix: design an "Off by choice" state:
     - Mascot relaxed, not asleep.
     - "Shield is off. You have $X of fuel left."
     - Two buttons: "Take it back" (`withdrawUnused`) and "Keep it for next time".
     - Put a confirm step before turning off, saying what stops.

2. **Protect > Shield stepped in: no word about leftover fuel.**
   - What is wrong: `markExited` closes the record, but the prepaid balance stays in the Repricer. The brief requires saying it can be withdrawn or kept for next time.
   - Fix:
     - Add a line under "Your loan now": "You still have $X of fuel. Take it back, or keep it for when you protect again." Give it a "Take it back" button.
     - "Protect again" must skip the USDC approval and prepay steps when the leftover is $1 or more, because the `MIN_PREPAY` check reads the existing balance.
     - It must also skip the ETH approval while the earlier allowance is still in place.

3. **Protect > Protected > "Change when" reopens the new-cover setup.**
   - What is wrong: the user sees a "Shield is off" pill, "Turn on Shield" and "Four wallet prompts" while their cover is live. The real action is one prompt (`setTrigger`). Moving the line earlier restarts the 15-minute wait; moving it later does not (PositionRegistry.sol line 107).
   - Fix: design a "Change when" tray:
     - The three cards with "Your line now" marked on one of them.
     - One button: "Move my line (1 wallet prompt)".
     - When the new line is earlier: "Moving your line earlier restarts the 15-minute wait. Until it ends, Shield can't step in at either line." This matches the contract: `setTrigger` resets the cover start, and the Executor returns `CoverWarmingUp` until 900 s have passed.

4. **Turning on, step 1 ("Let Shield take its slice, only in a rescue"), and Blocked > Approval removed.**
   - What is wrong: the copy says "only for what it is owed". The real app approves `maxUint256` of Aave's ETH receipt token to the Executor (web/src/components/borrow/cover-setup.tsx line 193). Rabby and MetaMask will show an unlimited approval to an unverified contract in red. Friendly copy that disagrees with the wallet prompt is the strongest scam signal there is.
   - Fix: say what the wallet will show:
     - "Your wallet will ask to approve unlimited [token symbol read from chain] for Shield's Executor (0x... link)."
     - "The contract only uses it in a rescue, for the repaid amount plus 1%. Not audited yet. You can revoke it any time."
     - Link a revoke action.
   - Separately, ask the lead whether a capped approval is possible.

5. **Not protected > "From another chain", and Turning on (3-step path).**
   - What is wrong: "No MON, no network switch" is false for turning on. Step 1 (approve) and step 3 (switch on, `optIn`) are Monad transactions that need Monad selected and MON for gas.
   - Fix:
     - In setup, say: "Paying the fuel needs no MON. The other two prompts are on Monad and need a little MON for gas."
     - Keep "No MON, no network switch" only for "Add fuel" while Shield is already on.

6. **Landing at 390: the first screen does not say what Shield does.**
   - What is wrong: above the 844 px fold there is only the sticker, "The floor is lava. Shield steps in first." and the animation. The plain promise starts at 1,015 px and "Protect my loan" at 1,151 px. A degen on a phone does not learn that this is about Aave liquidations, or 1% against 5.5%.
   - Fix:
     - On phones, order the hero as headline, one-line lead, button, then the scene.
     - Shorten the lead under the h1 to one plain line on every width: "Shield pays back part of your Aave loan before you get liquidated. 1%, not Aave's 5.5%."

7. **Protect > Out of fuel, and every Blocked reason: the facts card contradicts the headline.**
   - What is wrong: the headline says "nothing steps in before that now". The card below still says, in the present tense, "When Shield steps in: ETH at $2,640. Shield pays back about $26...".
   - Fix:
     - In off and blocked states, retitle the card "Your line (paused)", use the grey or yellow treatment, and change the verbs to "would pay back".
     - In blocked states, add "Fuel keeps burning while this is blocked", because the Repricer still charges.

8. **Protect > Arming: green "Shield is on" pill next to "Arming".**
   - What is wrong: the body says Shield can't step in yet. Green "on" plus "can't step in" is a contradiction a degen will read as "I'm covered".
   - Fix: make the pill a grape "Not on yet: arms in 14:59", ticking with the ring. Green "Shield is on" appears only once cover is armed.

9. **Not protected, Protected, Low fuel and the landing: "pays back about $26" never changes.**
   - What is wrong: the summary sentence and the facts card show $26 / $26.26 / $27.43 for every preset. The Executor repays enough to lift the health factor to trigger + 0.06 (`exitHfBuffer = 600`). On the sample loan that is:
     - Early: about $23.55.
     - Balanced: about $25.42.
     - Last call: about $27.62.
     - The ETH taken is 1.01 times each.
   - Picking a card visibly changes nothing in that sentence, and $26 is off even for Balanced.
   - Fix:
     - Recompute per preset in the prototype.
     - In the real app, compute it with the Executor's formula at the trigger price. `Executor.preview` at today's state returns `AboveTrigger`, not this number.

10. **Stats > "Monad, block by block" and the landing ticker: a "3 checked" stamp in every block.**
    - What is wrong: the caption says "The purple stamp is Shield's check landing in it". On chain, the keeper reprices every block only for the first 600 blocks after it starts, then every 200 blocks (keeper/src/config.ts, `REPRICE_WINDOW_BLOCKS` 600, `REPRICE_IDLE_EVERY_N_BLOCKS` 200). The per-block health checks are reads that leave nothing on chain. A judge who opens a stamped block on MonadVision will find no Shield transaction.
    - Fix:
      - Stamp only blocks that carry a real `Repriced` or `Exited` log, and link the stamp to the tx. `use-block-stream.ts` already tracks these per block.
      - Say the checks in words: "Shield reads every protected loan in every block." Give them a calm heartbeat dot, not a per-block stamp.

11. **Stats > "Next levels": Euler V2, Morpho Blue, Curvance, Neverland marked "Coming soon".**
    - What is wrong: none of these is on the roadmap in SPEC.md, and SPEC.md says Morpho and Euler already have their own pre-liquidation. It is an unsupported claim that also invites the "same shape" objection judges are expected to raise. It uses other teams' names as if plans existed.
    - Fix: show the real next steps from the docs:
      - cbBTC collateral once a swap route exists (ADR-034).
      - eMode loans (ADR-016, ADR-035).
      - Outside deposits into the vault (ADR-039).
    - Label them "Not built yet".

## Top 10 should fix

1. **Landing story: slow start, wrong resting frame.**
   - What is wrong:
     - The first story beat ("ETH starts to fall") lands at 3.0 s and the payoff at 7.1 s.
     - The first 3 s are lava rising, the line drawing, the mascot dropping and a 900 ms hold.
     - The resting frame (and the only frame under reduced motion) is the post-rescue level, with no Shield line. So the hero at rest never shows the product's one picture: you, Shield's line, the lava.
   - Fix:
     - Cut the pre-roll to under 1 s and the whole story to about 5 s.
     - After the end caption, settle back to the start frame with all three lines.
     - Under reduced motion, show the start frame with a two-sentence caption of the story.

2. **Shield stepped in: "You kept $1.17" states a counterfactual as fact, and "Share this save" does nothing.**
   - What is wrong: the borrower kept $1.17 only compared with an Aave liquidation that never happened. Shield's own fee ($0.26) is missing from the receipt.
   - Fix:
     - Use "$1.17 less than an Aave liquidation" or "Aave would have taken $1.17 more", and keep the celebration.
     - Add "Shield's fee: $0.26 (1%)" as a receipt row.
     - Design the share card: mascot, amount, block number, tx link. Otherwise remove the button.

3. **Line shown as a fixed ETH price everywhere.**
   - Where: "Pick an ETH price", "Your line stays at ETH $2,640", the line cards.
   - What is wrong: the line is a health factor. Its ETH price moves when the user borrows, repays or moves ETH on Aave, and drifts with interest. A degen who borrows more gets exited sooner without being told.
   - Fix:
     - Add one line under the cards and on Protected: "Your line moves with your loan. Borrow more on Aave and Shield steps in sooner."
     - Recompute the price every block in the real app.

4. **Not protected: presets are fixed health factors (1.06, 1.04, 1.02).**
   - What is wrong:
     - On a loan at 1.05, Early would fire as soon as cover arms.
     - Below about 1.02 no card is valid.
     - On the sample loan, Early is only 0.9% below today: a normal day's move.
   - Fix:
     - Design the disabled card ("Too close: ETH is already near this price").
     - Add a "Too close for Shield" state (repay some on Aave first).
     - Add a hint on Early: "ETH often moves this much in a day."

5. **Low fuel reuses the sweat drop, and there is no "near your line" state.**
   - What is wrong: the tired mascot with a sweat drop looks like the "Careful" price face, so a fuel warning reads as a price warning. The research's heads-up (ETH within 1% of the line, protected) is not designed. Neither are the "Safe" and "Danger" words, so only "Careful" is ever shown.
   - Fix:
     - Give Low fuel its own face (holding an empty can) with no sweat. Sweat stays reserved for price.
     - Design "Protected, ETH is 0.6% above your line" and show Safe and Danger examples.

6. **Mobile protect states: the cost and the main button are far down.**
   - What is wrong: on every protect state at 390, the cost and fuel come after a 400 px level. On Not protected, "Turn on Shield" sits about 2,200 px down.
   - Fix:
     - On phones, put a three-line summary above the level: status, steps in at, cost and paid up for.
     - Shrink the level to about 260 px.
     - Make the main button sticky at the bottom with the summary sentence.

7. **Header.**
   - What is wrong:
     - It shows a connected wallet (0x3C4a...93BC) on the landing and on every protect state except Not connected.
     - At 390 it has no connect button, wallet or block chip at all.
   - Fix:
     - The header reflects the real connection.
     - Phones get a compact connect or wallet button.
     - The wrong-network chip lives here too (see Missing states).

8. **Tap targets under 44 px at 390.**
   - What is wrong:
     - Header links are 40 px tall.
     - "Check another wallet", "Stop and go back" and "Skip the wait" are 34 px.
     - "View on MonadVision", "See the transaction on MonadVision" and the footer links are 26 px.
   - Fix: `min-height: 44px` with padding on every link and button. Keep the type size.

9. **Keyboard focus and radio-card tab stops.**
   - What is wrong:
     - Focus drops to the page body after every wallet step, because the step card is re-rendered.
     - Each radio card is its own tab stop: 8 tabs from the first card to "Turn on Shield". Arrow keys already work.
   - Fix:
     - Keep one button element across steps, move focus to the new step heading, and announce "Step 2 of 4" in the live region.
     - Use a roving tabindex so each card group is one tab stop.

10. **Blocked > "Price above your max".**
    - What is wrong: "A rescue now would take 1.5% extra" implies a floating price. In fact the exit discount is an owner parameter (`exitDiscountBps`, 1% now), and setup never shows the user a maximum.
    - Fix:
      - Say "Shield's rescue fee was raised to 1.5%. You agreed to at most 1%."
      - Add "Most you'll pay in a rescue: 1%" (default, editable) to setup's details, so the reference exists.

Smaller items, fix in the build:

- Landing FAQ: "On a $100 loan that is about $0.30 a month" holds only for the example loan. Say "for the example loan above" and that the cost depends on how close the line is.
- Vault "Earned so far $11.87" and Stats "Protocol income $13.16" disagree on screen. Explain the split as "vault $11.87 + treasury $1.29". On the vault, split "$5,011.87" into a USDC amount and the value of the ETH it holds.
- Out of fuel: the level says "Your line was $2,640" while the alert says "Your line stays at". Pick one.
- Stats for nerds: the health factor shows "1.069" against a sample value of 1.0699. Round to 1.07.

## States the real app needs that the prototype lacks

Each needs a designed screen or tray, with the mascot mood and one main button.

1. **Wrong network.**
   - Header chip "On Base, switch to Monad", plus a page banner with one "Switch to Monad" button.
   - Live numbers stay visible; action buttons are disabled with a reason.
   - The cross-chain fuel payment is the one action allowed off Monad.
2. **Transaction pending and failed.** Every action needs these sub-states: turn on, add fuel, change line, turn off, take back fuel, step in now, and treasury add or take out.
   - Waiting for wallet: this one exists.
   - Rejected in wallet: "You said no. Nothing moved." and "Try again".
   - Sent and pending, with the tx link.
   - Reverted, with the reason in plain words: "Nothing changed. Only the gas was spent."
   - Slow: still pending after about 10 s.
3. **Indexer down.**
   - History views get a calm "History is catching up, last updated N minutes ago" line: the stepped-in receipt list, the stats scoreboard and "Rescues paid for".
   - Live RPC numbers keep working.
   - Never show 0 as if it were real.
4. **eMode or unsupported collateral.** Today it is only a note on "No Aave loan" plus a blocked reason. Detect and show "We see your Aave loan, but Shield can't cover it yet" with the exact reason and the one fix, for:
   - eMode.
   - Collateral other than ETH (cbBTC, LSTs, PTs).
   - Debt other than USDC.
   - ETH plus other collateral.
5. **Exit due.**
   - ETH is at or below the line, cover is armed, and no exit has landed yet.
   - First: "Shield is stepping in" with a live block count.
   - After a few blocks: a "Step in now" button that anyone can press. The FAQ already promises this.
   - The vault-short case: "The vault can't cover this rescue right now. Your loan stays as it was."
6. **Read-only check of any wallet.**
   - Banner "Viewing 0x... (read only)" and the loan level with no action buttons.
   - An invalid-address error: a junk address currently routes to "No Aave loan".
7. **Off by choice with leftover fuel** (must fix 1), **Change when tray** (must fix 3), **Add fuel tray** (amount cards and source; "Add fuel" on Protected currently does nothing), and **Take back fuel**.
8. **Cross-chain fuel in flight.**
   - Sent from Base, landing, landed, and failed or refunded.
   - "Switch on" stays locked until the fuel is credited, because `optIn` needs $1 or more already prepaid.
9. **Resume a half-finished turn-on.** Approvals already given show as checked and are skipped.
10. **Too close for Shield** (should fix 4) and **Protected, near your line** (should fix 5).
11. **Loading.** Skeleton levels and numbers while RPC reads are in flight, so a $0 or a missing line never flashes.
