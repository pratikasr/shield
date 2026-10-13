import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/cartoon/card";
import { ComicStrip } from "@/components/cartoon/comic-strip";
import { CartoonIcon, type CartoonIconName } from "@/components/cartoon/icons";
import { Mascot } from "@/components/cartoon/mascot";
import { Pill, Sticker } from "@/components/cartoon/sticker";
import { HeroScene } from "@/components/landing/hero-scene";
import { LandingTicker } from "@/components/landing/landing-ticker";
import { REPO, SiteFooter } from "@/components/shell/footer";
import { SiteHeader } from "@/components/shell/site-header";
import { Button } from "@/components/ui/button";

const STEPS: { title: string; body: ReactNode; pills: ReactNode; node: string }[] = [
  {
    title: "Pick when Shield steps in",
    body: "Choose a price for ETH below today’s. Early costs more and acts sooner. Last call is cheapest and cuts it closer.",
    pills: (
      <>
        <Pill>Early</Pill>
        <Pill tone="grape">Balanced</Pill>
        <Pill>Last call</Pill>
      </>
    ),
    node: "bg-grape text-white",
  },
  {
    title: "Add a little fuel",
    body: "Prepay some USDC, on Monad or from another chain. It burns slowly while Shield is on. Take back what you don’t use, any time.",
    pills: (
      <>
        <Pill>USDC on Monad</Pill>
        <Pill>Or from another chain</Pill>
      </>
    ),
    node: "bg-heads text-ink",
  },
  {
    title: "Shield steps in for you",
    body: "If ETH hits your price, Shield pays back part of your loan and takes ETH worth that plus 1%. You keep the rest, and Aave’s line drops away.",
    pills: <Pill dot="on">Reads your loan every block</Pill>,
    node: "bg-chill text-ink",
  },
];

const TRUST: { icon: CartoonIconName; title: string; body: ReactNode; warn?: boolean }[] = [
  {
    icon: "code",
    title: "Open source",
    body: (
      <>
        Every contract and this site are public on{" "}
        <a className="c-link" href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
        , MIT licensed.
      </>
    ),
  },
  { icon: "flask", title: "Tested on real Aave", body: "The tests run against copies of Aave on Monad mainnet, not a mock lender." },
  { icon: "warn", title: "Not audited yet", body: "No security firm has reviewed the contracts. Use money you can afford to lose.", warn: true },
  {
    icon: "hand",
    title: "Best effort",
    body: "If ETH jumps past your line in one move, Aave can still liquidate you. If nobody steps in, you are where you’d be without Shield.",
    warn: true,
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "What does it cost?",
    a: (
      <>
        <p>
          A small amount every block while Shield is on, taken from the fuel you prepay. For the example loan above (about $107 borrowed), that is about
          $0.30 a month at the Balanced line.
        </p>
        <p>It costs more when ETH gets wild or when your line sits close to today’s price. When Shield steps in, it also takes 1% of what it repays.</p>
      </>
    ),
  },
  {
    q: "Does Shield sell my ETH?",
    a: (
      <p>
        No. Shield pays back part of your loan with its vault’s USDC, then takes a slice of your ETH worth the repaid amount plus 1%. The slice goes into
        Shield’s vault. Your remaining ETH stays on Aave.
      </p>
    ),
  },
  {
    q: "Can Shield stop every liquidation?",
    a: (
      <p>
        No. If ETH jumps straight past your line in one move, or nobody can step in in time, Aave can still liquidate you. If Shield doesn’t step in, you
        are exactly where you’d be without it.
      </p>
    ),
  },
  {
    q: "Why does it take 15 minutes to switch on?",
    a: (
      <p>
        New cover starts 15 minutes after you turn it on, so nobody can buy it at the last second, when a crash is already under way. That keeps it cheap
        for everyone else.
      </p>
    ),
  },
  {
    q: "What happens when the fuel runs out?",
    a: <p>Shield switches off and the page tells you. Add fuel and it re-arms 15 minutes later. You can take back unused fuel any time.</p>,
  },
  {
    q: "Who presses the button?",
    a: (
      <p>
        Shield’s bot reads every protected loan in every block. If it is ever late, anyone can trigger the rescue once ETH is at your line. The contracts
        check every condition.
      </p>
    ),
  },
  {
    q: "Where does the money for a rescue come from?",
    a: <p>From Shield’s vault, a pot the protocol itself filled at launch. It earns the 1% from rescues and most of the fuel payments.</p>,
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        {/* Hero: on phones the promise and the button come before the scene. */}
        <section className="pb-18 pt-7 md:pt-12" aria-labelledby="hero-title">
          <div className="c-wrap grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-6 [grid-template-areas:'top'_'scene'_'fine'] md:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] md:[grid-template-areas:'top_scene'_'fine_scene']">
            <div className="c-rise self-end [grid-area:top]">
              <div className="flex flex-wrap items-center gap-2.5">
                <Sticker tone="careful">Not audited yet</Sticker>
                <Pill>For Aave V3 on Monad</Pill>
              </div>
              <h1 id="hero-title" className="c-h1 mb-4 mt-4 md:mb-5.5">
                The floor is lava. Shield steps in first.
              </h1>
              <p className="mb-6 max-w-[34em] text-[18px] leading-normal sm:text-[20px]">
                Shield pays back part of your Aave loan before you get liquidated. It takes 1%, not Aave’s 5.5%.
              </p>
              <div className="c-row">
                <Button asChild>
                  <Link href="/app/borrow">Protect my loan</Link>
                </Button>
                <Button asChild variant="secondary">
                  <a href="#how">How it works</a>
                </Button>
              </div>
            </div>
            <div className="self-center [grid-area:scene]">
              <HeroScene />
            </div>
            <div className="self-start [grid-area:fine]">
              <p className="c-small c-muted mt-0 max-w-[36em] md:mt-4.5">
                Pick an ETH price. If ETH falls to it, Shield pays back part of your loan and takes a slice of your ETH worth that amount plus 1%. For loans with
                ETH as collateral and USDC borrowed. Shield does not sell your ETH on the market; the slice goes to Shield’s vault.
              </p>
            </div>
          </div>
        </section>

        <section className="c-section c-band" id="how" aria-labelledby="how-title">
          <div className="c-wrap">
            <div className="c-section-head">
              <h2 id="how-title" className="c-h2">
                Three steps, then Shield keeps watch.
              </h2>
              <p>No dashboards to babysit. You pick a price, add a little fuel, and Shield reads your loan in every Monad block.</p>
            </div>
            <ol className="relative m-0 grid list-none gap-5 p-0 before:absolute before:bottom-10 before:left-[31px] before:top-10 before:border-l-[5px] before:border-dotted before:border-ink sm:before:left-[44px] md:grid-cols-3 md:gap-7 md:before:bottom-auto md:before:left-[8%] md:before:right-[8%] md:before:top-[44px] md:before:border-l-0 md:before:border-t-[5px]">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative z-[1] grid grid-cols-[64px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4 md:block">
                  <div
                    className={`grid size-16 place-items-center rounded-full border-[2.5px] border-ink font-display text-[32px] shadow-ledge sm:size-[88px] sm:text-[44px] md:mb-4.5 ${s.node}`}
                    aria-hidden
                  >
                    {i + 1}
                  </div>
                  <Card className="md:min-h-[calc(100%-106px)]">
                    <h3 className="c-h3 mb-2.5">{s.title}</h3>
                    <p className="m-0">{s.body}</p>
                    <div className="mt-4 flex flex-wrap gap-2">{s.pills}</div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="c-section" aria-labelledby="comic-title">
          <div className="c-wrap">
            <div className="c-section-head">
              <h2 id="comic-title" className="c-h2">
                The one liquidation on Aave Monad so far.
              </h2>
              <p>From launch to 5 Oct 2026, Aave on Monad liquidated one loan. It cost the borrower $87.98 on top of what was repaid. Here it is, four panels long.</p>
            </div>
            <ComicStrip />
          </div>
        </section>

        <section className="c-section c-band" aria-labelledby="monad-title">
          <div className="c-wrap grid grid-cols-[minmax(0,1fr)] items-center gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-10">
            <div>
              <h2 id="monad-title" className="c-h2">
                Built for Monad’s 0.3 second blocks.
              </h2>
              <p className="mt-3.5 text-[19px]">
                Monad makes a new block about every 0.3 seconds, so Shield reads your loan about 200 times a minute. When ETH touches your line, the next block
                can already carry the rescue.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <Pill>Works with Aave V3</Pill>
                <Pill>Prices from Pyth</Pill>
                <Pill>History by Envio</Pill>
              </div>
            </div>
            <LandingTicker />
          </div>
        </section>

        <section className="c-section" aria-labelledby="trust-title">
          <div className="c-wrap">
            <div className="c-section-head">
              <h2 id="trust-title" className="c-h2">
                Straight talk.
              </h2>
              <p>Shield is new. Here is exactly where it stands.</p>
            </div>
            <div className="grid gap-4.5 sm:grid-cols-2 lg:grid-cols-4">
              {TRUST.map((t) => (
                <Card key={t.title} pad="tight" className="sm:p-5">
                  <div className={`grid size-13 place-items-center rounded-[14px] border-[2.5px] border-ink ${t.warn ? "bg-heads" : "bg-sky-2"}`} aria-hidden>
                    <CartoonIcon name={t.icon} size={30} />
                  </div>
                  <h3 className="mb-2 mt-3.5 text-[23px]">{t.title}</h3>
                  <p className="m-0 text-[15.5px]">{t.body}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="c-section c-band" id="faq" aria-labelledby="faq-title">
          <div className="c-wrap">
            <div className="c-section-head">
              <h2 id="faq-title" className="c-h2">
                Questions.
              </h2>
            </div>
            <div className="c-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <div>{f.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="pb-20 pt-16" aria-labelledby="final-title">
          <div className="c-wrap">
            <Card tone="grape" className="grid items-center gap-7 md:grid-cols-[150px_minmax(0,1fr)_auto]">
              <Mascot mood="guard" className="w-[110px] md:w-[150px]" />
              <div>
                <h2 id="final-title" className="text-[clamp(30px,3.4vw,42px)]">
                  Set your line before ETH moves.
                </h2>
                <p className="mb-0 mt-2.5">Takes four wallet prompts. Cover starts 15 minutes later.</p>
              </div>
              <Button asChild className="justify-self-start">
                <Link href="/app/borrow">Protect my loan</Link>
              </Button>
            </Card>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
