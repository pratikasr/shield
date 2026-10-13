"use client"

import * as React from "react"
import { cn } from "cn"
import { Slider as SliderPrimitive } from "radix-ui"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  valueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** Spoken value, for example "$100,000" instead of the slider's raw position. */
  valueText?: string
}) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full border-2 border-ink bg-cloud data-horizontal:h-3 data-horizontal:w-full data-vertical:h-full data-vertical:w-1.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-grape select-none data-horizontal:h-full data-vertical:w-full"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={ariaLabel}
          aria-valuetext={valueText}
          className="relative block size-6 shrink-0 rounded-full border-[2.5px] border-ink bg-grape shadow-sticker-xs ring-ring/40 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden active:ring-4 disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
