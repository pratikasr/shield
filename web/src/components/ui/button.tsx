import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * The cartoon button: an Ink outline on a ledge that presses down 5 px. Variants: primary (Grape, white text),
 * secondary (white), quiet (a text button), green, yellow, lava. Version 2 names still work: default is primary,
 * outline and secondary are white, ghost and link are quiet, destructive is lava.
 */
const buttonVariants = cva("c-btn", {
  variants: {
    variant: {
      default: "",
      primary: "",
      secondary: "c-btn-white",
      outline: "c-btn-white",
      white: "c-btn-white",
      quiet: "c-btn-quiet",
      ghost: "c-btn-quiet",
      link: "c-btn-quiet",
      green: "c-btn-green",
      yellow: "c-btn-yellow",
      destructive: "c-btn-lava",
      lava: "c-btn-lava",
    },
    size: {
      default: "",
      md: "",
      lg: "",
      big: "c-btn-big",
      sm: "c-btn-small",
      small: "c-btn-small",
      xs: "c-btn-small",
      icon: "c-btn-icon",
      "icon-xs": "c-btn-icon",
      "icon-sm": "c-btn-icon",
      "icon-lg": "c-btn-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
})

/**
 * Renders the single child element with the button's props merged in (for `asChild` links). A small stand-in for
 * Radix's Slot, so pages that only need a button do not load Radix.
 */
function Slot({ children, className, ...props }: React.ComponentProps<"button">) {
  const child = React.Children.only(children) as React.ReactElement<Record<string, unknown> & { className?: string }>
  return React.cloneElement(child, { ...props, ...child.props, className: cn(className, child.props.className) })
}

/** Three bouncing dots and the words, for a button waiting on a wallet. */
function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <span className="c-waiting">
      {children}
      <span className="inline-flex gap-1.5" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </span>
  )
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  loadingText,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Pressed down with bouncing dots; the button is disabled while loading. */
    loading?: boolean
    /** What the button says while loading, for example "Waiting for your wallet". */
    loadingText?: React.ReactNode
  }) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? <Waiting>{loadingText ?? children}</Waiting> : children}
    </Comp>
  )
}

export { Button, buttonVariants }
