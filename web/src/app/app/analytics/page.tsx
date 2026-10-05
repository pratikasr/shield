import type { Metadata } from "next";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata: Metadata = {
  title: "Analytics",
  description: "What Shield earns and who earns it, live from Monad and the Envio indexer.",
};

export default function AnalyticsPage() {
  return <AnalyticsView />;
}
