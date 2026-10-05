"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * The app's error boundary, inside the app header and wallet providers: one failed panel never leaves a blank page, and
 * the person learns that nothing on chain changed.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl py-6 sm:py-12">
      <div className="panel px-6 py-10 text-center sm:px-12" role="alert">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-caution-soft text-caution">
          <TriangleAlert className="size-5" aria-hidden />
        </span>
        <h1 className="mt-5 text-[1.5rem] font-semibold tracking-[-0.01em]">This page hit an error</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          Something failed while showing your position. Nothing on chain changed: your Aave position, your cover and any transaction you already sent
          are as they were. Try again; if it keeps failing, reload the page.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button onClick={() => reset()}>Try again</Button>
          <Button variant="outline" className="bg-card" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}
