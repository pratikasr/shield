import type { Metadata } from "next";
import { AppHeader } from "@/components/shell/app-header";
import { NetworkGuard } from "@/components/shell/network-guard";
import { Providers } from "@/components/shell/providers";

export const metadata: Metadata = { title: "App" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="min-h-dvh">
        <AppHeader />
        <NetworkGuard />
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>
      </div>
    </Providers>
  );
}
