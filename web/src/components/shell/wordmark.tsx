import { MascotFace } from "@/components/cartoon/mascot-art";
import { cn } from "@/lib/utils";

/** Shield's mark: the mascot's face. Kept for version 2 imports. */
export function ShieldMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-block shrink-0", className)} style={{ width: size, height: size * 1.1 }} aria-hidden>
      <MascotFace className="size-full" />
    </span>
  );
}

/** The mark and the name in Lilita. */
export function Wordmark({ className, textClassName }: { className?: string; compact?: boolean; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <MascotFace className="h-8 w-7" />
      <span className={cn("font-display text-[24px] leading-none", textClassName)}>Shield</span>
    </span>
  );
}
