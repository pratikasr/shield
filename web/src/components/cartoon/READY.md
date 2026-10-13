# Cartoon kit: ready to use

Import everything from `@/components/cartoon`. Styles are global (cartoon.css via app/globals.css); nothing to import.
Server-safe (no hooks): Level, LevelFloat, Sticker, Pill, SampleTag, Card, QuietPanel, Callout, CartoonIcon, FuelBar,
Disclosure, NerdGrid, ComicStrip, MascotFace. The rest are client components.

## Tokens (Tailwind 4 classes)

- Colours: `bg-sky` (page), `bg-sky-2` (quiet panels), `bg-cloud` (cards), `text-ink`, `text-ink-soft` (secondary),
  `bg-grape` / `text-grape-ink` (Grape as text) / `bg-grape-tint`, `bg-chill` / `bg-chill-tint`, `bg-heads` /
  `bg-heads-tint`, `bg-lava` / `bg-lava-deep` / `bg-lava-tint`, `bg-grey-tint`. Status colours are fills behind Ink
  text, never coloured text.
- Shape: `ink-line` (2.5 px Ink border), `ink-line-2` (2 px), `shadow-sticker` (4 px), `shadow-sticker-sm` (3 px),
  `shadow-sticker-xs` (2 px), `shadow-ledge`; radii `rounded-card` 18, `rounded-btn` 14, `rounded-level` 24,
  `rounded-sticker` 12, `rounded-comic` 8.
- Type: `font-display` (Lilita One: headlines, status words, preset names; never numbers). Body and every number are
  Rubik with tabular figures by default. h1 to h4 are Lilita already. Helper classes: `c-h1-app` (36 to 52 px app
  headline), `c-h2`, `c-h3`, `c-small`, `c-muted`, `c-link`, `c-wrap` (1180 px page width with gutters).
- Write apostrophes as `&rsquo;` (Lilita's straight quote is wide). No em-dashes.
- Version 2 class names (`bg-card`, `text-muted-foreground`, `text-safe`, `panel`...) still work as aliases onto
  the new palette, so nothing breaks while you move over.

## Components

| Component | Props | Usage |
| --- | --- | --- |
| `Mascot` | `mood` (hello, chill, careful, danger, guard, arming, saved, tired, sleepy, confused, curious), `size` px, `motion` (squash, jump, shake, none) played on mood change or `playKey` change, `playOnMount`, `still`, `label` | `<Mascot mood="guard" size={120} />` |
| `MascotFace` | `className`, `title` | `<MascotFace className="size-8" />` |
| `Level` | `now`, `aave`, `line`, `lineMode` (preview, on, arming, off, blocked, hidden), `lineLabel`, `mood`, `mascotMotion`, `mascotPlayKey`, `size` (hero, compact), `scale {top,bottom}`, `ghost` (old Aave line), `ribbon`, `slab`, `asset`, `showRuler`, `showLavaTag`, `dim`, `live`, `flashKey`, `playerOverlay`, `label` | `<Level now={2716} aave={2539} line={2640} lineMode="on" mood="guard" size="compact" />` |
| `LevelFloat` | `kind` (up, away), children | `playerOverlay={<LevelFloat kind="up">Pays back $26</LevelFloat>}` |
| `Sticker` | `tone` (safe, careful, danger, protected, saved, lowfuel, blocked, out, arming, none), `tilt` (left, right, none), `size` (md, small), `pop` | `<Sticker tone="protected" pop>Protected</Sticker>` |
| `Pill` | `dot` (on, off, warn, bad), `tone` (cloud, grape, sky), `wrap`, `title` | `<Pill dot="on">Shield is on</Pill>` |
| `SampleTag` | children (default "Example") | `<SampleTag>Example numbers</SampleTag>` |
| `Card` | `as`, `tone` (cloud, grape, chill, heads, lava, sky), `pad` (md, tight, none), `id`, `aria-*`, `role` | `<Card tone="chill">...</Card>` |
| `QuietPanel` | `as`, `className` | `<QuietPanel>...</QuietPanel>` |
| `Callout` | `tone` (heads, lava, grape, chill, cloud), `icon`, `title`, `role`, `shake` | `<Callout tone="heads" icon={<CartoonIcon name="battery" />} title="Add fuel to keep Shield on">...</Callout>` |
| `CartoonButton` (= `Button` from `@/components/ui/button`) | `variant` (primary, secondary, quiet, green, yellow, lava; v2: default, outline, ghost, link, destructive), `size` (default, small, big = full width, icon; v2: sm, lg), `loading`, `loadingText`, `asChild` | `<CartoonButton size="big" loading={busy} loadingText="Waiting for your wallet">Turn on Shield</CartoonButton>` |
| `ChoiceCards` | `options [{value, name, big, sub, cost, note, disabled, ariaLabel}]`, `value`, `onChange`, `label` or `labelledBy`, `variant` (cards, pills), `columns` | `<ChoiceCards labelledBy="q1" options={presets} value={id} onChange={setId} />` |
| `ProgressTrack` | `steps [{label}]`, `current` (index in progress; steps.length = all done), `mood`, `label` | `<ProgressTrack steps={[{label:"Allow ETH"},{label:"Allow USDC"},{label:"Add fuel"},{label:"Switch on"}]} current={1} />` |
| `CountdownRing` | `totalSeconds`, `secondsLeft` (controlled) or `endsAt` (browser ms, self-ticking), `onDone`, `label`, `size` | `<CountdownRing totalSeconds={900} endsAt={armsAtMs} />` |
| `Confetti` | `fire` (fires on each new truthy value), `origin` (ref or {x,y}), `count` | `<Confetti fire={exitTx} origin={keptRef} />` |
| `Burst` | children (default "Nice save") | inside a `relative` card: `<Burst />` |
| `CountUp` | `value`, `format`, `durationMs` | `<CountUp value={1.17} format={usd2} />` |
| `FuelBar` | `level` 0 to 1, `tone` (ok, low, out), `blink`, `label` | `<FuelBar level={0.6} label="Paid up for about 3 months" />` |
| `Disclosure` | `summary` (default "Stats for nerds"), `note`, `open` | `<Disclosure note="From Aave, Pyth and Shield's contracts."><NerdGrid rows={rows} /></Disclosure>` |
| `NerdGrid` | `rows [[label, value]]` | `<NerdGrid rows={[["Health factor", "1.07"]]} />` |
| `BlockTicker` | `blocks [{number, txs?}]` newest first, `marks {[block]: {count, txHash, kind}}` (stamp only real Shield txs), `label` | `<BlockTicker blocks={stream.blocks} marks={marks} />` |
| `LiveBlockTicker` | `caption(state)` render prop | `<LiveBlockTicker caption={(s) => ...} />` (polls Monad and reads Repriced and Exited logs itself; no wallet providers needed) |
| `BlockChip` | `block`, `tone` (live, warn, off), `name`, `title` | `<BlockChip block={block} tone="live" />` |
| `useChainBlocks()` | returns `{blocks, latest, seenAt, failed, marks, marksAvailable}` | shared poller behind the live ticker |
| `ComicStrip` | `className` | `<ComicStrip />` (verified numbers and the MonadVision link built in; `REAL_LIQUIDATION` holds them) |
| `CartoonIcon` | `name` (check, line, fuel, lock, warn, code, flask, hand, clock, battery, wallet, coin, chain, shield), `size` | `<CartoonIcon name="fuel" size={32} />` |
| `AmountField`, `AmountHint` (= data/amount-input) | as before | `<AmountField id="amt" value={v} onChange={setV} onMax={max} />`; `amountFieldClass` styles any input |
| Formatters | `usd0`, `usd2`, `pct1` (takes 6.5 for 6.5%), `int` | `usd0(2716)` gives "$2,716" |
| Motion | `useReducedMotion()`, `prefersReducedMotion()` | skip count-ups and confetti when true |

Shell (owned by the foundation builder): `/app/*` pages get the cartoon header (Protect, Vault, Stats; Stats links to
`/app/stats`), the stale and wrong-network banners and the ground footer from `app/app/layout.tsx`. `<main>`
already gives the 1180 px page width with 28 px gutters (16 px on phones), 24 px on top and 72 px below: do not add
another wrapper or `c-wrap`.
`components/data/stat.tsx` `Panel` and `Stat`, `Chip`, `HashLink`, `Info`, `TokenIcon` and the shadcn `Tabs`,
`Slider`, `Tooltip`, `Skeleton` keep their APIs and are restyled.
