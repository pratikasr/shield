# Shield prototype: "Sticker arcade"

A clickable design prototype for the cartoon redesign of Shield. It is static HTML, CSS and a small vanilla script: no build step, no libraries, only Google Fonts. Every number in it is a sample and is tagged "Sample numbers" on screen. It exists so the owner can approve the direction before `web/` is rebuilt.

## How to open it

From the repo root:

```
npx -y http-server design/prototype -p 4400 -s
```

Then open http://127.0.0.1:4400/. Opening `design/prototype/index.html` directly as a file also works.

| Route | What it is |
| --- | --- |
| `#/` | Landing |
| `#/protect` | Borrower page. A dashed yellow strip at the top, "Prototype: switch state", jumps between every state (a dropdown on phones) |
| `#/protect/<state>` | One state directly: `disconnected`, `noloan`, `setup`, `turning`, `arming`, `protected`, `lowfuel`, `outoffuel`, `blocked`, `steppedin` |
| `#/protect/blocked/<reason>` | The blocked state for `approval`, `emode`, `oracle`, `ltv0` or `discount` |
| `#/vault`, `#/vault/treasury` | The vault, seen by anyone or by the treasury wallet |
| `#/stats` | Scoreboard, block ticker, comic strip, next lenders |

## The idea in one line

Your loan is a game level. ETH's price is the platform you stand on, Aave's liquidation price is the lava, and Shield's line sits in between. A shield mascot stands on the platform, and its face tells you how things are going.

## Tokens

### Colour

| Name | Hex | Use |
| --- | --- | --- |
| Sky | `#CBE7FF` | Page background |
| Sky 2 | `#E2F2FF` | Inside the level, quiet panels |
| Sky deep | `#9FCFF5` | Cloud shade, transaction dots in the ticker |
| Cloud | `#FFFFFF` | Cards |
| Ink | `#1B1430` | Text, outlines, hard shadows |
| Ink soft | `#4A4363` | Secondary text (7.2:1 on Sky, 9:1 on Cloud) |
| Grape | `#6A4CF5` | Main buttons, the mascot, Shield's line (white text on it 5.3:1) |
| Grape ink | `#4630C2` | Grape when it is text on Sky or Cloud (6.7:1 on Sky) |
| Grape tint | `#E7E1FF` | Selected cards, the arming sticker |
| Chill | `#2FD47F` | Safe, Protected, Saved, money kept (always a fill with Ink text, 9.1:1) |
| Heads-up | `#FFC93C` | Careful, Low fuel, Blocked, comic captions (fill with Ink text) |
| Lava | `#FF5A4E` | Aave's line, Danger, Out of fuel (fill with Ink text, 5.7:1) |
| Lava deep | `#E2402F` | Lower lava band, the ghost of Aave's old line |
| Cheek | `#FF9BD8` | Mascot cheeks and tongue only |

Status colours are always fills behind Ink text, never coloured text on white.

### Type

- **Lilita One** for headlines, status words in stickers and preset names. Words only, never numbers (it has no tabular figures).
- **Rubik** 400 to 800 for body text and every number, with `font-variant-numeric: tabular-nums` so per-block numbers do not jitter.
- System monospace only for transaction hashes.
- Scale: h1 46 to 80 px (landing), 36 to 52 px (app headlines), h2 34 to 50 px, h3 26 px, body 17 px, small 14.5 px. Sentence case everywhere. Apostrophes are set as typographic quotes because Lilita's straight quote is wide.

### Shape

- Outlines 2.5 px Ink on containers and the mascot only. Text, icons and dividers stay clean.
- Hard shadows: cards `4px 4px 0` Ink; small stickers `3px 3px 0`.
- Buttons have a ledge, `0 5px 0` Ink, and press down 5 px when clicked.
- Radii by role: cards 18 px, buttons 14 px, the level 24 px, stickers 12 px, chips full pill, comic panels 8 px with a slight tilt.
- Stickers (status words) sit at -3 degrees.

### Motion

| Moment | What moves | Timing |
| --- | --- | --- |
| Landing load (the one orchestrated moment) | Copy rises in; the lava rises; Shield's line draws across; the mascot drops onto the platform and squashes; then ETH falls, the mascot sweats, Shield steps in at the line, "Pays back $26" and "Takes ETH worth $26.26" float off, the lava sinks to the new Aave line, the mascot cheers. "Play it again" replays it | About 9 s once, then still |
| Mascot idle | Bob 4 px; blink at a random offset | 3.6 s loop; blink 120 ms every 5.2 s |
| Mood change | Squash and settle | 420 ms, `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| Picking a preset | Shield's line glides to the new price; the card lifts; a check sticker pops in | 300 ms ease-out |
| Button press | Face drops 5 px onto its ledge | 90 ms |
| Turning on | Track fills; the small mascot hops to the next stop; the step's check stamps in | 450 to 520 ms |
| Arming | 15:00 ring counts down every second | 1 s linear |
| Low fuel | Fuel bar blinks three times, then holds | 400 ms x 3 |
| Out of fuel | Mascot and warning shake once | 300 ms |
| Shield stepped in | Confetti burst, mascot jumps, "Nice save" starburst spins in, "You kept" counts up | 1.1 to 1.8 s confetti, 900 ms count-up |
| Block ticker | A new block tile every 0.3 s slides in; Shield's check stamp lands in it; header block number rolls only the changed digits | 260 ms slide, 320 ms stamp, 150 ms digits |
| Lava | Slow wave and a few bubbles | 7 s and 3.4 s loops |

`prefers-reduced-motion: reduce` stops every loop, skips the landing story straight to its end state, turns off confetti and shows numbers without counting.

## Screens and states

**Landing:** the promise ("The floor is lava. Shield steps in first."), the animated level that tells the whole story, three steps on a dotted level map, the real Aave Monad liquidation as a four-panel comic (22 Aug 2026, block 98,106,057, $87.98 extra against $16.71 with Shield, linked to the transaction on MonadVision), built for Monad with a live block ticker, straight talk (open source, tested on real Aave, not audited yet, best effort), FAQ, final call to action.

**Protect**, each with one main button, answering in order: am I safe, when does Shield step in and what happens, what does it cost.

| State | Mascot | What it says |
| --- | --- | --- |
| Not connected | Waving | "Is your Aave loan safe?" Connect wallet, or check any wallet read only. Example level, dimmed |
| No Aave loan | Curious | Which loans Shield covers and how to open one; eMode note |
| Not protected | Sweating | "Careful. ETH can fall 6.5% before Aave liquidates you." Three line cards (Early, Balanced, Last call: ETH price, drop, cost a month), three fuel cards, USDC on Monad or another chain, one "Turn on Shield" button |
| Turning on | Strapped in, clock | Level map of four stops (three from another chain), what each wallet prompt is for, simulated wallet wait |
| Arming | Clock | 15:00 countdown ring and why the wait exists |
| Protected | Determined, star lit | "Shield is on." Line, what happens, cost a month, fuel bar, Add fuel / Change when / Turn off |
| Low fuel | Tired | "About 5 days left", one Add fuel button |
| Out of fuel | Grey, asleep | "Out of fuel. Shield is off." One Add fuel button |
| Something blocks the exit | Confused | What is wrong and the one fix, for five reasons |
| Shield stepped in | Cheering | "You kept $1.17", what happened as a receipt, the transaction, the loan now, Protect again |

"Stats for nerds" holds the health factor, Aave's and Pyth's prices, the threshold, volatility, cost per block and contracts.

**Vault:** the protocol's own pot, three numbers (in the vault, rescues paid for, earned so far), where its money comes from, the two risks, and deposits closed to everyone but the treasury (switch to the treasury view to see its controls).

**Stats:** four-number scoreboard with times in plain words, the living block ticker, the comic strip, and other Monad lenders as locked levels.

## Why these choices

- **Sky, not cream.** The research proposed a warm cream page. Warm cream is the most common default of generated designs, and it does nothing for this product. The safety picture is a platformer level, and platformers happen in the sky: a sky page makes the whole app that level, so the lava reads as "down there" without a label. Pale blue is in Monad's secondary palette without copying its system, every Monad DeFi app is dark, and the purple mascot stands out on it. A lilac page would have put a purple mascot on purple.
- **One memorable thing.** The mascot on the price platform, the "to the lava" ruler and the lava are the product's one big idea. Everything else is plain white cards, Ink outlines and Rubik numbers.
- **Cartoon for state, plain numbers for facts.** Lilita carries words and moods; every dollar figure is Rubik with tabular figures. No health factor, chart or slider on the main surface.
- **The ruler.** A dashed bracket from the platform to the lava says "6.5% to the lava": distance to liquidation at a glance, the one number a borrower needs.
- **Preset cards.** Three lines and three fuel amounts as cards, each with its dollars, then one button. Fuel cards respect the $1 minimum prepay: on a small loan where $1 already buys months, the first card becomes "Minimum" and the others move to longer periods, so two cards never show the same price.
- **After a rescue, Shield's line goes away.** `PositionRegistry.markExited` closes the record, so the stepped-in screen says Shield is off until you set a new line, and the landing story retires the line after the rescue.
- **A ghost of Aave's old line** on the stepped-in level shows that paying back part of the loan pushed the lava down.
- **Honesty stays visible.** "Not audited yet" is the first sticker on the landing page, best effort is spelled out, and the footer disclaimer is unchanged. No "guaranteed", no "never get liquidated".
- **Aurora Intents** appears only as "From another chain" in the fuel step, not in the partner row, until the cross-chain demo is confirmed.

## Sample numbers

All derived from one example loan: 0.05 ETH collateral, 106.61 USDC borrowed, ETH at $2,716, health factor 1.0699. The ETH price at a health factor h is `2716 x h / 1.0699`, so Aave's line is $2,539 (6.5% down), Early (1.06) $2,691, Balanced (1.04) $2,640, Last call (1.02) $2,589. Yearly costs $10.66, $3.55 and $2.14. The sample rescue repays $26.00 and takes ETH worth $26.26; Aave's liquidators would take $27.43 for the same repayment, so the borrower keeps $1.17. On the real pages every number comes from the hooks listed in the redesign brief.

## Files

- `index.html`: shell (header, footer, fonts).
- `styles.css`: tokens, components, pages, keyframes, reduced motion.
- `app.js`: sample data, the mascot builder (one SVG, parts swapped per mood), the level, routes and states, motion.
- `assets/favicon.svg`, `assets/mascot-*.svg`: the mascot in five moods, exported from the same builder for reuse.
