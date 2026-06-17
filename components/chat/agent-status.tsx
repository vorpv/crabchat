"use client"

import { Bot, Brain, LoaderCircle, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AgentActivity } from "@/lib/types"

interface AgentStatusIndicatorProps {
  activity: AgentActivity
  className?: string
  showBotIcon?: boolean
}

function getActivityIcon(activity: AgentActivity) {
  if (activity.kind === "tool") return Wrench
  if (activity.kind === "operation") return LoaderCircle
  return Brain
}

export function AgentStatusIndicator({
  activity,
  className,
  showBotIcon = false,
}: AgentStatusIndicatorProps) {
  const ActivityIcon = getActivityIcon(activity)

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground",
        className
      )}
      title={activity.detail || activity.label}
    >
      {showBotIcon && <Bot className="h-3.5 w-3.5 shrink-0" />}
      <ActivityIcon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          activity.kind === "operation" ? "animate-spin" : "animate-pulse"
        )}
      />
      <span className="truncate">{activity.label}</span>
    </div>
  )
}
