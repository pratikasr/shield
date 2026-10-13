import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-[10px] bg-grape-tint/70", className)}
      {...props}
    />
  )
}

export { Skeleton }
