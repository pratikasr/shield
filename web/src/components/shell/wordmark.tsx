import { cn } from "@/lib/utils";

/**
 * Shield's mark: a shield cut by one horizontal line, the trigger that sits above the liquidation line. The upper
 * part takes the ink colour, the lower part the brand blue.
 */
export function ShieldMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 1.6 20.6 4.7V10.2H3.4V4.7Z" className="fill-foreground" />
      <path d="M3.4 12.4H20.6C20.4 17.2 16.9 20.9 12 22.6 7.1 20.9 3.6 17.2 3.4 12.4Z" className="fill-brand" />
    </svg>
  );
}

/**
 * The mark and the name. `compact` drops the name below 420 px; `textClassName` hides it at other widths where the
 * header is crowded (the app header between 768 and 1024 px).
 */
export function Wordmark({ className, compact, textClassName }: { className?: string; compact?: boolean; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <ShieldMark />
      <span className={cn("text-[1.0625rem] font-semibold tracking-[-0.01em]", compact && "hidden min-[420px]:inline", textClassName)}>Shield</span>
    </span>
  );
}
