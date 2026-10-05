import type { Metadata } from "next";
import { Suspense } from "react";
import { BorrowView } from "@/components/borrow/borrow-view";

export const metadata: Metadata = { title: "Protect a position" };

export default function BorrowPage() {
  return (
    <Suspense>
      <BorrowView />
    </Suspense>
  );
}
