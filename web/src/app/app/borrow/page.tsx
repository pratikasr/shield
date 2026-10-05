import type { Metadata } from "next";
import { BorrowView } from "@/components/borrow/borrow-view";

export const metadata: Metadata = { title: "Protect a position" };

export default function BorrowPage() {
  return <BorrowView />;
}
