import { cn } from "@/lib/utils";

/** A small preset pill. Pressed is Ink; the tap area is 44 px tall. For big preset cards use ChoiceCards. */
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
        "hit relative min-h-9 rounded-full border-2 border-ink px-3.5 text-[15px] font-bold transition-colors disabled:opacity-50",
        active ? "bg-ink text-white" : "bg-cloud text-ink hover:bg-grape-tint",
      )}
    >
      {children}
    </button>
  );
}
