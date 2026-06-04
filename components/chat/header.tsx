"use client"
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

interface ChatHeaderProps {
  title: string
  contextUsage: number
  onOpenSidebar: () => void
  sidebarExpanded: boolean
  onExport: (format: "markdown" | "json" | "text") => void
}

export function ChatHeader({
  title,
  contextUsage,
  onOpenSidebar,
  sidebarExpanded,
  onExport,
}: ChatHeaderProps) {
  const contextTokens = Math.round(contextUsage * 1280)

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
              <CircularProgress value={contextUsage} size={20} strokeWidth={2.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-56 p-3"
            sideOffset={8}
          >
            <div className="space-y-2">
              <div className="text-sm font-medium">Context window:</div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Used</span>
                <span className="tabular-nums">{contextUsage}%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Remaining</span>
                <span className="tabular-nums">{100 - contextUsage}%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tokens</span>
                <span className="tabular-nums">
                  {contextTokens.toLocaleString()} / 128K
                </span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  )
}
