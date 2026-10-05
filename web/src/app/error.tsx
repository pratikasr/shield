"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Last line of defence for the landing page: what happened, that funds are unaffected, and a way back. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-caution-soft text-caution">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-[1.5rem] font-semibold tracking-[-0.01em]">This page hit an error</h1>
      <p className="mt-3 text-muted-foreground">
        Something failed while showing the page. Nothing on chain changed: your position, your cover and any transaction you already sent are as they
        were. Try again, or go back to the start.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button asChild variant="outline" className="bg-card">
          <Link href="/">Back to the start</Link>
        </Button>
      </div>
    </main>
  );
}
