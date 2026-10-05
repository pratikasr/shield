"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { explorerUrl } from "@/lib/env";
import { truncateHex } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A truncated hash or address with a copy button and an explorer link. */
export function HashLink({ value, kind = "tx", className }: { value: string; kind?: "tx" | "address"; className?: string }) {
  const [copied, setCopied] = useState(false);
  const href = `${explorerUrl}/${kind === "tx" ? "tx" : "address"}/${value}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (insecure context); the explorer link still works.
    }
  };
  return (
    <span className={cn("inline-flex items-center gap-1 num", className)}>
      <a href={href} target="_blank" rel="noreferrer" className="rounded-sm underline decoration-border underline-offset-4 hover:decoration-foreground" title={value}>
        {truncateHex(value)}
        <span className="sr-only"> (opens the explorer)</span>
      </a>
      <button
        type="button"
        onClick={copy}
        className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={copied ? "Copied" : `Copy ${kind === "tx" ? "transaction hash" : "address"}`}
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Open in explorer"
      >
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </span>
  );
}
