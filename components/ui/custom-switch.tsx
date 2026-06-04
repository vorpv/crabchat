"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

interface CustomSwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  size?: "sm" | "default"
}

const CustomSwitch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  CustomSwitchProps
>(({ className, size = "default", ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      size === "sm" ? "h-4 w-7" : "h-5 w-9",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block rounded-full bg-background shadow-sm ring-0 transition-transform",
        size === "sm" 
          ? "h-3 w-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0"
          : "h-4 w-4 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
CustomSwitch.displayName = "CustomSwitch"

export { CustomSwitch }
