/**
 * Shield's cartoon component kit (design/prototype). Server-safe: Level, Sticker, Pill, SampleTag, Card, QuietPanel,
 * Callout, CartoonIcon, FuelBar, Disclosure, NerdGrid, ComicStrip, MascotFace. The rest are client components.
 * Styles live in cartoon.css, loaded once by app/globals.css.
 */
export { Mascot, type MascotMotion } from "./mascot";
export { MascotFace, MascotParts, MASCOT_MOODS, type MascotMood } from "./mascot-art";
export { Level, LevelFloat, type LevelProps, type LineMode } from "./level";
export { Sticker, Pill, SampleTag, type StickerTone } from "./sticker";
export { Card, QuietPanel, Callout, type CardTone } from "./card";
export { CartoonButton, cartoonButtonClass } from "./button";
export { ChoiceCards, type ChoiceOption } from "./choice-cards";
export { ProgressTrack } from "./progress-track";
export { CountdownRing } from "./countdown-ring";
export { Confetti } from "./confetti";
export { Burst, CountUp } from "./burst";
export { BlockTicker, LiveBlockTicker, BlockChip, LiveBlockChip, RollingDigits, type TickerBlock } from "./block-ticker";
export { useChainBlocks, isStale, type BlockMark, type ChainBlocks } from "./chain-blocks";
export { ComicStrip, REAL_LIQUIDATION } from "./comic-strip";
export { Disclosure, NerdGrid } from "./disclosure";
export { FuelBar } from "./fuel-bar";
export { CartoonIcon, type CartoonIconName } from "./icons";
export { AmountField, AmountHint, amountFieldClass } from "./amount-field";
export { usd0, usd2, pct1, int } from "./fmt";
export { useReducedMotion, prefersReducedMotion } from "./motion";
