import Link from "next/link";
import { LiveDemo } from "@/components/landing/live-demo";
import { ThemeToggle } from "@/components/shell/theme";
import { Wordmark } from "@/components/shell/wordmark";
import { Button } from "@/components/ui/button";

const REPO = "https://github.com/pratikasr/shield";

const comparison: { row: string; cells: [string, string, string, string] }[] = [
  {
    row: "Lender covered",
    cells: ["Aave V3 on Monad", "Morpho Blue markets only", "Euler vaults only", "Aave, Morpho and others"],
  },
  {
    row: "On Monad today",
    cells: ["Yes", "Yes, for Morpho Blue markets", "Yes", "No; six other chains"],
  },
  {
    row: "What happens at the trigger",
    cells: [
      "A vault repays part of the debt and takes collateral at a 1% discount",
      "Any liquidator repays at the market's pre-liquidation incentive",
      "Liquidators bid in a reverse Dutch auction from a 0% discount",
      "Your own collateral is swapped to repay debt",
    ],
  },
  {
    row: "Cost to the borrower",
    cells: ["A premium per block, plus 1% of what is repaid", "The pre-liquidation incentive", "A discount that rises over time", "About 0.08% plus swap slippage"],
  },
  {
    row: "Who funds the exit",
    cells: ["Vault LPs, with an Aave flash loan as fallback", "Any liquidator", "Any liquidator", "Your collateral"],
  },
  {
    row: "Best when",
    cells: [
      "Collateral is thin to sell: swapping it costs more than 1%",
      "You borrow on Morpho",
      "You borrow on Euler",
      "Collateral is liquid enough to swap cheaply",
    ],
  },
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" aria-label="Shield home" className="rounded-md">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Site">
          <a href={REPO} className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground sm:inline">
            Source code
          </a>
          <ThemeToggle />
          <Button asChild>
            <Link href="/app/borrow">Launch app</Link>
          </Button>
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
          <div className="max-w-[44rem]">
            <h1 className="text-[2.5rem] font-semibold sm:text-[3.5rem]" style={{ fontStretch: "125%" }}>
              Leave before liquidation.
            </h1>
            <p className="mt-5 max-w-[60ch] text-lg text-muted-foreground">
              Set a trigger above Aave&rsquo;s liquidation line. When your position reaches it, a vault repays part of your debt and
              takes collateral at a 1% discount instead of the 5.5% liquidation bonus. The price of that cover is set again every
              300&nbsp;ms block on Monad.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/app/borrow">Protect a position</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/app/vault">Provide liquidity</Link>
              </Button>
            </div>
          </div>
          <div className="mt-12">
            <LiveDemo />
          </div>
        </section>

        <section aria-labelledby="how" className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="how" className="text-[1.75rem] font-semibold">
              How an exit works
            </h2>
            <ol className="mt-8 grid gap-8 md:grid-cols-3">
              {[
                {
                  title: "Opt in",
                  body: "Pick a trigger between 1.01 and 2.00 and the most discount you accept. Approve Shield on your aToken and prepay some USDC for the premium.",
                },
                {
                  title: "Priced every block",
                  body: "Each 300 ms block the premium is recomputed from Pyth volatility, your debt and how far your health factor sits above the trigger, and charged against your prepaid balance.",
                },
                {
                  title: "Exit at the trigger",
                  body: "When Aave's health factor reaches your trigger, anyone can call the exit. It repays debt back to trigger + 0.06 and reverts unless your health factor ends higher than it started and above 1.00.",
                },
              ].map((step, i) => (
                <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-x-3">
                  <span className="reading text-xl font-semibold text-caution" aria-hidden>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold">{step.title}</h3>
                    <p className="mt-2 text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="compare" className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="compare" className="text-[1.75rem] font-semibold">
              Compared with what exists
            </h2>
            <p className="mt-3 max-w-[64ch] text-muted-foreground">
              Pre-liquidation is not new. Covering Aave, the largest lender on Monad, is. For collateral you could sell cheaply,
              a swap-based tool will cost you less, and we would rather say so here.
            </p>
            <div className="mt-8 overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                <caption className="sr-only">Shield compared with Morpho pre-liquidation, Euler V2 and DeFi Saver</caption>
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th scope="col" className="w-40 px-4 py-3 font-medium text-muted-foreground">
                      <span className="sr-only">Property</span>
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">Shield</th>
                    <th scope="col" className="px-4 py-3 font-medium">Morpho pre-liquidation</th>
                    <th scope="col" className="px-4 py-3 font-medium">Euler V2</th>
                    <th scope="col" className="px-4 py-3 font-medium">DeFi Saver</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((r) => (
                    <tr key={r.row} className="border-b last:border-b-0 align-top">
                      <th scope="row" className="px-4 py-3 font-medium text-muted-foreground">
                        {r.row}
                      </th>
                      {r.cells.map((c, i) => (
                        <td key={i} className={i === 0 ? "px-4 py-3 text-foreground" : "px-4 py-3 text-muted-foreground"}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="monad" className="border-t">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 id="monad" className="text-[1.75rem] font-semibold">
                Why this needs <span className="text-monad">Monad</span>
              </h2>
              <p className="mt-3 text-muted-foreground">
                A price for protection only makes sense if it can keep up with the risk it covers.
              </p>
            </div>
            <dl className="grid gap-8 sm:grid-cols-2">
              <div>
                <dt className="font-semibold">300 ms blocks</dt>
                <dd className="mt-1.5 text-muted-foreground">
                  The premium is repriced every block. On a 12-second chain it would move forty times less often, and the exit
                  would land minutes late.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Page-warmed storage</dt>
                <dd className="mt-1.5 text-muted-foreground">
                  Each record and each volatility window fits one 128-slot MIP-8 page. With an access list, a reprice costs 63%
                  less gas and an exit 43% less.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Proposed-state reads</dt>
                <dd className="mt-1.5 text-muted-foreground">
                  The keeper reads health factors on the proposed block and sends with eth_sendRawTransactionSync, which returns
                  the receipt in about 300 ms. Finality follows two blocks later.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Gas charged on the limit</dt>
                <dd className="mt-1.5 text-muted-foreground">
                  Monad bills the gas limit, not the gas used, so every keeper transaction carries a measured limit.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section aria-labelledby="limits" className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="limits" className="text-[1.75rem] font-semibold">
              What Shield does not do
            </h2>
            <ul className="mt-6 grid max-w-[72ch] gap-3 text-muted-foreground">
              <li>
                It does not race liquidators. Aave on Monad uses Chainlink SVR, so the price update that crosses 1.00 arrives with
                the winning liquidation. Shield acts above 1.00, at your trigger.
              </li>
              <li>It does not cover eMode positions. Their liquidation bonus on Monad is 1%, so there is nothing to save.</li>
              <li>
                It does not ask you to trust a keeper. The exit is open to anyone and the contract checks every condition itself.
              </li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6">
          <p>Built for Monad Metropolis, Track 01. MIT licensed.</p>
          <a href={REPO} className="rounded-sm hover:text-foreground">
            Contracts, tests and transaction proofs on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
