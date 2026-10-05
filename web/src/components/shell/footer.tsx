import Link from "next/link";
import { explorerUrl, shield } from "@/lib/env";
import { truncateHex } from "@/lib/format";
import { Wordmark } from "./wordmark";

export const REPO = "https://github.com/pratikasr/shield";
export const DOCS = {
  readme: `${REPO}#readme`,
  security: `${REPO}/blob/main/docs/SECURITY.md`,
  tests: `${REPO}/blob/main/docs/TEST-REPORT.md`,
  spec: `${REPO}/blob/main/docs/SPEC.md`,
  license: `${REPO}/blob/main/LICENSE`,
};

const DISCLAIMER =
  "Shield is experimental, open-source software built for Monad Metropolis 2026. Its contracts have not been audited, and using them can lose money. Nothing on this site is financial advice. Shield is independent and not affiliated with Aave, Pyth or Monad.";

const CONTRACTS = [
  ["PositionRegistry", shield.registry],
  ["Repricer", shield.repricer],
  ["Executor", shield.executor],
  ["ShieldVault", shield.vault],
] as const;

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[0.8125rem] font-semibold">{title}</h2>
      <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">{children}</ul>
    </div>
  );
}

function Item({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  return (
    <li>
      {external ? (
        <a href={href} target="_blank" rel="noreferrer" className="hit relative rounded-sm transition-colors hover:text-foreground">
          {children}
        </a>
      ) : (
        <Link href={href} prefetch={false} className="hit relative rounded-sm transition-colors hover:text-foreground">
          {children}
        </Link>
      )}
    </li>
  );
}

/** The marketing footer: product, contracts, sources, documents, and what Shield is and is not. */
export function SiteFooter() {
  const deployed = CONTRACTS.every(([, a]) => a);
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto max-w-[76rem] px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <Wordmark />
            <p className="mt-4 text-sm text-muted-foreground">An opt-in early exit for Aave V3 borrowers on Monad, priced every block.</p>
          </div>
          <Column title="Product">
            <Item href="/app/borrow">Protect a position</Item>
            <Item href="/app/vault">Earn as a liquidity provider</Item>
            <Item href="/app/analytics">Analytics</Item>
            <Item href="/#how">How an exit works</Item>
            <Item href="/#faq">Questions</Item>
          </Column>
          <Column title="Transparency">
            <Item href={DOCS.security} external>Security and trust model</Item>
            <Item href={DOCS.tests} external>Test report</Item>
            <Item href={REPO} external>Source code (MIT)</Item>
            {deployed ? (
              CONTRACTS.map(([name, a]) => (
                <Item key={name} href={`${explorerUrl}/address/${a}`} external>
                  {name} <span className="num">{truncateHex(a!, 6, 4)}</span>
                </Item>
              ))
            ) : (
              <Item href={DOCS.readme} external>Contract addresses</Item>
            )}
          </Column>
          <Column title="Built on">
            <Item href="https://app.aave.com/?marketName=proto_monad_v3" external>Aave V3 on Monad</Item>
            <Item href="https://www.pyth.network" external>Pyth price feeds</Item>
            <Item href="https://envio.dev" external>Envio indexer</Item>
            <Item href="https://www.monad.xyz" external>Monad</Item>
          </Column>
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t pt-6 text-[0.8125rem] text-muted-foreground md:flex-row md:items-start md:justify-between">
          <p className="max-w-3xl">{DISCLAIMER}</p>
          <p className="shrink-0">
            <a href={DOCS.license} target="_blank" rel="noreferrer" className="hit relative hover:text-foreground">
              MIT License
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

/** The app's footer: the same disclaimer, and where to check the work. */
export function AppFooter() {
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto flex max-w-[76rem] flex-col gap-3 px-4 py-6 text-[0.8125rem] text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
        <p className="max-w-3xl">{DISCLAIMER}</p>
        <nav aria-label="Resources" className="flex shrink-0 flex-wrap gap-x-5 gap-y-1">
          <Link href="/app/analytics" prefetch={false} className="hit relative hover:text-foreground">Analytics</Link>
          <a href={DOCS.security} target="_blank" rel="noreferrer" className="hit relative hover:text-foreground">Security</a>
          <a href={DOCS.tests} target="_blank" rel="noreferrer" className="hit relative hover:text-foreground">Tests</a>
          <a href={REPO} target="_blank" rel="noreferrer" className="hit relative hover:text-foreground">GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
