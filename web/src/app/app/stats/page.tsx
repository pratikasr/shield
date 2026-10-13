import type { Metadata } from "next";
import { StatsView } from "@/components/analytics/stats-view";

export const metadata: Metadata = {
  title: "Stats",
  description: "Shield's scoreboard: rescues, money saved for borrowers, loans protected now and protocol income, live from Monad.",
};

export default function StatsPage() {
  return <StatsView />;
}
