"use client"

import { useEffect, useMemo, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CircularProgress } from "@/components/ui/circular-progress"
import { Menu, Download, FileText, FileJson, FileType } from "lucide-react"
import { AgentStatusIndicator } from "@/components/chat/agent-status"
import type {
  AgentActivity,
  ContextWindowStatus,
  ProviderUsageSummary,
  ProviderUsageWindow,
} from "@/lib/types"

interface ChatHeaderProps {
  title: string
  contextWindow: ContextWindowStatus
  usageSummary: ProviderUsageSummary | null
  agentActivity?: AgentActivity | null
  onOpenSidebar: () => void
  sidebarExpanded: boolean
  onExport: (format: "markdown" | "json" | "text") => void
}

function formatTokens(value?: number) {
  if (value === undefined) return "—"
  return value.toLocaleString()
}

function formatDuration(ms: number) {
  if (ms <= 0) return "less than a minute"

  const totalMinutes = Math.ceil(ms / 60_000)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function getWindowByLabel(
  windows: ProviderUsageWindow[],
  matcher: (label: string) => boolean
) {
  return windows.find((window) => matcher(window.label))
}

export function ChatHeader({
  title,
  contextWindow,
  usageSummary,
  agentActivity,
  onOpenSidebar,
  sidebarExpanded,
  onExport,
}: ChatHeaderProps) {
  const [now, setNow] = useState(() => Date.now())
  const { capacityTokens, totalTokens, usagePercent, usedTokens } = contextWindow
  const remainingPercent = Math.max(0, 100 - usagePercent)
  const usageWindows = useMemo(() => {
    if (!usageSummary) return []

    const weeklyWindow = getWindowByLabel(usageSummary.windows, (label) => /week/i.test(label))
    const shortWindow =
      getWindowByLabel(usageSummary.windows, (label) => /^5h$/i.test(label)) ||
      getWindowByLabel(usageSummary.windows, (label) => /^\d+h$/i.test(label))

    return [shortWindow, weeklyWindow].filter(Boolean) as ProviderUsageWindow[]
  }, [usageSummary])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
      {!sidebarExpanded && (
            <button
              onClick={onOpenSidebar}
              aria-label="Open sidebar"
              title="Open sidebar"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            >
          <Menu className="h-4 w-4" />
          <span className="sr-only">Open sidebar</span>
        </button>
      )}

      <h1 className="flex-1 truncate text-sm font-medium text-foreground">
        {title}
      </h1>

      <div className="flex items-center gap-1">
        {agentActivity?.active && (
          <AgentStatusIndicator
            activity={agentActivity}
            className="mr-1 max-w-[180px] bg-transparent"
            showBotIcon
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Download"
              title="Download"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Download className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onExport("markdown")}>
              <FileText className="mr-2 h-4 w-4" />
              <span className="flex-1">Markdown</span>
              <span className="text-xs text-muted-foreground">.md</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("json")}>
              <FileJson className="mr-2 h-4 w-4" />
              <span className="flex-1">JSON</span>
              <span className="text-xs text-muted-foreground">.json</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("text")}>
              <FileType className="mr-2 h-4 w-4" />
              <span className="flex-1">Plain Text</span>
              <span className="text-xs text-muted-foreground">.txt</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <PopoverTrigger asChild>
            <button
              aria-label="Context window"
              title="Context window"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <CircularProgress value={usagePercent} size={20} strokeWidth={2.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 p-3"
            sideOffset={8}
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-sm font-medium">Context window</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Used</span>
                  <span className="tabular-nums">{usagePercent}%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className="tabular-nums">{remainingPercent}%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tokens</span>
                  <span className="tabular-nums">
                    {formatTokens(usedTokens)}
                    {capacityTokens !== undefined ? ` / ${formatTokens(capacityTokens)}` : ""}
                  </span>
                </div>
                {totalTokens !== undefined && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Transcript</span>
                    <span className="tabular-nums">{formatTokens(totalTokens)}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <div className="text-sm font-medium">Usage limits</div>
                {usageWindows.length > 0 ? (
                  usageWindows.map((window) => (
                    <div key={window.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {/week/i.test(window.label) ? "Weekly" : window.label}
                        </span>
                        <span className="tabular-nums">{Math.round(window.usedPercent)}% used</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        resets in{" "}
                        {window.resetAt ? formatDuration(Math.max(0, window.resetAt - now)) : "unknown"}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No usage limits available
                  </div>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  )
}
