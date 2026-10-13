import * as React from "react"
import { cn } from "@/lib/utils"

/** A text field in the cartoon style: Ink outline, white face, Grape focus ring. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn("c-field", className)} {...props} />
}

export { Input }
