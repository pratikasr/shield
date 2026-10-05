"use client";

import { Info as InfoIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** A small "how is this computed" marker next to a derived number. Keyboard focusable. */
export function Info({ children, label = "How this is computed" }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex size-6 items-center justify-center rounded-sm align-middle text-muted-foreground hover:text-foreground" aria-label={label}>
          <InfoIcon className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-[0.8125rem] leading-snug">{children}</TooltipContent>
    </Tooltip>
  );
}
