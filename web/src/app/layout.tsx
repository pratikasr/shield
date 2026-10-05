import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { Theme } from "@/components/shell/theme";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Shield: an early exit for Aave borrowers on Monad", template: "%s | Shield" },
  description:
    "Set a health-factor trigger above Aave's liquidation line. At the trigger a vault repays part of your debt for a 1% discount instead of a 5.5% liquidation bonus, priced every 300 ms block.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e1424" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} dark`} suppressHydrationWarning>
      <body>
        <Theme>{children}</Theme>
      </body>
    </html>
  );
}
