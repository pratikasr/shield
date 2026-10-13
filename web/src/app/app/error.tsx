"use client";

import { useEffect } from "react";
import { Mascot } from "@/components/cartoon/mascot";
import { Button } from "@/components/ui/button";

/**
 * The app's error boundary, inside the header and wallet providers: one failed panel never leaves a blank page, and
 * the person learns that nothing on chain changed.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl py-6 sm:py-12">
      <div className="c-card text-center" role="alert">
        <Mascot mood="confused" size={110} className="mx-auto" />
        <h1 className="c-h1-app mt-4">This page tripped.</h1>
        <p className="mx-auto mt-3 max-w-md">
          Something failed while showing your loan. Nothing on chain changed: your Aave loan, your Shield line and any transaction you already sent are as
          they were. Try again; if it keeps failing, reload the page.
        </p>
        <div className="c-row mt-6 justify-center">
          <Button onClick={() => reset()}>Try again</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}
