# Shield web UI: design research on DeFi position, risk and automation screens

Researched 5 Oct 2026 by a research agent for Shield (opt-in early exit for Aave V3 borrowers on Monad). Covers Aave, Morpho, Euler, Summer.fi, DeFi Saver and Hyperliquid.

## How this was researched, and how far to trust it

- No wallet was connected and nothing was logged into. All six apps are JavaScript apps, so most of the evidence comes from these sources:
  - **Code**: open-source frontends read directly. These are the Aave interface (`aave/interface`, main branch), Euler's open-source `euler-lite` app, and Morpho's `morpho-lite-apps` (archived May 2026).
  - **Docs**: official docs and help centres, mostly through their `.md` and `llms-full.txt` exports.
  - **Screenshot**: images embedded in official docs, which I viewed. These can be older than the live UI.
  - **Bundle**: the English string table and component code in Hyperliquid's production JavaScript, fetched 5 Oct 2026. The hashed filenames change on every deploy.
  - **SSR text**: the text app.morpho.org serves to a non-JavaScript fetch. It may not match what a browser renders.
- **Summer.fi is historical.**
  - Summer.fi Pro went read-only on 12 Feb 2026 and its automations stopped that day.
  - After a vault exploit on 6 Jul 2026, Summer.fi announced a full wind-down. Its interface stayed up only until 31 Aug 2026.
  - Everything about Summer.fi below therefore comes from archived docs (Wayback Machine) and code. Sources: [S1], [S2], [S3].
- Where something could not be checked without a wallet, it is listed under "Not verified" at the end instead of being guessed.

---

## 1. Aave (app.aave.com V3 interface; Aave Pro for V4)

### 1.1 Position page (V3 dashboard)

- **Header stats, left to right:**
  - Net worth (USD, compact, 2 decimals).
  - Net APY, with a tooltip.
  - Health factor, followed by a small "Risk details" button.
  - Available rewards, with a "Claim" button.
  - Net APY shows a placeholder when there is no position. [A1]
- **Body.** Two lists:
  - "Your supplies": columns Asset, Balance, APY and a Collateral toggle. Summary chips: Balance, APY, Collateral. [A2]
  - "Your borrows": columns Asset, Debt, APY. Summary chips: Balance, APY, Borrow power used. [A3]
  - Empty states read "Nothing supplied yet" and "Nothing borrowed yet". There is also a "Show assets with small balance" toggle. [A2][A3]
- **Emphasis.** HF is the only coloured number in the header, and it is the only header stat with a drill-down ("Risk details"). [A1][A4]
- **Aave Pro (V4).** The user guide says only that the Dashboard shows "total deposited value, your total borrowed value, and your health factor". It does not document colours, bars or layout. [A20]

### 1.2 Risk display

- **HF colours on the number:**
  - Green when HF >= 3.
  - Orange (warning) when 1.1 <= HF < 3.
  - Red when HF < 1.1.
  - HF is rounded down to 2 decimals before display. HF -1 (no debt) renders as "∞" in green. [A4]
- **The risk modal uses slightly different band edges:**
  - Orange when 1.1 < HF <= 3; red when HF <= 1.1.
  - So exactly 1.10 is orange on the dashboard number but red in the modal, and exactly 3.00 is green on the number but orange in the modal. [A5]
- **"Liquidation risk parameters" modal.**
  - Intro: "Your health factor and loan to value determine the assurance of your collateral. To avoid liquidations you can supply more collateral or repay borrow positions." [A5]
  - Two bordered cards, "Health factor" and "Current LTV". Each has a title, a one-line description, the value inside a 56 px circle filled with the band colour, a bar, and a footer sentence. [A6]
  - HF footer: "If the health factor goes below 1, the liquidation of your collateral might be triggered."
  - LTV footer: "If your loan to value goes above the liquidation threshold your collateral supplied may be liquidated." [A5]
- **HF bar:**
  - A 4 px gradient from green `#46BC4B` through orange `#F89F1A` to red `#BC0000`, mirrored so red sits on the left.
  - A pointer labelled with the HF sits at HF x 10 percent of the width; HF above 10 is pinned to the right end.
  - A fixed red tick at 10 percent is labelled "1.00 Liquidation value".
  - The scale is therefore linear from 0 to 10. [A7]
- **LTV bar:**
  - The pointer shows current LTV, with "MAX x%" underneath.
  - A red tick marks the "Liquidation threshold".
  - LTV is red when LTV >= min(max LTV, liquidation threshold), orange when it is above half of max LTV and below max LTV, and green otherwise. [A5][A8]
- **Inside every transaction modal**, a "Health factor" row shows current HF -> new HF (arrow icon, both colour-coded) with the helper text "Liquidation at <1.0". [A9]
- **Borrow guardrail.**
  - When the new HF is below 1.5, the modal shows "Borrowing this amount will reduce your health factor and increase risk of liquidation."
  - The action button stays disabled until the user ticks "I acknowledge the risks involved." [A10][A11]
- **Swap guardrails:**
  - When HF after the swap is in [1.01, 1.05), a warning reads "Low health factor after swap. Your position will carry a higher risk of liquidation." It needs the checkbox "I understand the liquidation risk and want to proceed". [A12][A13]
  - Below 1.01 a red error blocks the action: "Your health factor after this swap will be critically low and may result in liquidation. Please choose a different asset or reduce the swap amount to stay safe." [A14]
- **Liquidation penalty tooltip** (useful wording for Shield's comparison line): "When a liquidation occurs, liquidators repay up to 50% of the outstanding borrowed amount on behalf of the borrower. In return, they can buy the collateral at a discount and keep the difference (liquidation penalty) as a bonus." [A15]

### 1.3 Earn / reserve page

- The V3 UI has no ERC-4626 vault page. The closest analogue is the reserve page. [A16][A17][A18]
  - Header: Reserve size, Available liquidity, Utilization rate, Oracle price.
  - Supply info: Total supplied ("x of cap"), APY, Collateral usage, Max LTV, Liquidation threshold, Liquidation penalty.
  - Right column "Your info": "Available to supply" and "Available to borrow". When disconnected it reads "Please connect a wallet to view your personal information here."

### 1.4 Transaction flows

- **Layout.** One modal per action, with up to two stacked full-width buttons: approval first, then the action. [A19]
- **Approval button states:**
  - "Approve {symbol} to continue", with an info tooltip.
  - Then "Approving {symbol}..." with a spinner.
  - Then "Approve Confirmed ✓", disabled.
  - The action button stays disabled until the approval succeeds. [A19]
- **Action button states, in priority order:**
  - Blocked, then the mapped error.
  - "Wrong Network" (disabled).
  - "Fetching data..."
  - "Enter an amount"
  - Preparing (spinner).
  - The in-progress text.
  - Disabled while approval is pending.
  - The action itself. [A19]
- **Approval method.**
  - Above the buttons: "Approve with [Signed message | Transaction]" and, after approval, a "Review approval tx details" link.
  - Smart-contract wallets are forced to "Transaction". [A21][A22]
  - Tooltip: "To continue, you need to grant smart contracts permission to move your funds from your wallet. Depending on the asset and wallet you use, it is done by signing the permission message (gas free), or by submitting an approval transaction (requires gas)." [A23]
- **Preview.** A "Transaction overview" box lists the rows that will change, such as Health factor before -> after, Collateralization (Enabled/Disabled/Unavailable) and Rewards APR. [A9]
- **Gas.**
  - A gas-pump icon with the cost in USD sits under the overview.
  - When the native balance is below the gas cost: "You do not have enough {ETH} in your account to pay for transaction fees on {network} network. Please deposit {ETH} from another account." [A24]
- **Result states:**
  - Titles: "All done", "In Progress", "Transaction Cancelled", "Transaction Expired".
  - Buttons: "Review Transaction" (explorer link with an external-link icon, disabled while pending without a hash) and "Done". [A25][A26]
  - Success adds "Add {aToken|token} to wallet to track your balance." [A27]
  - Failure shows "Transaction Failed" / "We were unable to complete this transaction" with "Copy error text" and "Get support". Gas-estimation failures offer "copy the error". [A28]
- **Revert reasons.** Pool error codes are mapped to sentences. For example, 35 is "Health factor is lesser than the liquidation threshold" and 45 is "Health factor is not below the threshold". [A35]

### 1.5 Wallet connection and wrong network

- **Stack.** ConnectKit 1.9.2 on wagmi 2 and viem 2. [A30]
- **Wrong network.**
  - The warning tries to switch automatically on mount ("Switching to {network}...").
  - If that fails it falls back to "Please switch to {network}." with a "Switch Network" text button, or "We couldn't switch the network automatically. Please check if you can change it from the wallet."
  - The action button also reads "Wrong Network" and is disabled. [A31][A19]
- **Read-only watch mode.**
  - "Watch wallet": "Watch a wallet balance in read-only mode".
  - Under the disabled buttons: "Read-only mode. Connect to a wallet to perform transactions." [A29][A19]
- **Environment banners.** "Fork mode is ON / The app is running in fork mode." and "Test Mode". [A32]

### 1.6 Automation

- None in the Aave UI. Third parties fill the gap: DeFi Saver, and Summer.fi until Feb 2026.

### 1.7 Number and address formatting

- **`FormattedNumber`:** [A33]
  - Compact notation applies automatically above 99,999, with K, M, B, T postfixes.
  - Default decimals: 2 for values >= 1, for percentages and for USD; 7 for non-USD values below 1; 0 for zero.
  - Non-zero values below 10^-decimals render as "<" plus the minimum, for example "< 0.01".
  - Percent props take fractions and multiply by 100.
  - Optional `roundDown` truncates instead of rounding.
- **Addresses.** `textCenterEllipsis(str, from, to)` gives the "0x12...abcd" style. [A34] I did not check the from/to counts at each call site.

### 1.8 Borrow and avoid

- **Borrow:**
  - The before -> after HF row with "Liquidation at <1.0" in every modal.
  - The explicit button state machine.
  - The risk checkbox when the resulting HF is low.
  - USD gas display with an insufficient-gas warning.
  - Plain-English revert mapping with "Copy error text".
  - Read-only watch mode.
- **Avoid:**
  - Two different HF band definitions, in the number and in the modal.
  - A linear 0 to 10 HF bar, which spends 90 percent of its width on HF values above 1, so the 1.0 to 1.1 zone that matters for Shield is about 1 percent of the bar. [A7]

---

## 2. Morpho (app.morpho.org)

### 2.1 Position page

- **Main app.** It is closed source. The FAQ confirms that "Health factor is visible on users' position in the Morpho interface" and the same is said of "Liquidation price". [M1] Their exact layout and colours were not verifiable without a wallet.
- **Morpho's own guidance to integrators building borrow UIs:** [M2]
  - "Display Health Factor Prominently: This should be the most visible metric on any position management dashboard. Use visual aids like colors (green, yellow, red) or progress bars."
  - "Display the market's LLTV alongside the user's current LTV."
  - Alert when HF drops below a threshold such as 1.1.
  - Cap borrows so HF stays at or above 1.05.
  - "Simulate ... Show the user what their new Health Factor will be before they sign."
  - Show which oracle a market uses.
  - The worked example also shows "Liquidation Buffer: 11.00%".
- **Lite app (open source, archived).**
  - A side sheet titled "Your Position", subtitled "You can view and edit your position here. To understand more about risks, please visit our docs."
  - Three rows: "My collateral position (SYMBOL)", "My loan position (SYMBOL)" and "LTV / Liquidation LTV". Each shows the current value and the updated value as the user types.
  - Tabs: Supply, Withdraw, Borrow, Repay.
  - Footer button: "Back to list". [M3]

### 2.2 Risk display

- **Market page titles** put LLTV next to the pair, for example "USDC | WBTC 86%". [M4]
- **Interface risk warnings,** driven by Morpho's risk API: [M5]
  - RED: unrecognised collateral, loan asset, oracle or curator. The user must opt in before proceeding.
  - YELLOW: a soft notice that does not block.
  - BLACKLISTED: hidden from the interface.
- **List pages** carry a "Warnings" column. Vault warnings include "Deposits are currently disabled on this vault" and "Less than 0.5% of this vault's deposits are currently available to withdraw." [M6]
- **Liquidation incentive.** LIF = min(1.15, 1/(0.3 x LLTV + 0.7)), about 1.05 for an 86 percent LLTV market. [M8]
- **Pre-liquidations** (the closest analogue to Shield): [M7]
  - The borrower opts in by authorising a contract with preLLTV, preLCF and preLIF parameters.
  - The announcement frames the trade-off as "a reduced liquidation penalty" in exchange for "earlier liquidation".
  - It shows no Morpho app UI for it and names no live front end.

### 2.3 Vault / earn page

- **Earn list columns:** Vault, Chain, Asset, Curators, Total Deposits, Net APY, Version, Warnings. A counter reads "Showing 35 of 213 vaults". [M6]
- **Vault page (SSR text):** [M9]
  - Header: Net APY, Total Deposits, Liquidity.
  - Key facts: chain, version, asset, contract address, curator.
  - Roles: owner, curator, guardian.
  - "Performance fee", and "Warnings: None".
  - The deposit/withdraw panel did not appear in the SSR text, so its labels are not verified.
- **Morpho's published vault UX requirements and best practices,** which map almost one-to-one onto Shield's LP page: [M10][M11]
  - Vocabulary: say "Earn" or "DeFi yield", not "staking" or "investment"; describe yield as "variable" or "indicative", never "guaranteed".
  - "Split the displayed yield ... into clear components": base APY versus rewards APR, naming the token each one pays in.
  - Show the vault name on the deposit flow, review screen and post-deposit view.
  - Name the curator; show TVL; "Surfacing instantly withdrawable liquidity can reassure users".
  - Give allocation percentages and a one-line thesis ("Blue chip markets curated by X").
  - List the headline benefits: no fixed lock-ups, auto-compounding, non-custodial.
  - Give a clear "Learn more" CTA.
  - Ask for a disclaimer acknowledgement before first use.

### 2.4 Transaction flows

- **Bundles.** Approve, supply collateral and borrow happen in one transaction that "reverts as a whole if any step would fail". Approvals can be ERC-2612 permits or Permit2 signatures inside the same transaction. [M12]
- **Lite app transaction button:** [M13][M3]
  - Label "Check your wallet" while the wallet prompt is open; a spinner until the receipt arrives.
  - Toasts: "Broadcasted transaction 0x12345678." with an "Explorer ↗" action, then "Transaction 0x12345678 was successful." or "... reverted."
  - Wallet errors show viem's `shortMessage`.
  - A separate "Approve" button replaces the action button until the allowance is enough.

### 2.5 Wallet and network

- Not verified for the main app. A third-party guide I checked [M14] does not describe the connect or network flow either.

### 2.6 Formatting

- The SSR text shows full USD with separators and 2 decimals ("$528,165,244.77", "$1,687,026,803.54"), percentages with 2 decimals ("3.67%", "86.00%"), and the qualifier "Borrow APY (instant)". [M6][M15]
- I could not confirm whether the browser-rendered UI uses compact notation.

### 2.7 Borrow and avoid

- **Borrow:**
  - The vault UX checklist.
  - The Warnings column with plain-English liquidity warnings.
  - The red/yellow severity model with forced opt-in on red.
  - LLTV shown in the market title.
  - "Check your wallet" plus hash toasts with an explorer link.
- **Avoid:**
  - Blended headline APYs (Morpho's own guidance warns against them).
  - Full-precision nine-digit dollar figures in dense tables.

---

## 3. Euler (app.euler.finance)

### 3.1 Position page

- **Position detail,** from a docs screenshot of a USDtb/USDT position: [E1]
  - Header: "Position 1", then the market label "Euler Prime" and "USDtb/USDT".
  - Two cards side by side:
    - "Position summary": Net APY, ROE, Net asset value.
    - "Position risk": Health score "1.05", Time to liquidation ">1 year", Liquidation LTV "91.02% / 96%", with a horizontal bar under it.
  - Below, a "Borrow" card:
    - The asset, with Borrow APY on the right.
    - Market value "$13.68 ~ 13.7 USDT", Current price, Oracle price, "Liq. price".
    - Action buttons: Multiply, Borrow, Repay, Refinance debt.
- **Portfolio list.** Each position block shows: [E3]
  - Net APY and ROE top right: green with a sparkle icon when rewards are included, red when negative.
  - Net asset value, "My Debt $13.68 ~ 13.7 USDT", "Collateral value".
  - Health score, and "Your LTV" with a mini bar and "91.02/96%".
- **Portfolio header:** Net APY, ROE, Total supplied, Total borrowed, Net asset value. Sections: Positions, Deposits, Rewards, Activity. [E4]
- **Watch mode.** A full-width banner reads "Viewing as 0xE674...2Ca8 [Exit]". [E1]

### 3.2 Risk display

- **Time to Liquidation (TTL).** Defined as "An estimate of how long it would take for an account to reach the liquidation threshold if prices stayed the same while interest continued accruing at current rates." [E5]
  - The UI shows sentinel strings such as ">1 year".
  - The code has explicit states for infinity, more-than-a-year and already-liquidatable. [E6]
- **Rounding caveat** in the docs: "A health score displayed as 1 may be rounded, so consult raw values and transaction simulation." [E4]
- **Colour thresholds** for the health score are not documented. In the official screenshots, HF 1.05 is plain white and the LTV bar at 91 percent of a 96 percent LLTV is teal, with no warning colour. [E1][E2]
- **Liquidation discount.** It "starts at zero at the threshold and rises linearly with the health shortfall until a liquidator executes or the configured maximum is reached". The docs illustrate this with a diagram. [E7]
- **Pair overview card:** [E9]
  - Price "1.002 USDtb/USDT", with a flip-direction icon.
  - Max multiplier, Supply APY, Borrow APY, Net APY, Max ROE (with sparkle icons and info tooltips).
  - Max LTV, Liquidation LTV.
  - An "APY breakdown" popover separates the base rate from intrinsic APY and reward APR.

### 3.3 Vault / earn page (EulerEarn)

- **The vault page shows:** [E8]
  - Total assets or supply ("not necessarily the amount available for immediate withdrawal").
  - Liquidity or maximum withdrawal.
  - Recent APY ("historical performance over the displayed window, not a forecast").
  - Exposure (strategy allocation).
  - Management (Owner, Curator, Guardian, Allocator, fee recipient, fee, timelock).
  - Rebalancing and activity; addresses.
- **Deposit:** "Enter an amount and review the expected shares and current deposit limit." [E8]
- **Withdraw:** "Compare the accounting value of your shares with the amount currently available to withdraw." [E8]

### 3.4 Transaction flows (euler-lite code and docs)

- **Review list before signing:** borrowed amount, collateral amount, health score, LTV, liquidation price, oracle route, rates, liquidity, token approvals and gas estimate. [E13]
- **"Transaction review" modal (euler-lite):** [E10][E11]
  - Numbered steps such as "1. Approve 100 USDC".
  - A "Separate tx" tag on steps that need their own wallet prompt; a "~" prefix on estimated amounts; the exact amount in a hover tooltip.
  - Grouped sections: signature steps, main steps, "After execution".
  - Utility buttons "Copy calldata" and "Simulate on Tenderly", which change to "View simulation" or "Simulation failed".
  - Alerts: "Preparation failed", "Infinite approval", and a stale-quote warning.
- **Batching.** The app "can combine compatible position actions into one atomic transaction. An approval or permit may still require a separate wallet prompt." [E12]

### 3.5 Wallet and network

- "Select Connect in the top-right corner ... Verify the account and network before approving the connection." [E12]
- The header has a chain-icon network dropdown beside the address pill "0xE674...2Ca8". [E1]

### 3.6 Formatting (euler-lite)

- Addresses: `shortenAddress` gives "0x1234...cdef" (first 6 characters including 0x, last 4). [E14]
- USD: "<$0.01" for tiny positive values; compact `Intl` notation for large values ("$1.5M"); token amounts with 2 decimals by default. [E14]
- Exact amounts: `formatExactAmount` gives full precision with trailing zeros trimmed, used in tooltips. [E14]
- Secondary values: USD first, then the token amount after "~". [E1][E3]

### 3.7 Borrow and avoid

- **Borrow:**
  - The two-card "summary / risk" split.
  - TTL as a human-scale risk number.
  - "Current price" next to "Oracle price" next to "Liq. price".
  - Numbered steps with "Separate tx" tags.
  - "Viewing as" watch mode.
  - Telling users plainly that a displayed 1.00 may be rounded.
- **Avoid:**
  - A near-liquidation position (HF 1.05, LTV 91 percent of 96 percent) that looks visually calm. [E1]

---

## 4. Summer.fi (historical: Pro read-only from 12 Feb 2026; interface up only until 31 Aug 2026)

### 4.1 Position page

- **Tabs:** Overview, Position Info, Protection (with an ON/OFF badge), Optimization (ON badge), History. [S4]
- **Header right:** "Current LTV 66.79% | Current Market Price 67,591.82 WBTC/USDC". [S4]
- **Onboarding.** New Aave positions were prompted to set up stop-loss at creation. Existing positions used the "Protection" tab, then "Setup Stop Loss Protection"; afterwards the tab showed Protection "On". [S11]

### 4.2 Risk and protection display

- **"Stop-Loss ON" card.** Four large numbers, each with a small relational line underneath: [S4][S5]
  - "Stop-Loss Loan to Value 75.17%", with "8.37% below Loan to Value".
  - "Loan to Value 66.79%", with "Stop-Loss LTV: 75.17%".
  - "Dynamic Stop-Loss Price 60,122.71 WBTC/USDC", with "2,181.37 above Liquidation Price".
  - "Est. WBTC on Stop-Loss trigger 0.0012 WBTC", with "0.0004 WBTC Saving compared to liquidation".
- **Before activation** the same card shows "-" with green "after" pills: "63.00% after", "$634.92 after", "up to 23,492.06 USDC after". [S6]

### 4.3 Automation and trigger setup

- **Stop-loss setup card**, titled "Stop-Loss Protection Setup" (new) or "Manage your Stop-Loss" (existing): [S6][S4][S7]
  - A segmented choice "Close to USDC | Close to WBTC".
  - Explainer: "Set the Loan to Value trigger at the point which you want your Vault to be closed at automatically. Learn more about how Stop-Loss works here."
  - **One slider** labelled "Stop-Loss Loan to Value" on the left with the value ("63%"). On the right, "Dynamic stop price" ("$ 634.92") updates live as the slider moves.
  - "Reset" link.
  - A grey box "On Stop-Loss trigger" lists: Estimated to receive ("up to 23,492.06 USDC"), Saving compared to liquidation ("up to 15,333.33 USDC"), Estimated fees on trigger ("$106.32", with help), Max transaction cost.
  - Buttons: "Confirm" (or "Add Stop Loss"), and a text link "Remove trigger". Elsewhere: "Cancel downside protection".
- **Why a ratio and not a price:** "Setting a target liquidation price means that it must be reconfigured every time you adjust your vault's collateral and debt." [S7]
- **Stated assumptions behind the estimates:** "The calculation shown assumes a 2% difference from Trigger Price to Market Price. The amount saved compared to liquidation is based on the assumption of not paying a Liquidation Penalty, currently set to 13.00%." [S7]
- **Cost wording:** "no recurring or additional costs"; gas for the trigger "is reimbursed, and paid from the Vault's funds"; "you can see a detail of all fees charged to the vault closing transaction". [S7]
- **Risks the docs disclosed:** "Keepers are centralized", "Gas costs can spike", "The exchange might face liquidity issues", "The price oracle can fail", and the automation contracts "could be paused". [S7]
- **What happens at trigger,** shown as a flow diagram: Keeper -> Automation Smart Contract -> Close Vault -> Flash loan -> Debt -> Unlock and Swap Collateral -> Wallet. [S7]
- **Auto-Sell configuration:** [S8]
  - Trigger Ratio; Target Ratio ("always higher than the Trigger Ratio").
  - Min. Sell Price; Max Gas Fee. If gas exceeds the max, it "will remain active but will not execute".
  - Recursive. Executes only if it can reach the target +/- 2 percent.
- **Server-side validation messages:** [S9][S10]
  - Errors: "Stop Loss trigger already exists", "Debt value is too high" (above $20M).
  - Warnings: "Stop loss triggered immediately" (when the current LTV is already past the trigger), "Your stop loss will make the auto-sell not trigger", "Auto sell trigger close to stop loss trigger", "Auto sell target close to auto buy trigger".
- **Upsell card** on the Protection tab: "Stop scrambling to manage a position ... Set up Auto-Sell". [S4]

### 4.4 Vault / earn page

- Lazy Summer vaults are not studied here; they are halted after the exploit [S3].
- **Lesson from the exploit for Shield's ERC-4626 vault:**
  - The attacker "donated Silo 'Varlamore' tokens, still carrying stale, never-marked-down valuations ... into a strategy module that had been capped for removal but still counted toward vault NAV".
  - That inflated the share price about 9.5 percent and let them redeem about $71M against a $64.8M deposit. [S3][S12]

### 4.5 Wallet, network, formatting

- Wallet and network handling: not verified (the UI is offline).
- From screenshots: [S4][S6]
  - LTV to 2 decimals.
  - Prices with thousands separators and the pair unit ("60,122.71 WBTC/USDC").
  - Token amounts with 4 to 5 decimals ("0.0012 WBTC", "3.05813 ETH").
  - The qualifier "up to" on estimates.

### 4.6 Borrow and avoid

- **Borrow:**
  - Slider plus paired live price readout.
  - "On trigger" summary box with "Saving compared to liquidation". This is exactly Shield's "Aave penalty if liquidated vs Shield" line.
  - Relational sublines ("2,181.37 above Liquidation Price").
  - ON/OFF badge on the tab.
  - Disclosed assumptions and risks.
  - "Triggered immediately" warning.
- **Avoid:**
  - Vault NAV that counts assets a third party can donate or that are not marked to market [S12].
  - Depending on a single product line that can be sunset with automations silently off. Shield's UI must make "Unprotected" impossible to miss.

---

## 5. DeFi Saver (app.defisaver.com)

### 5.1 Position page (Aave)

- **Tabs:** Manage, Automate, Stake, Notify, History. Next to them: a protocol-version selector and a wallet/account selector. [D2]
- **Overview card:** [D1][D2]
  - USD/ETH denomination toggle.
  - "Ratio:" with a Collateral | Safety | Health segmented switch and a large value ("159.25%").
  - **Directly under the ratio, an inline nudge:** "Enable liquidation protection at 105%" with a "Protect" toggle.
  - Then "Supplying $7,917.89" and "Borrowing $4,002.21", each with a bar.
- **Right column:**
  - Balance; Net APY with "$0 YoY" under it.
  - Tabs Details | Automations | Rewards.
  - Details rows: E-Mode (Manage), Liquidation price, Borrow power used, Left to borrow. [D2]
- **Ratio definitions:** Health Ratio (Aave HF), Collateral Ratio, and Safety Ratio = collateral x collateral factor / debt x 100. [D3]

### 5.2 Risk display

- **Ratio bar:** [D4][D5]
  - A grey fill with the current ratio written inside it ("158.57%").
  - A red tick at liquidation.
  - White ticks for the trigger and target, with labels and bracket arrows: "130%" below pointing to "145%" for repay; "160%" above pointing to "145%" for boost.
  - A red -> orange -> green gradient strip underneath.
- **Plain-language summary under the bar:** [D4][D5]
  - "Liquidation protection: If below 130% ($3,145.51) repay to 145%".
  - "Leverage increase: If above 160% ($3,871.40) boost to 145%".
  - The ratio trigger is always paired with the collateral price it implies.
- **Before -> after values** in modals are coloured by direction: "191.25% → 226.58%" in green, "96.91% → 97.89%" in orange. [D6]

### 5.3 Automation and trigger setup

- **Automate tab.** A vertical list of cards, each with a one-line description: Liquidation Protection, Automated Leverage Management, Stop Loss, Take Profit, Boost on Target Price, Repay on Target Price, Collateral Switch. [D7]
- **Liquidation Protection (zero-config):** [D8]
  - "Automatically repay your position to protect it from liquidation once your ratio drops below 105%."
  - Info box: "Once your ratio drops below 105%, your position will be automatically repaid to keep it safe from liquidation. No configuration needed."
  - Button: "Enable Automation".
  - Minimum Safety Ratio thresholds: Aave V3 105%, Morpho Blue 127%, Maker 155%. It repays to +5 percent.
- **Automated Leverage Management:** [D4][D9]
  - The default view has a single input, "Keep the ratio at: 145 %".
  - An "Advanced" checkbox reveals four inputs: "If ratio falls below", "Repay it to", "If ratio goes over", "Boost it to", grouped under "Repay when price drops" and "Boost when price rises".
  - Configure | History sub-tabs.
  - A right-hand "Position overview" card: Collateral, Debt, Safety ratio, Current price, Liquidation price.
- **Stop Loss:** [D10]
  - "Close if price below $3,500.00 (~144%)".
  - Inputs: Collateral asset, Debt asset, "Price of ETH is under: 3500 DAI", "Close to: Collateral".
  - A "Set max gas price" checkbox; "ENABLE".
  - The docs explain "Close to collateral" versus "Close to debt" step by step.
- **After creating a position:** [D11]
  - The success modal shows "SUCCESS Position created" with Collateral, Debt and Ratio.
  - Then "ADDITIONAL OPTIONS": a list of automations with an "AUTOMATE" button, and "DONE".
- **Execution cadence.** "The system checks all automated positions every minute". Triggers follow the protocol's oracle. [D15]

### 5.4 Fees and requirements

- **Current docs:** [D12]
  - The gas for each automated transaction "will be charged to the position, not the user's wallet".
  - Swap fees: 0.25% (uncorrelated), 0.1% (correlated), 0.01% (stable pairs).
  - "a fee of 0.05% on each triggered automation transaction".
  - "simply enabling and keeping any automated strategy enabled ... does not involve any kind of one-time or on-going, continuous service fees".
  - Flash-loan fallback to Aave at 0.09%.
- **The in-app banner in the docs screenshots conflicts:** "Fees for using Automated Leverage Management include the transaction fee and a 0.3% service fee on the repaid/leveraged amount. There are no fees for simply keeping this automated strategy enabled and your position monitored." [D4][D8]
- **Minimum debt:** $30,000 for Aave V3/V4 on mainnet; $500 on Arbitrum, Optimism and Base. Automation stays on but will not execute below $5,000 on Ethereum or $500 on L2s. [D13]
  - An older Aave page says $15,000 and that a Smart Wallet is required. The newer page says Aave V3 works with EOAs. The docs conflict. [D14]

### 5.5 Other transaction patterns

- **Stepper in the migration modal:** "Create Smart Wallet ✓", then "Token approvals", then "Migrate position". [D16]
- **Close modal:** "Buying at rate 1,780.50 DAI/ETH", "Est. sent to account: 8.76 ETH", exchange route, "Trade size price impact: 0%", "Slippage limit: 0.2%", "Includes 0.25% service fee". [D17]
- **Simulation Mode:** a sandboxed fork with 100 ETH. Prices are frozen at the fork. [D18]

### 5.6 Borrow and avoid

- **Borrow:**
  - Inline "Enable protection at X [Protect]" on the risk number.
  - Ratio bar with labelled trigger and target ticks.
  - "If below X ($price) ..." sentences.
  - One simple input with an "Advanced" disclosure.
  - "No fees for simply keeping ... enabled" framing.
  - Post-action upsell of protection.
  - Fee line inside the confirm box.
- **Avoid:**
  - Fee text in screenshots that disagrees with the fee page.
  - Contradictory requirement pages.
  - Silent non-execution below a debt floor (it is disclosed in docs but not, as far as I could see, at the trigger UI).

---

## 6. Hyperliquid (app.hyperliquid.xyz)

### 6.1 Position table and account panel

- **Positions table columns, in order:** Market, Size, Position Value, Entry Price, Mark Price, PNL (ROE %), Liq. Price, Margin, Funding, a close-actions column, TP/SL. [H1][H2]
  - PNL tooltip: "Mark price is used to estimate unrealized PNL. Only trade prices are used for realized PNL."
  - Margin tooltip: "For isolated positions, margin includes unrealized pnl." [H2]
- **Account panel:** [H3][H2]
  - Heading "Account Equity", then "Perps Overview".
  - Rows: Balance, Unrealized PNL, Cross Margin Ratio (coloured), Maintenance Margin, Cross Account Leverage. Each has an explanation tooltip.
  - Balance tooltip: "Total Net Transfers + Total Realized Profit + Total Net Funding Fees".

### 6.2 Risk display

- **Cross Margin Ratio.** "Maintenance Margin / Portfolio Value. Your cross positions will be liquidated if Margin Ratio reaches 100%." [H2]
  - It is formatted to 2 decimals with "%".
  - It is coloured red above 80 percent and green otherwise, with only two states. [H3]
- **Chart.** The liquidation price is drawn as a dashed line in the negative (red) colour, labelled "Liq. Price". [H3]
- **No liquidation price.** The empty state reads "Position risk is low, so there is no liquidation price for the time being. Note that increasing the position or reducing the margin will increase the risk." [H2]
- **Order form labels:** "Est. Liquidation Price", "Order Value", "Margin Required", "Max Slippage". [H2]
  - The docs say the liquidation price estimated at entry "may be inaccurate compared to the position's estimated liquidation price due to changing liquidity". [H4]
- **Margin guidance:** "Decrease the chance of liquidation by adding more margin." [H2]

### 6.3 Transaction feedback

- **Placing an order.** "Click Place Order. Click Confirm in the modal that appears. You can check the 'Don't show this again' box". [H5]
- **Toasts:** "Order submitted", "Order filled", "Market order placed". [H2]
- **Deposits:** "Deposit pending", then "Deposit confirmed. Balance will update on the next block." [H2]
- **Errors:** [H2]
  - "Insufficient margin to place order. Try using reduce only."
  - "Order placed exceeds the max position size at your current leverage. Reduce leverage to increase your max position size."
  - "Generating signature failed {error}"

### 6.4 Wallet connection and wrong network

- **Connection:** "Connect" -> choose a wallet -> "Enable Trading" (a gasless signature). There is also an email login with a 6-digit code. [H5]
- **Related strings:** "Establish Connection", "Confirm in Wallet", "You must enable trading to modify orders." [H2]
- **Wrong network is handled in the action button itself:** "Switch to {chain} to Deposit", "Switch to {chain} to Transfer", "Switch to {chain} to Generate Signature". [H2]
- **Copy feedback:** "Copied to clipboard". [H2]

### 6.5 Vaults

- **Vault list:** APY and total deposits (TVL). [H6]
- **Vault page:** pnl, max drawdown, volume, open positions, trade history, depositors, a "Your Performance" view, and Deposit/Withdraw buttons. [H6]
- **Lock-ups:** HLP 4 days; user vaults 1 day. [H6]
- **Max drawdown formula** is documented as frontend-only. [H7]

### 6.6 Borrow and avoid

- **Borrow:**
  - Liq. Price as a first-class table column and a chart line.
  - A risk ratio with an explicit "liquidated at 100%" sentence.
  - Action-specific switch-network button labels.
  - "Balance will update on the next block" copy, which suits Monad's 300 ms blocks.
  - An explanation tooltip on every derived metric.
- **Avoid:**
  - Two-colour risk (green/red at 80 percent) with no amber band. Shield needs a distinct band between its trigger and Aave's 1.0.

---

## Patterns to adopt for Shield

Each item names the Shield screen it applies to and the sources it borrows from.

1. **Borrower position page: two cards side by side.**
   - "Aave position": collateral, debt, HF, liquidation price, current and oracle price.
   - "Shield protection": status, trigger, premium per block, prepaid balance, runway.
   - Euler's "Position summary / Position risk" split [E1] and Summer.fi's Protection tab [S4].
2. **HF number colours.**
   - Use Aave's own bands so Shield matches app.aave.com: red below 1.1, orange 1.1 to below 3, green 3 and up. Round down to 2 decimals; show ∞ when there is no debt [A4].
   - Apply one definition everywhere, unlike Aave's two [A4][A5].
3. **One HF track with three markers.**
   - Aave liquidation at 1.00 (red tick), the Shield trigger (for example 1.04) and the current HF pointer.
   - Draw it zoomed to roughly 1.0 to 2.0 rather than Aave's 0 to 10 scale [A7].
   - Label ticks the way DeFi Saver does [D4] and Aave's "Liquidation value" tick does [A7].
4. **Trigger picker: a slider with paired live readouts.**
   - Left: "Trigger HF 1.04". Right: "Exits if WETH falls below $X (at current debt)". Same pattern as Summer.fi's slider plus "Dynamic stop price" [S6].
   - Keep a numeric input for precision and put max discount behind an "Advanced" checkbox, as DeFi Saver does [D4][D9].
5. **"At exit" summary box under the picker.**
   - Rows: estimated debt repaid, collateral the vault takes (1.01 x), "Saving compared to Aave liquidation", premium per block now, max network fee.
   - Mark estimates "est." or "up to" and state the assumptions in a tooltip, like Summer.fi's "assumes a 2% difference ... Liquidation Penalty, currently set to ..." [S6][S7]. This is where SPEC's line "Aave penalty if liquidated: $X. Shield: $Y." goes.
6. **Inline opt-in nudge on the HF number:** "Exit early at HF 1.04 instead of being liquidated [Protect]", like DeFi Saver's "Enable liquidation protection at 105% [Protect]" [D1].
7. **Status badges and plain states.**
   - A "Shield ON/OFF" badge on the position card or tab [S4].
   - A full-width red "Unprotected: prepaid balance ran out" state using Morpho-style plain-English warnings [M6].
8. **Runway as a human number.**
   - Euler shows "Time to liquidation >1 year" [E1][E5]. Shield can show "Cover lasts about 3 d 4 h at the current premium", computed as balance / premium per block x 0.3 s.
   - Use sentinel strings (">30 days", "Ends this block") like Euler's TTL states [E6].
9. **Guardrails on the trigger:**
   - Block or warn when the trigger is at or above the current HF ("Shield would exit immediately"), mirroring Summer.fi's "Stop loss triggered immediately" [S9].
   - Require an acknowledgement checkbox when the trigger is very close to 1.0, mirroring Aave's "I acknowledge the risks involved." [A10][A11].
10. **Opt-in flow as numbered steps.**
    - Show the steps up front: 1. Approve aWETH (Executor), 2. Approve USDC (prepay), 3. Opt in and prepay. Tag each step "Separate tx" as euler-lite does [E10].
    - Use Aave's button labels per state: "Approve aWETH to continue", "Approving aWETH...", "Approve Confirmed ✓", "Wrong Network", "Enter an amount" [A19].
    - Show "Check your wallet" while the wallet prompt is open [M13].
11. **Transaction feedback.**
    - A toast with a short hash and an "Explorer ↗" action [M13]; a result view with "Review Transaction" and "Done" [A26].
    - Copy like Hyperliquid's "Balance will update on the next block" [H2]. With `eth_sendRawTransactionSync`, Shield can say "Confirmed in block N" right away.
12. **Network fee display.**
    - Show "Max network fee" as gas limit x price in MON and USD, because Monad charges the full limit. Comparable to Summer.fi's "Max transaction cost" [S6] and Aave's USD gas row [A24].
    - Warn when the MON balance is too low, using Aave's wording pattern [A24].
13. **Wrong network.** Let the primary button read "Switch to Monad to opt in" (Hyperliquid's pattern) [H2], on top of RainbowKit's built-in "Wrong network" chip [R1]. Attempt the switch automatically, with Aave's fallback copy [A31].
14. **Numbers and addresses.**
    - Compact above 99,999 and "<$0.01" for tiny values [A33][E14].
    - USD first with the token amount after "~" ("$412.10 ~ 0.12 WETH") [E1].
    - Exact values in a tooltip [E10][E14]; HF rounded down [A4].
    - Addresses as "0x1234...cdef" with copy ("Copied!") and "View more on explorer" [E14][R1].
15. **LP page, following Morpho's vault UX rules [M10][M11] and EulerEarn's page structure [E8]:**
    - Vault name and address.
    - "Variable" APY split into premium income and exit discount, each named in USDC.
    - TVL, share price, and instantly withdrawable liquidity next to accounting value ("Compare the accounting value of your shares with the amount currently available to withdraw").
    - An activity log of exits with discount captured.
    - A "Learn more" link.
16. **Read-only watch mode for judges.** A "View any address" box, like Aave's "Watch wallet" [A29] and Euler's "Viewing as 0x... Exit" banner [E1]. A judge can then open the demo borrower's live position without a wallet.
17. **Plain-English revert mapping with "Copy error text",** following Aave's error-code table [A35][A28]. Shield's own Executor reverts need it too, for example "HF after exit not above 1.0".
18. **Explain every derived metric in a tooltip** (premium formula inputs, runway, saving), as Hyperliquid does for every account row [H2][H3].

## Avoid list

1. **Two different colour definitions for the same HF** (Aave's number vs. modal edges at 1.1 and 3) [A4][A5].
2. **A calm-looking UI near liquidation.** Euler's docs screenshot shows HF 1.05 in plain white and a teal LTV bar at 91 of 96 percent [E1]. Shield's whole product sits in the 1.0 to 1.1 zone, so that zone must be visually loud.
3. **A risk scale where the danger zone is a sliver** (Aave's linear 0 to 10 HF bar) [A7].
4. **Two-state risk colours** with no amber band (Hyperliquid's green/red at 80 percent) [H3].
5. **Blended headline yield** on the LP page. Morpho says users read one number as "will land in their wallet as the deposit asset" [M11].
6. **Fee copy that disagrees with the docs** (DeFi Saver: 0.3 percent in the in-app banner screenshot vs. 0.05 percent in the fee page) [D4][D12]. Shield's fee lines must be generated from the same source as the contracts.
7. **Price-only triggers** that silently go stale when the position changes. Summer.fi chose ratios for this reason [S7]. Show the price as derived "at current debt".
8. **Overstating protection.** Summer.fi listed keeper, gas, liquidity and oracle risks openly [S7]. Shield should state that it triggers above 1.0, does not race liquidators, and that the keeper is permissionless and best-effort.
9. **Vault NAV that counts donatable or stale-priced assets** (Lazy Summer, 6 Jul 2026, about $6M) [S3][S12]. Shield's LP page should show NAV components (USDC on hand, seized aTokens at oracle value, premium accrued) instead of a single opaque share price.
10. **Full-precision nine-digit numbers in tables** ("$528,165,244.77") [M6]. Use compact notation, with exact values on hover.
11. **Fork or simulation modes in anything a judge sees.** DeFi Saver's Simulation Mode is a fork with frozen prices [D18], and Shield's CLAUDE.md forbids forks in the demo. Aave's "Fork mode is ON" banner [A32] shows how such a mode would need flagging if one ever existed.
12. **Requirements that block execution only in the fine print** (DeFi Saver's debt floor below which automation "will not execute") [D13]. If Shield has a minimum (for example a minimum prepaid balance or debt size), show it at opt-in and on the status card.

## Not verified (needs a connected wallet or a live session)

- Morpho main app: the borrow position panel layout, HF colour thresholds, deposit panel labels ("you will receive" wording), and wallet and wrong-network handling.
- Euler: health score colour thresholds and the wrong-network flow in the main app.
- Aave Pro (V4): any visual detail beyond "deposited, borrowed, health factor".
- Hyperliquid: number formatting beyond 2-decimal percentages, and actual layout density. Strings came from the bundle, not from seeing the screen.
- Summer.fi: wallet and network handling, and the live trigger-fee breakdown. The UI is offline.
- DeFi Saver: wallet connection modal and wrong-network copy.

---

## Sources

### Aave
- [A1] https://github.com/aave/interface/blob/main/src/modules/dashboard/DashboardTopPanel.tsx
- [A2] https://github.com/aave/interface/blob/main/src/modules/dashboard/lists/SuppliedPositionsList/SuppliedPositionsList.tsx
- [A3] https://github.com/aave/interface/blob/main/src/modules/dashboard/lists/BorrowedPositionsList/BorrowedPositionsList.tsx
- [A4] https://github.com/aave/interface/blob/main/src/components/HealthFactorNumber.tsx
- [A5] https://github.com/aave/interface/blob/main/src/modules/dashboard/LiquidationRiskParametresModal/LiquidationRiskParametresModal.tsx
- [A6] https://github.com/aave/interface/blob/main/src/modules/dashboard/LiquidationRiskParametresModal/components/InfoWrapper.tsx
- [A7] https://github.com/aave/interface/blob/main/src/modules/dashboard/LiquidationRiskParametresModal/components/HFContent.tsx
- [A8] https://github.com/aave/interface/blob/main/src/modules/dashboard/LiquidationRiskParametresModal/components/LTVContent.tsx
- [A9] https://github.com/aave/interface/blob/main/src/components/transactions/FlowCommons/TxModalDetails.tsx
- [A10] https://github.com/aave/interface/blob/main/src/components/transactions/Borrow/BorrowModalContent.tsx
- [A11] https://github.com/aave/interface/blob/main/src/components/transactions/Borrow/BorrowAmountWarning.tsx
- [A12] https://github.com/aave/interface/blob/main/src/components/transactions/Swap/warnings/helpers.ts and https://github.com/aave/interface/blob/main/src/components/transactions/Swap/constants/shared.constants.ts
- [A13] https://github.com/aave/interface/blob/main/src/components/transactions/Swap/warnings/postInputs/LowHealthFactorWarning.tsx
- [A14] https://github.com/aave/interface/blob/main/src/components/transactions/Swap/warnings/postInputs/LiquidationCriticalWarning.tsx
- [A15] https://github.com/aave/interface/blob/main/src/components/infoTooltips/LiquidationPenaltyTooltip.tsx
- [A16] https://github.com/aave/interface/blob/main/src/modules/reserve-overview/ReserveTopDetails.tsx
- [A17] https://github.com/aave/interface/blob/main/src/modules/reserve-overview/SupplyInfo.tsx
- [A18] https://github.com/aave/interface/blob/main/src/modules/reserve-overview/ReserveActions.tsx
- [A19] https://github.com/aave/interface/blob/main/src/components/transactions/TxActionsWrapper.tsx
- [A20] https://aave.com/blog/aave-pro-user-guide
- [A21] https://github.com/aave/interface/blob/main/src/components/transactions/FlowCommons/RightHelperText.tsx
- [A22] https://github.com/aave/interface/blob/main/src/store/walletSlice.ts (ApprovalMethod: 'Transaction', 'Signed message')
- [A23] https://github.com/aave/interface/blob/main/src/components/infoTooltips/ApprovalTooltip.tsx
- [A24] https://github.com/aave/interface/blob/main/src/components/transactions/GasStation/GasStation.tsx
- [A25] https://github.com/aave/interface/blob/main/src/components/transactions/FlowCommons/TxResultView/index.tsx
- [A26] https://github.com/aave/interface/blob/main/src/components/transactions/FlowCommons/TxResultActions/index.tsx
- [A27] https://github.com/aave/interface/blob/main/src/components/transactions/FlowCommons/Success.tsx
- [A28] https://github.com/aave/interface/blob/main/src/components/transactions/FlowCommons/Error.tsx and https://github.com/aave/interface/blob/main/src/components/transactions/FlowCommons/GasEstimationError.tsx
- [A29] https://github.com/aave/interface/blob/main/src/components/WalletConnection/ReadOnlyModal.tsx
- [A30] https://github.com/aave/interface/blob/main/package.json
- [A31] https://github.com/aave/interface/blob/main/src/components/transactions/Warnings/ChangeNetworkWarning.tsx
- [A32] https://github.com/aave/interface/blob/main/src/layouts/AppHeader.tsx
- [A33] https://github.com/aave/interface/blob/main/src/components/primitives/FormattedNumber.tsx
- [A34] https://github.com/aave/interface/blob/main/src/helpers/text-center-ellipsis.ts
- [A35] https://github.com/aave/interface/blob/main/src/ui-config/errorMapping.tsx

### Morpho
- [M1] https://web.archive.org/web/2025/https://morpho.org/faq/ (the live FAQ URL returned 404 on 5 Oct 2026)
- [M2] https://docs.morpho.org/developers/borrow/concepts/ltv
- [M3] https://github.com/morpho-org/morpho-lite-apps/blob/main/apps/lite/src/components/borrow-sheet-content.tsx (repo archived May 2026)
- [M4] https://app.morpho.org/ethereum/variable/0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49/usdc-wbtc (SSR text)
- [M5] https://morpho.org/blog/introducing-risk-warnings-transitioning-to-a-permissionless-interface/
- [M6] https://app.morpho.org/ethereum/earn (SSR text)
- [M7] https://paragraph.com/@morpho/introducing-pre-liquidations-enhanced-loan-management-on-morpho and https://github.com/morpho-org/pre-liquidation
- [M8] https://docs.morpho.org/learn/concepts/liquidation
- [M9] https://app.morpho.org/ethereum/vault/0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB/steakhouse-usdc (SSR text)
- [M10] https://docs.morpho.org/developers/earn/vault-ux/ux-requirement
- [M11] https://docs.morpho.org/developers/earn/vault-ux/best-practices
- [M12] https://docs.morpho.org/learn/concepts/bundles
- [M13] https://github.com/morpho-org/morpho-lite-apps/blob/main/packages/uikit/src/components/transaction-button.tsx
- [M14] https://www.satsterminal.com/blog/how-to-borrow-on-morpho-a-complete-morpho-blue-guide-for-2026
- [M15] https://app.morpho.org/ethereum/borrow (SSR text)

### Euler
- [E1] https://docs.euler.finance/img/use/positionPage.png (screenshot), shown on https://docs.euler.finance/use/managing-positions
- [E2] https://docs.euler.finance/img/use/liquidation.png (screenshot), shown on https://docs.euler.finance/use/portfolio
- [E3] https://docs.euler.finance/img/use/positions.png (screenshot), shown on https://docs.euler.finance/use/portfolio
- [E4] https://docs.euler.finance/use/portfolio
- [E5] https://docs.euler.finance/llms-full.txt (glossary: TTL, Health score)
- [E6] https://github.com/euler-xyz/euler-lite/blob/development/utils/ltv.ts
- [E7] https://docs.euler.finance/learn/liquidations
- [E8] https://docs.euler.finance/use/euler-earn
- [E9] https://docs.euler.finance/img/use/apyBreakdown.png (screenshot), shown on https://docs.euler.finance/use/borrow-risk
- [E10] https://github.com/euler-xyz/euler-lite/blob/development/components/entities/operation/OperationStepsList.vue
- [E11] https://github.com/euler-xyz/euler-lite/blob/development/components/entities/operation/OperationReviewModal.vue
- [E12] https://docs.euler.finance/use/getting-started
- [E13] https://docs.euler.finance/use/borrow-assets
- [E14] https://github.com/euler-xyz/euler-lite/blob/development/utils/string-utils.ts

### Summer.fi
- [S1] https://web.archive.org/web/2026/https://blog.summer.fi/summer-fi-goes-all-in-on-lazy-summer-protocol-as-summer-pro-transitions-to-defi-saver/
- [S2] https://cryip.co/summer-fi-to-wind-down-after-6-04-million-vault-exploit/
- [S3] https://www.coindesk.com/web3/2026/07/06/defi-protocol-summer-fi-halts-lazy-summer-vaults-after-usd6-million-exploit
- [S4] https://web.archive.org/web/20260119123122/https://docs.summer.fi/summer.fi-pro/automation/stop-loss (screenshots "WBTC/USDC Multiply #187", "Stop-Loss ON")
- [S5] same page as [S4] (screenshots of the Stop-Loss ON card and "Est. ETH on stop loss trigger")
- [S6] https://web.archive.org/web/20260119104142/https://docs.summer.fi/summer.fi-pro/automation/stop-loss/how-to-setup-your-stop-loss (screenshot "Aave ETH/USDC", Protection OFF with setup panel)
- [S7] https://web.archive.org/web/20260119123122/https://docs.summer.fi/summer.fi-pro/automation/stop-loss (FAQ text and flow diagram)
- [S8] https://web.archive.org/web/2025/https://docs.summer.fi/summer.fi-pro/automation/auto-sell
- [S9] https://github.com/OasisDEX/summerfi-monorepo/blob/dev/summerfi-api/setup-trigger-function/src/services/against-position-validators/dma-aave-stop-loss-validator.ts
- [S10] https://github.com/OasisDEX/summerfi-monorepo/blob/dev/summerfi-api/setup-trigger-function/src/services/against-position-validators/aave-auto-sell-validator.ts
- [S11] https://web.archive.org/web/2025/https://blog.summer.fi/what-is-stop-loss-on-aave/
- [S12] https://www.bankless.com/read/news/lazy-summer-protocol-drained-of-6m-in-vault-price-exploit

### DeFi Saver
- [D1] https://help.defisaver.com/automations/liquidation-protection (screenshot of the Aave overview with the "Protect" toggle)
- [D2] https://help.defisaver.com/protocols/aave-v3/dashboard-and-use-case
- [D3] https://help.defisaver.com/features/defi-saver-dashboard/health-safety-and-collateral-ratio
- [D4] https://help.defisaver.com/automations/automated-leverage-management (screenshots)
- [D5] https://help.defisaver.com/automations/liquidation-protection (screenshot of the setup bar)
- [D6] https://help.defisaver.com/protocols/aave-v3/dashboard-and-use-case (E-Mode modal screenshot)
- [D7] https://help.defisaver.com/automations/liquidation-protection (screenshot of the Automate tab list)
- [D8] https://help.defisaver.com/automations/liquidation-protection
- [D9] https://help.defisaver.com/automations/automated-leverage-management
- [D10] https://help.defisaver.com/automations/stop-loss-take-profit
- [D11] https://help.defisaver.com/protocols/aave-v3/dashboard-and-use-case ("Position created" modal screenshot)
- [D12] https://help.defisaver.com/automations/fees
- [D13] https://help.defisaver.com/automations/requirements-for-using-automation
- [D14] https://help.defisaver.com/protocols/aave-v3/how-does-aave-automation-work
- [D15] https://help.defisaver.com/automations/when-are-automation-transactions-made
- [D16] https://help.defisaver.com/protocols/aave-v3/dashboard-and-use-case ("Migrate between Smart Wallets" screenshot)
- [D17] https://help.defisaver.com/protocols/aave-v3/dashboard-and-use-case ("Close Aave v3 Core" screenshot)
- [D18] https://help.defisaver.com/features/simulation-mode

### Hyperliquid
- [H1] https://app.hyperliquid.xyz/assets/config-DWzED1yW.js (positions table column definition; fetched 5 Oct 2026, filename changes per deploy)
- [H2] https://app.hyperliquid.xyz/assets/en-US-tcpUKlLA.js (English UI string table; fetched 5 Oct 2026)
- [H3] https://app.hyperliquid.xyz/assets/index-VjaZKeGd.js (account panel rows, margin-ratio colour rule `k>.8 ? red : green`, "Liq. Price" chart line; fetched 5 Oct 2026)
- [H4] https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations
- [H5] https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/how-to-start-trading
- [H6] https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-depositors-legacy
- [H7] https://hyperliquid.gitbook.io/hyperliquid-docs/trading/miscellaneous-ui

### RainbowKit (Shield's chosen wallet kit, for the built-in strings Shield gets for free)
- [R1] https://github.com/rainbow-me/rainbowkit/blob/main/packages/rainbowkit/src/locales/en_US.json ("Wrong network", "Wrong network detected, switch or disconnect to continue.", "Copy Address", "Copied!", "View more on explorer", "Recent Transactions")
