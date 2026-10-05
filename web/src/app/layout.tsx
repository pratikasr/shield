import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import { Theme } from "@/components/shell/theme";
import "./globals.css";

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Shield: an early exit for Aave borrowers on Monad", template: "%s | Shield" },
  description:
    "Set a health-factor trigger above Aave's liquidation line. At the trigger a vault repays part of your debt for a 1% discount instead of a 5.5% liquidation penalty, priced every 300 ms block on Monad.",
  applicationName: "Shield",
  openGraph: {
    title: "Shield: leave before liquidation",
    description: "An opt-in early exit for Aave V3 borrowers on Monad. 1% at your trigger instead of a 5.5% liquidation penalty.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d12" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${instrument.variable} light`} suppressHydrationWarning>
      <body>
        <Theme>{children}</Theme>
      </body>
    </html>
  );
}
