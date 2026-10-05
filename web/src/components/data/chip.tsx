import { cn } from "@/lib/utils";

/** A preset choice (trigger, prepay duration, loan size). Pressed is ink; the tap area is 44 px tall. */
export function Chip({
  active,
  onClick,
  children,
  disabled,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={Boolean(active)}
      aria-label={label}
      className={cn(
        "hit relative h-8 rounded-full border px-3 text-[0.8125rem] font-medium transition-colors num disabled:opacity-50",
        active ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:border-input hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
