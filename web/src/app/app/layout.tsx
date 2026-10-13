import type { Metadata } from "next";
import { AppHeader } from "@/components/shell/app-header";
import { AppFooter } from "@/components/shell/footer";
import { NetworkGuard } from "@/components/shell/network-guard";
import { Providers } from "@/components/shell/providers";
import { StaleBanner } from "@/components/shell/stale-banner";

export const metadata: Metadata = { title: "App" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-dvh flex-col">
        <AppHeader />
        <NetworkGuard />
        <StaleBanner />
        <main id="main" tabIndex={-1} className="c-wrap w-full flex-1 pb-18 pt-6">
          {children}
        </main>
        <AppFooter />
      </div>
    </Providers>
  );
}
