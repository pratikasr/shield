import Link from "next/link";
import { explorerUrl, shield } from "@/lib/env";
import { truncateHex } from "@/lib/format";
import { Logo } from "./header-bar";

export const REPO = "https://github.com/pratikasr/shield";
export const DOCS = {
  readme: `${REPO}#readme`,
  security: `${REPO}/blob/main/docs/SECURITY.md`,
  tests: `${REPO}/blob/main/docs/TEST-REPORT.md`,
  spec: `${REPO}/blob/main/docs/SPEC.md`,
  license: `${REPO}/blob/main/LICENSE`,
};

export const DISCLAIMER =
  "Shield is experimental, open-source software built for Monad Metropolis 2026. Its contracts have not been audited, and using them can lose money. Nothing on this site is financial advice. Shield is independent and not affiliated with Aave, Pyth or Monad.";

const CONTRACTS = [
  ["PositionRegistry", shield.registry],
  ["Repricer", shield.repricer],
  ["Executor", shield.executor],
  ["ShieldVault", shield.vault],
  ["ShieldForwarderFactory", shield.forwarders],
] as const;

const linkCls = "inline-flex min-h-11 items-center font-semibold";

/**
 * The ground under every page: Ink, with the honest disclaimer, where to check the work (Security, Tests, GitHub),
 * and on the landing page the contract addresses when the build has them.
 */
function Ground({ contracts }: { contracts: boolean }) {
  const deployed = CONTRACTS.filter(([, a]) => a);
  return (
    <footer className="c-ground">
      <div className="c-wrap grid gap-8 pb-11 pt-10 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <Logo className="mb-3" />
          <p className="max-w-[44em] text-[15px] leading-relaxed">{DISCLAIMER}</p>
          {contracts && deployed.length > 0 && (
            <div className="mt-6">
              <h2 className="text-[20px] text-white">Contracts on Monad</h2>
              <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
                {deployed.map(([name, a]) => (
                  <li key={name}>
                    <a className={`${linkCls} gap-2 text-[14.5px]`} href={`${explorerUrl}/address/${a}`} target="_blank" rel="noreferrer">
                      {name} <span className="c-mono font-normal">{truncateHex(a!, 6, 4)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <nav aria-label="Footer" className="flex flex-wrap content-start gap-x-6 md:justify-end">
          <Link className={linkCls} href="/app/borrow" prefetch={false}>
            Protect
          </Link>
          <Link className={linkCls} href="/app/vault" prefetch={false}>
            Vault
          </Link>
          <Link className={linkCls} href="/app/stats" prefetch={false}>
            Stats
          </Link>
          <a className={linkCls} href={DOCS.security} target="_blank" rel="noreferrer">
            Security
          </a>
          <a className={linkCls} href={DOCS.tests} target="_blank" rel="noreferrer">
            Tests
          </a>
          <a className={linkCls} href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className={linkCls} href={DOCS.license} target="_blank" rel="noreferrer">
            MIT License
          </a>
        </nav>
      </div>
    </footer>
  );
}

/** The landing page's footer, with the contract addresses. */
export function SiteFooter() {
  return <Ground contracts />;
}

/** The app's footer. */
export function AppFooter() {
  return <Ground contracts={false} />;
}
