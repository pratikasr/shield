"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Mascot } from "@/components/cartoon/mascot";
import { Button } from "@/components/ui/button";

/** Last line of defence for the landing page: what happened, that funds are unaffected, and a way back. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="c-wrap flex min-h-dvh items-center justify-center py-16">
      <div className="c-card max-w-xl text-center" role="alert">
        <Mascot mood="confused" size={110} className="mx-auto" />
        <h1 className="c-h1-app mt-4">This page tripped.</h1>
        <p className="mt-3">
          Something failed while showing the page. Nothing on chain changed: your loan, your Shield line and any transaction you already sent are as they
          were.
        </p>
        <div className="c-row mt-6 justify-center">
          <Button onClick={() => reset()}>Try again</Button>
          <Button asChild variant="secondary">
            <Link href="/">Back to the start</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
