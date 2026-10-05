"use client";

import { Info as InfoIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

/**
 * A small "how is this computed" marker next to a derived number. Opens on hover with a mouse, and on tap or Enter
 * everywhere else (a tooltip alone never opens on a phone). Closes on Escape or a tap outside.
 */
export function Info({ children, label = "How this is computed" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointer = useRef<string>("");
  useEffect(() => () => clearTimeout(timer.current), []);
  const hover = (next: boolean) => (e: PointerEvent) => {
    pointer.current = e.pointerType;
    if (e.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), next ? 120 : 150);
  };
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="hit relative inline-flex size-6 items-center justify-center rounded-sm align-middle text-muted-foreground hover:text-foreground"
          aria-label={label}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          onPointerDown={(e) => {
            pointer.current = e.pointerType;
          }}
          onClick={(e) => {
            // A mouse that hovered it open keeps it open on click; touch and keyboard toggle.
            if (pointer.current === "mouse" && open) e.preventDefault();
          }}
        >
          <InfoIcon className="size-3.5" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          className="z-50 max-w-72 rounded-md bg-foreground px-3 py-2 text-[0.8125rem] font-normal leading-snug text-background shadow-md"
        >
          {children}
          <PopoverPrimitive.Arrow className="fill-foreground" width={10} height={5} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
