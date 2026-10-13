import Link from "next/link";
import type { ReactNode } from "react";
import { MascotFace } from "@/components/cartoon/mascot-art";
import { cn } from "@/lib/utils";

export const NAV = [
  { id: "protect", href: "/app/borrow", label: "Protect" },
  { id: "vault", href: "/app/vault", label: "Vault" },
  { id: "stats", href: "/app/stats", label: "Stats" },
] as const;
export type NavId = (typeof NAV)[number]["id"];

/** Which nav item a path belongs to. The old analytics route counts as Stats. */
export function navFor(pathname: string | null | undefined): NavId | undefined {
  if (!pathname) return undefined;
  if (pathname.startsWith("/app/borrow")) return "protect";
  if (pathname.startsWith("/app/vault")) return "vault";
  if (pathname.startsWith("/app/stats") || pathname.startsWith("/app/analytics")) return "stats";
  return undefined;
}

/** The mascot's face and the name. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("c-logo", className)} aria-label="Shield home">
      <MascotFace />
      <span aria-hidden>Shield</span>
    </Link>
  );
}

/**
 * The top bar: logo, Protect, Vault and Stats with the current page marked, then `end` (block chip and wallet). On
 * phones the links sit beside the logo and `end` takes a row of its own under them.
 */
export function HeaderBar({ active, end }: { active?: NavId; end?: ReactNode }) {
  return (
    <header className="c-topbar">
      <a className="c-skip" href="#main">
        Skip to content
      </a>
      <div className="c-wrap c-topbar-in">
        <Logo />
        <nav className="c-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.id} href={n.href} aria-current={active === n.id ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        {end && (
          <div className="c-topbar-end" data-phone="row">
            {end}
          </div>
        )}
      </div>
    </header>
  );
}
