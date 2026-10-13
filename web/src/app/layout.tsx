import type { Metadata, Viewport } from "next";
import { Lilita_One, Rubik } from "next/font/google";
import "./globals.css";

/** Headlines, status words and preset names. Words only: it has no tabular figures. */
const lilita = Lilita_One({ weight: "400", variable: "--font-lilita", subsets: ["latin"], display: "swap" });
/** Body text and every number, with tabular figures. */
const rubik = Rubik({ variable: "--font-rubik", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Shield: the floor is lava, Shield steps in first", template: "%s | Shield" },
  description:
    "Shield pays back part of your Aave loan on Monad before you get liquidated, and takes a slice of your ETH worth the repaid amount plus 1% instead of Aave's 5.5%.",
  applicationName: "Shield",
  openGraph: {
    title: "Shield: the floor is lava, Shield steps in first",
    description: "An opt-in early exit for Aave V3 borrowers on Monad. 1% at your line instead of Aave's 5.5% liquidation bonus.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#cbe7ff",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${lilita.variable} ${rubik.variable}`}>
      <body>{children}</body>
    </html>
  );
}
