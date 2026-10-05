import { ArrowRight, Check, Code2, Eye, FileCheck2, Gauge, KeyRound, Minus, ScanSearch, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { LendersStrip } from "@/components/analytics/lenders";
import { TokenIcon } from "@/components/data/token";
import { HeroShot } from "@/components/landing/hero-shot";
import { SavingsCalculator } from "@/components/landing/savings-calculator";
import { DOCS, REPO, SiteFooter } from "@/components/shell/footer";
import { ThemeToggle } from "@/components/shell/theme";
import { Wordmark } from "@/components/shell/wordmark";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#compare", label: "Compare" },
  { href: "#security", label: "Security" },
  { href: "#faq", label: "Questions" },
];
const DOCS_LINK = DOCS.readme;
/** External links open in a new tab and send no referrer. */
const EXT = { target: "_blank", rel: "noreferrer" } as const;

type Cell = string | boolean;
const comparison: { row: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  { row: "Covers Aave V3", cells: [true, false, false, true] },
  { row: "Available on Monad", cells: [true, true, true, false] },
  { row: "What happens at the trigger", cells: ["A vault repays part of the debt and takes collateral at a 1% discount", "Any liquidator repays at the market's pre-liquidation incentive", "Liquidators bid in a reverse Dutch auction from a 0% discount", "Your own collateral is swapped to repay debt"] },
  {
    row: "Cost to the borrower",
    cells: [
      "A premium per block, plus 1% of what is repaid",
      "The pre-liquidation incentive",
      "A discount that rises as health worsens",
      "About 0.3% per automated repay (0.25% service fee plus 0.05% automation fee), plus gas and slippage",
    ],
  },
  { row: "Who funds the exit", cells: ["Vault LPs, with an Aave flash loan as fallback", "Any liquidator", "Any liquidator", "Your collateral"] },
  {
    row: "Best when",
    cells: [
      "You want an exit enforced on chain at a trigger you set, at a known 1%, without watching the market; larger positions and moments when liquidity thins",
      "You borrow on Morpho",
      "You borrow on Euler",
      "You borrow on a chain it supports and want your own collateral sold to repay",
    ],
  },
];

const faqs: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is Shield audited?",
    a: "Not yet. Shield was built for Monad Metropolis 2026. The contracts have unit, fuzz, invariant and fork tests against real Aave on Monad, and every high and medium finding from Slither and Aderyn is fixed or explained in the open. That is not an audit; use amounts you can afford to lose.",
  },
  {
    q: "What can the owner change?",
    a: "Parameters within set bounds: the exit discount (at most 5% and never above your maximum), the exit buffer, the premium floor, each collateral's pricing constant (at most ten times the launch value) and fallback volatility (10% to 500%), the waiting period (up to 7 days), the oracle and slippage bounds, and which swap adapter sells the vault's collateral (every sale is checked by the USDC actually received, within at most 10% of Aave's price). The owner can also set the protocol share of premiums, up to 20%, and the treasury it is paid to; the share splits what you pay and never adds to it. With these the owner can raise your premium within those bounds or pause exits. No owner function can transfer your aTokens or the vault's USDC, the contracts are not upgradeable, and ownership transfers in two steps.",
  },
  {
    q: "What if the vault is empty when I reach my trigger?",
    a: "The exit falls back to an Aave flash loan that sells part of the seized WETH through one Uniswap V3 pool (about 2.25 WETH deep) within 3% of Aave's price, and the exit reverts unless the vault gets back at least what it paid. That fits small exits only. Otherwise the exit reverts and your position stays as it was.",
  },
  {
    q: "What exactly happens at my trigger?",
    a: "Once your cover has armed, 15 minutes after you opt in, and your Aave health factor reaches the trigger, anyone can call the exit. The Executor repays enough of your USDC debt to bring the health factor back to the trigger plus 0.06, and moves aWETH worth 1.01 times the repaid amount from you to the vault. It reverts unless your health factor ends above 1.00 and higher than it started.",
  },
  {
    q: "How is the premium priced?",
    a: "Each 300\u00a0ms block, the Repricer sets your rate from your debt, ETH volatility measured from recent Pyth prices, and how far your health factor sits above the trigger. Closer means more expensive, and at or below the trigger the rate is the highest. The rate is charged per block against your prepaid USDC (at least 1 USDC to opt in); unused balance can be withdrawn at any time.",
  },
  {
    q: "What if the keeper is offline?",
    a: "The keeper is a convenience. The exit is permissionless, so any address can call it when the conditions hold, and the contract checks every condition itself. The app offers to run it from your own wallet when the keeper is late. If nobody calls it, your position is exactly as safe as an uncovered Aave position.",
  },
  {
    q: "Can Shield take my collateral at any other time?",
    a: "No. The approval you give lets the Executor move your aToken only inside an exit, only when your health factor is at or below your trigger, and only up to the debt it repays plus the discount you accepted (1% today). Revoking the approval disarms the cover; the premium keeps accruing until you opt out.",
  },
  {
    q: "Does Shield beat liquidators to a crash?",
    a: "No, and it does not try to. Aave on Monad uses Chainlink SVR, so the price update that crosses 1.00 arrives together with the winning liquidation. Shield acts earlier, at a health factor you choose above 1.00.",
  },
  {
    q: "Which positions can be covered?",
    a: "Aave V3 Monad positions with WETH collateral and USDC debt. Shield covers positions outside eMode only. cbBTC is listed and its cover arrives once a cbBTC swap route exists on Monad.",
  },
  {
    q: "How do liquidity providers earn?",
    a: "LPs deposit USDC into an ERC-4626 vault. The vault earns 90% of every covered borrower's premium, block by block, and the whole exit discount: it takes collateral worth 1% more than it repays at each exit. The other 10% of premiums goes to the protocol treasury at launch; the contract caps that share at 20%, and the owner can change it within the cap. Seized collateral stays in Aave until the owner or the unwinder sells it through the swap adapter for no less than Aave's price minus 3% (the owner can set at most 10%); a sale can cost more than the 1% earned, and collateral cannot be withdrawn until it is sold. Exit gains reach the share price over 6 hours.",
  },
  {
    q: "How does Shield make money?",
    a: (
      <>
        From a share of premiums: 10% of every premium goes to the protocol treasury at launch, split off when the premium is charged. The contract caps the share at
        20%, and the owner can change it within the cap. The exit discount goes entirely to liquidity providers, and the share never changes what a borrower pays.
        Every figure is on the{" "}
        <Link href="/app/analytics" prefetch={false} className="font-medium text-foreground underline underline-offset-4">
          analytics page
        </Link>
        .
      </>
    ),
  },
];

function Cell({ value, strong }: { value: Cell; strong?: boolean }) {
  if (value === true)
    return (
      <span className="inline-flex items-center gap-1.5 text-safe">
        <Check className="size-4" aria-hidden />
        <span className={strong ? "font-medium" : ""}>Yes</span>
      </span>
    );
  if (value === false)
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Minus className="size-4" aria-hidden />
        No
      </span>
    );
  return <span>{value}</span>;
}

function SectionHeading({ id, title, lede }: { id: string; title: string; lede?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className="text-[2rem] font-medium tracking-[-0.03em] sm:text-[2.75rem]">
        {title}
      </h2>
      {lede && <p className="mt-4 text-lg text-muted-foreground">{lede}</p>}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 max-w-[76rem] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-10">
            <Link href="/" aria-label="Shield home" className="rounded-md">
              <Wordmark />
            </Link>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="hit relative rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                  {n.label}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link
              href="/app/analytics"
              prefetch={false}
              className="hit relative hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline"
            >
              Analytics
            </Link>
            <a href={DOCS_LINK} {...EXT} className="hit relative hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground lg:inline">
              Docs
            </a>
            <a href={REPO} {...EXT} className="hit relative hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline">
              GitHub
            </a>
            <ThemeToggle />
            <Button asChild>
              <Link href="/app/borrow" prefetch={false}>
                Launch app
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-[76rem] items-center gap-12 px-4 pb-20 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-28">
          <div>
            <h1 className="display text-[2.75rem] font-medium sm:text-[4.25rem]">Leave before liquidation.</h1>
            <p className="mt-6 max-w-[33rem] text-lg leading-relaxed text-muted-foreground sm:text-xl">
              An opt-in early exit for Aave borrowers on Monad. At a health factor you choose, a vault repays part of your debt for a 1% discount plus a
              per-block premium, instead of Aave&rsquo;s 5.5% liquidation penalty.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-12 px-6 text-[0.9375rem]">
                <Link href="/app/borrow" prefetch={false}>
                  Protect a position
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 bg-card px-6 text-[0.9375rem]">
                <Link href="/app/vault" prefetch={false}>
                  Earn as a liquidity provider
                </Link>
              </Button>
            </div>
            <ul className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-[0.8125rem] text-muted-foreground">
              <li className="inline-flex items-center gap-2">
                <span className="inline-flex">
                  <TokenIcon symbol="AAVE" size={18} ring />
                  <TokenIcon symbol="PYTH" size={18} ring className="-ml-1.5" />
                </span>
                Built on Aave V3 and Pyth
              </li>
              <li className="inline-flex items-center gap-2">
                <TokenIcon symbol="MON" size={18} />
                Repriced every 300&nbsp;ms on Monad
              </li>
              <li className="inline-flex items-center gap-2">
                <Code2 className="size-4" aria-hidden />
                Open source, MIT
              </li>
            </ul>
            <p className="mt-8 flex max-w-[33rem] items-start gap-2.5 rounded-lg border bg-card px-3.5 py-3 text-[0.8125rem] text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
              <span>
                Shield is a Monad Metropolis 2026 entry. Its contracts are open source and tested but not yet audited; use amounts you can afford to lose.{" "}
                <a href="#security" className="font-medium text-foreground underline underline-offset-4">
                  Security notes
                </a>
              </span>
            </p>
          </div>
          <div className="relative">
            <div className="absolute -inset-x-12 -inset-y-16 -z-10 bg-[radial-gradient(closest-side,var(--brand-soft),transparent)]" aria-hidden />
            <HeroShot />
          </div>
        </section>

        <section aria-label="Shield in numbers" className="border-y bg-card">
          <dl className="mx-auto grid max-w-[76rem] grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-4">
            {[
              { v: "1% vs 5.5%", l: "Shield's exit fee against Aave's WETH liquidation penalty", href: "#savings" },
              { v: "300\u00a0ms", l: "How often the premium is repriced: every Monad block", href: "#monad" },
              { v: "63% less gas", l: "Per reprice on a mainnet fork, with Shield's access lists against without", href: `${REPO}#proof` },
              { v: "Fork-tested", l: "Unit, fuzz, invariant and fork tests against real Aave on Monad", href: DOCS.tests },
            ].map((s) => (
              <div key={s.v} className="py-8 pr-6 lg:py-10">
                <dt className="sr-only">{s.l}</dt>
                <dd className="reading text-[1.75rem] font-medium sm:text-[2rem]">
                  <a href={s.href} {...(s.href.startsWith("#") ? {} : EXT)} className="rounded-sm hover:text-brand">
                    {s.v}
                  </a>
                </dd>
                <dd className="mt-1.5 max-w-[16rem] text-sm text-muted-foreground">{s.l}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="savings" className="mx-auto max-w-[76rem] px-4 py-24 sm:px-6 lg:py-32">
          <SectionHeading
            id="savings"
            title="What an early exit saves"
            lede="A liquidation takes a 5.5% bonus on the debt it repays, from your collateral. Shield's exit runs at a trigger you set, enforced on chain without you watching the market, takes a known 1%, and repays only what it needs to."
          />
          <div className="mt-12">
            <SavingsCalculator />
          </div>
        </section>

        <section aria-labelledby="how" className="border-t bg-card">
          <div className="mx-auto max-w-[76rem] px-4 py-24 sm:px-6 lg:py-32">
            <SectionHeading id="how" title="How an exit works" lede="Three steps, each enforced by the contracts, not by a promise." />
            <ol className="mt-14 grid gap-6 md:grid-cols-3">
              {[
                {
                  icon: Gauge,
                  title: "Choose a trigger",
                  body: "Pick a health factor between 1.01 and 1.50 in the app and prepay at least 1 USDC. Approve Shield on your aToken; it can only be used inside an exit. Cover arms 15 minutes after you opt in.",
                },
                {
                  icon: ScanSearch,
                  title: "Priced every block",
                  body: "Each 300\u00a0ms block the premium is recomputed from Pyth volatility, your debt and your distance to the trigger, and charged against your prepaid balance.",
                },
                {
                  icon: ShieldCheck,
                  title: "Exit at the trigger",
                  body: "At the trigger anyone can call the exit. It repays debt back to trigger plus 0.06 and reverts unless your health factor ends higher than it started and above 1.00.",
                },
              ].map((step, i) => (
                <li key={step.title} className="panel p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-raised text-foreground">
                      <step.icon className="size-5" aria-hidden />
                    </span>
                    <span className="text-sm font-medium text-muted-foreground num">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-6 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="panel mt-6 p-6 sm:p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-lg font-semibold">Inside one exit transaction</h3>
                <p className="text-sm text-muted-foreground">Every step happens, or none does.</p>
              </div>
              <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
                {[
                  { t: "Prices agree", d: "Aave's oracle and Pyth must be within 2%, with a Pyth price at most an hour old with a tight confidence band." },
                  { t: "Vault funds it", d: "The vault sends USDC. If it is short, an Aave flash loan covers the rest." },
                  { t: "Debt repaid", d: "Aave's Pool takes the repayment on your behalf, enough to restore trigger plus 0.06." },
                  { t: "Collateral moves", d: "aWETH worth the repayment plus the 1% discount goes to the vault." },
                  { t: "Health checked", d: "Your health factor must end above 1.00 and above where it started." },
                ].map((step, i) => (
                  <li key={step.t} className="relative">
                    <div className="flex items-center gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[0.75rem] font-semibold text-background num">{i + 1}</span>
                      <span className="hidden h-px flex-1 bg-border lg:block" aria-hidden />
                    </div>
                    <p className="mt-3 font-medium">{step.t}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.d}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section aria-labelledby="monad" className="bg-[#0b1220] text-white dark:border-y dark:bg-card">
          <div className="mx-auto grid max-w-[76rem] gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.5fr] lg:py-32">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-medium text-white/70">
                <TokenIcon symbol="MON" size={18} />
                Monad mainnet
              </p>
              <h2 id="monad" className="mt-4 text-[2rem] font-medium tracking-[-0.03em] sm:text-[2.75rem]">
                Why this needs Monad
              </h2>
              <p className="mt-4 max-w-md text-lg text-white/70">A price for protection only makes sense if it keeps up with the risk it covers.</p>
            </div>
            <dl className="grid gap-x-10 gap-y-10 sm:grid-cols-2">
              {[
                { t: "300\u00a0ms blocks", d: "The premium is repriced every block. On a 12-second chain it would move forty times less often, and an exit could wait up to 12 seconds for the next block." },
                {
                  t: "Storage laid out for Monad",
                  d: "Every keeper transaction lists the storage pages it will touch, Aave's and Shield's, which Monad prices far below cold access; on a mainnet fork a reprice used 63% less gas and an exit 43% less with the list than without.",
                },
                {
                  t: "Receipts from the proposed block",
                  d: "The keeper watches health factors on the block being proposed, and the RPC returns the receipt from the proposed block (about 290\u00a0ms on a local fork; mainnet timing published after deployment).",
                },
                { t: "Gas charged on the limit", d: "Monad bills the gas limit, not the gas used, so every keeper transaction carries a measured limit instead of a padded guess." },
              ].map((f) => (
                <div key={f.t} className="border-t border-white/15 pt-5">
                  <dt className="font-semibold">{f.t}</dt>
                  <dd className="mt-2 text-[0.9375rem] leading-relaxed text-white/70">{f.d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="compare" className="mx-auto max-w-[76rem] px-4 py-24 sm:px-6 lg:py-32">
          <SectionHeading
            id="compare"
            title="Compared with what exists"
            lede="Pre-liquidation is not new. Covering Aave on Monad, its largest lender, is. Selling collateral yourself is cheap today: aggregators sell 1 WETH on Monad within 0.06% of Aave's price (KyberSwap quote, 5 Oct 2026). Shield is for an exit enforced on chain at a trigger you set, without watching the market, at a known 1%."
          />
          <div className="panel relative mt-12 overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <caption className="sr-only">Shield compared with Morpho pre-liquidation, Euler V2 and DeFi Saver</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="sticky left-0 w-44 bg-card px-5 py-4 font-medium text-muted-foreground">
                    <span className="sr-only">Property</span>
                  </th>
                  <th scope="col" className="bg-brand-soft px-5 py-4">
                    <span className="inline-flex items-center gap-2 font-semibold">
                      <ShieldCheck className="size-4 text-brand" aria-hidden />
                      Shield
                    </span>
                  </th>
                  <th scope="col" className="px-5 py-4 font-medium">Morpho pre-liquidation</th>
                  <th scope="col" className="px-5 py-4 font-medium">Euler V2</th>
                  <th scope="col" className="px-5 py-4 font-medium">DeFi Saver</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.row} className="border-b align-top last:border-b-0">
                    <th scope="row" className="sticky left-0 bg-card px-5 py-4 font-medium text-muted-foreground">
                      {r.row}
                    </th>
                    {r.cells.map((c, i) => (
                      <td key={i} className={i === 0 ? "bg-brand-soft px-5 py-4 text-foreground" : "px-5 py-4 text-muted-foreground"}>
                        <Cell value={c} strong={i === 0} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="security" className="border-t bg-card">
          <div className="mx-auto max-w-[76rem] px-4 py-24 sm:px-6 lg:py-32">
            <SectionHeading
              id="security"
              title="Built to be checked"
              lede="Everything that protects you is enforced on chain, and everything we claim can be verified from the source, the tests and the transactions."
            />
            <ul className="mt-14 grid gap-px overflow-hidden rounded-[14px] border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: ShieldCheck,
                  t: "The exit checks itself",
                  d: "An exit reverts unless your health factor ends above 1.00 and higher than it started. An invariant test checks this across random price moves, block gaps and repricing on a mainnet fork, plus a fuzz test over position size and price drop.",
                },
                {
                  icon: KeyRound,
                  t: "Your collateral, only at your trigger",
                  d: "The aToken approval is usable only inside an exit, at or below your trigger, and only up to the debt repaid plus the discount you accepted. Revoking it disarms the cover; the premium keeps accruing until you opt out.",
                },
                { icon: Eye, t: "Two price sources", d: "Exits check Aave's oracle against Pyth and refuse a gap above 2%, a Pyth price older than an hour, or a confidence band that is too wide." },
                { icon: Code2, t: "Permissionless and open", d: "Anyone can execute an exit when its conditions hold; the keeper is a convenience. Every contract is open source under MIT." },
                { icon: FileCheck2, t: "Tested in public", d: "Unit, fuzz, invariant and fork tests against real Aave on Monad, adversarial scenarios, and Slither and Aderyn findings resolved in the open." },
                { icon: TriangleAlert, t: "Not audited yet", d: "Shield is new software built for Monad Metropolis and has not had an external audit. Use amounts you can afford to lose." },
              ].map((f) => (
                <li key={f.t} className="bg-card p-6 sm:p-7">
                  <f.icon className={f.icon === TriangleAlert ? "size-5 text-caution" : "size-5 text-brand"} aria-hidden />
                  <h3 className="mt-4 font-semibold">{f.t}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{f.d}</p>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="outline" className="bg-card">
                <a href={DOCS.security} {...EXT}>
                  Read the trust model
                </a>
              </Button>
              <Button asChild variant="outline" className="bg-card">
                <a href={DOCS.tests} {...EXT}>
                  See the test report
                </a>
              </Button>
              <Button asChild variant="outline" className="bg-card">
                <Link href="/app/analytics" prefetch={false}>
                  Live analytics
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <a href={REPO} {...EXT}>
                  Source code
                  <ArrowRight className="size-4" aria-hidden />
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section aria-labelledby="lenders" className="mx-auto max-w-[76rem] px-4 pt-24 sm:px-6 lg:pt-32">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="max-w-2xl">
              <h2 id="lenders" className="text-[1.75rem] font-medium tracking-[-0.03em] sm:text-[2.25rem]">
                Aave first, then the rest of Monad
              </h2>
              <p className="mt-3 text-lg text-muted-foreground">
                Shield covers Aave V3, Monad&rsquo;s largest lender. Each of the others needs its own exit path and fork tests before it is covered.
              </p>
            </div>
            <Link href="/app/analytics" prefetch={false} className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium hover:underline hover:underline-offset-4">
              See live analytics
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="mt-8">
            <LendersStrip />
          </div>
        </section>

        <section aria-labelledby="faq" className="mx-auto grid max-w-[76rem] gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:py-32">
          <SectionHeading id="faq" title="Questions" lede="The short answers. The long ones are in the specification and the source." />
          <div className="divide-y border-y">
            {faqs.map((f) => (
              <details key={f.q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-left font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="pb-5 pr-12 text-[0.9375rem] leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="cta" className="px-4 pb-24 sm:px-6 lg:pb-32">
          <div className="mx-auto flex max-w-[76rem] flex-col items-start justify-between gap-8 rounded-[18px] bg-[#0b1220] px-6 py-12 text-white sm:px-12 sm:py-16 lg:flex-row lg:items-center dark:border dark:bg-card">
            <div>
              <h2 id="cta" className="text-[2rem] font-medium tracking-[-0.03em] sm:text-[2.75rem]">
                Set your exit before the market does.
              </h2>
              <p className="mt-3 max-w-xl text-lg text-white/70">Connect the wallet that borrows on Aave V3 Monad and see your position in seconds.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-12 bg-white px-6 text-[0.9375rem] text-[#0b1220] hover:bg-white/90">
                <Link href="/app/borrow" prefetch={false}>
                  Protect a position
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 border-white/25 bg-transparent px-6 text-[0.9375rem] text-white hover:bg-white/10 hover:text-white">
                <Link href="/app/vault" prefetch={false}>
                  Provide liquidity
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
