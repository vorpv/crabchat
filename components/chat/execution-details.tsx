"use client"

import { useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileMinus,
  FilePenLine,
  FilePlus,
  FolderOpen,
  MoveRight,
  Search,
  Terminal,
  Wrench,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { ToolCall } from "@/lib/types"

type ExecutionItem =
  | {
      type: "explore"
      id: string
      mode: "lookup" | "search"
      label: string
      paths: string[]
      tools: ToolCall[]
      status: ToolCall["status"]
    }
  | {
      type: "command"
      id: string
      label: string
      command: string
      output?: string
      error?: string
      exitCode?: number
      tool: ToolCall
      status: ToolCall["status"]
    }
  | {
      type: "patch"
      id: string
      label: string
      fullPath: string
      targetPath?: string
      tool: ToolCall
      status: ToolCall["status"]
    }
  | {
      type: "generic"
      id: string
      label: string
      tool: ToolCall
      status: ToolCall["status"]
    }

interface ExecutionDetailsProps {
  toolCalls: ToolCall[]
  className?: string
  compact?: boolean
}

interface ChangesSummaryProps {
  toolCalls: ToolCall[]
  className?: string
}

const shellTools = new Set(["bash", "sh", "zsh"])
const lookupCommands = new Set(["ls", "pwd", "cat", "sed", "head", "tail", "nl"])
const searchCommands = new Set(["find", "grep", "rg", "fd"])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function truncate(value: string, max = 96) {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized
}

function basename(path: string) {
  return path.replace(/\/+$/, "").split("/").filter(Boolean).pop() || path
}

function dirname(path: string) {
  const parts = path.replace(/\/+$/, "").split("/")
  parts.pop()
  return parts.join("/") || "/"
}

function compactPath(path: string) {
  const normalized = path || "."
  const file = basename(normalized)
  if (file.length > 40) return file

  const parents = dirname(normalized)
    .split("/")
    .filter(Boolean)
    .filter((part) => part.length < 10)
    .slice(-3)

  return [...parents, file].join("/") || normalized
}

function getToolInput(tool: ToolCall) {
  return tool.input || {}
}

function getCommand(tool: ToolCall) {
  const input = getToolInput(tool)
  return asString(input.command) || asString(input.cmd) || ""
}

function getCwd(tool: ToolCall) {
  return asString(getToolInput(tool).cwd)
}

function unwrapShellCommand(command: string) {
  const trimmed = command.trim()
  const match = trimmed.match(/^(?:\/bin\/)?(?:bash|sh|zsh)\s+-lc\s+(['"])([\s\S]*)\1$/)
  return match?.[2] || trimmed
}

function getCommandWord(command: string) {
  const inner = unwrapShellCommand(command).trim()
  const match = inner.match(/^([A-Za-z0-9_.-]+)/)
  return match?.[1] || ""
}

function getLookupPath(tool: ToolCall) {
  const command = unwrapShellCommand(getCommand(tool)).trim()
  if (command === "pwd") return getCwd(tool) || "."

  const parts = command.split(/\s+/)
  const target = [...parts].reverse().find((part) => !part.startsWith("-") && part !== parts[0])
  return target || getCwd(tool) || "."
}

function getSearchTarget(tool: ToolCall) {
  const command = unwrapShellCommand(getCommand(tool)).trim()
  const quoted = command.match(/['"]([^'"]+)['"]/)
  if (quoted?.[1]) return quoted[1]

  const parts = command.split(/\s+/)
  const needle = parts.find((part, index) => index > 0 && !part.startsWith("-"))
  return needle || getCwd(tool) || "files"
}

function parseJsonObject(value?: string) {
  if (!value) return undefined
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return undefined
  }
}

function getExitCode(tool: ToolCall) {
  const parsed = parseJsonObject(tool.output)
  const code = parsed?.exitCode
  return typeof code === "number" ? code : undefined
}

function getApplyPatchChanges(tool: ToolCall) {
  const changes = getToolInput(tool).changes
  return Array.isArray(changes)
    ? changes
        .map(asRecord)
        .filter((change): change is Record<string, unknown> => Boolean(change))
    : []
}

export function getApplyPatchSummaryItems(toolCalls: ToolCall[]) {
  return toolCalls.flatMap((tool) => {
    if (tool.name !== "apply_patch" || tool.status === "error") return []
    return getApplyPatchChanges(tool).map((change, index) => {
      const kind = asRecord(change.kind)
      const path = asString(change.path) || "unknown"
      const movePath = asString(kind?.move_path)
      const type = asString(kind?.type) || "update"
      const targetPath = movePath
      let label = `Edited file ${compactPath(path)}`
      if (type === "add") label = `Created file ${compactPath(path)}`
      if (type === "delete") label = `Deleted file ${compactPath(path)}`
      if (movePath) {
        label =
          dirname(path) === dirname(movePath)
            ? `Renamed file ${compactPath(path)} to ${compactPath(movePath)}`
            : `Moved file ${compactPath(path)} to ${compactPath(movePath)}`
      }

      return {
        id: `${tool.id}-${index}`,
        label,
        path,
        targetPath,
        status: tool.status,
      }
    })
  })
}

function classifyTool(tool: ToolCall): ExecutionItem[] {
  if (shellTools.has(tool.name)) {
    const command = getCommand(tool)
    const commandWord = getCommandWord(command)
    if (lookupCommands.has(commandWord)) {
      return [
        {
          type: "explore",
          id: tool.id,
          mode: "lookup",
          label: `Looked up ${compactPath(getLookupPath(tool))}`,
          paths: [getLookupPath(tool)],
          tools: [tool],
          status: tool.status,
        },
      ]
    }
    if (searchCommands.has(commandWord)) {
      return [
        {
          type: "explore",
          id: tool.id,
          mode: "search",
          label: `Searched for ${truncate(getSearchTarget(tool), 56)}`,
          paths: [getSearchTarget(tool)],
          tools: [tool],
          status: tool.status,
        },
      ]
    }

    const exitCode = getExitCode(tool)
    return [
      {
        type: "command",
        id: tool.id,
        label: `Ran ${truncate(unwrapShellCommand(command), 72)}`,
        command,
        output: tool.output,
        error: tool.error,
        exitCode,
        tool,
        status: tool.status,
      },
    ]
  }

  if (tool.name === "apply_patch") {
    const changes = getApplyPatchSummaryItems([tool])
    if (changes.length > 0) {
      return changes.map((change) => ({
        type: "patch",
        id: change.id,
        label: change.label,
        fullPath: change.path,
        targetPath: change.targetPath,
        tool,
        status: tool.status,
      }))
    }
  }

  return [
    {
      type: "generic",
      id: tool.id,
      label: tool.name ? `Called a tool ${tool.name}` : "Did something we don't understand",
      tool,
      status: tool.status,
    },
  ]
}

function mergeExploration(items: ExecutionItem[]) {
  const merged: ExecutionItem[] = []

  for (const item of items) {
    const previous = merged[merged.length - 1]
    if (
      item.type === "explore" &&
      previous?.type === "explore" &&
      previous.mode === item.mode
    ) {
      previous.paths.push(...item.paths)
      previous.tools.push(...item.tools)
      previous.status =
        previous.status === "pending" || item.status === "pending"
          ? "pending"
          : previous.status === "error" || item.status === "error"
            ? "error"
            : "success"
      const unique = Array.from(new Set(previous.paths)).slice(0, 4)
      const suffix = previous.paths.length > unique.length ? ` and ${previous.paths.length - unique.length} more` : ""
      previous.label =
        previous.mode === "lookup"
          ? `Looked up ${unique.map(compactPath).join(", ")}${suffix}`
          : `Searched for ${unique.map((path) => truncate(path, 36)).join(", ")}${suffix}`
      continue
    }

    merged.push(item)
  }

  return merged
}

function buildExecutionItems(toolCalls: ToolCall[]) {
  return mergeExploration(toolCalls.flatMap(classifyTool))
}

function getStatusIcon(status: ToolCall["status"]) {
  if (status === "pending") return Clock3
  if (status === "error") return AlertCircle
  return CheckCircle2
}

function ExecutionStatusIcon({ status }: { status: ToolCall["status"] }) {
  const Icon = getStatusIcon(status)
  return (
    <Icon
      className={cn(
        "mt-0.5 h-3.5 w-3.5 shrink-0",
        status === "pending" && "text-muted-foreground animate-pulse",
        status === "error" && "text-destructive",
        status === "success" && "text-emerald-500"
      )}
    />
  )
}

function LineIcon({ item }: { item: ExecutionItem }) {
  const className = "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
  if (item.type === "command") return <Terminal className={className} />
  if (item.type === "explore") {
    return item.mode === "search" ? <Search className={className} /> : <FolderOpen className={className} />
  }
  if (item.type === "patch") {
    if (item.label.includes("Created")) return <FilePlus className={className} />
    if (item.label.includes("Deleted")) return <FileMinus className={className} />
    if (item.label.includes("Renamed") || item.label.includes("Moved")) return <MoveRight className={className} />
    return <FilePenLine className={className} />
  }
  return <Wrench className={className} />
}

function rawToolPayload(tool: ToolCall) {
  return {
    call: tool.rawCall || {
      id: tool.id,
      name: tool.name,
      input: tool.input,
    },
    results: tool.rawResults || [],
    output: tool.output,
    error: tool.error,
    status: tool.status,
  }
}

function OutputPreview({
  item,
  onMore,
}: {
  item: Extract<ExecutionItem, { type: "command" }>
  onMore: () => void
}) {
  const output = item.error || item.output
  if (!output) return null

  const lines = output.split("\n")
  const visible = lines.slice(0, 3)

  return (
    <div className="mt-1 rounded-md bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-5 text-foreground/80 ring-1 ring-border/70">
      {visible.map((line, index) => (
        <div
          key={index}
          className={cn("truncate", lines.length > 3 && index === 2 && "opacity-45")}
        >
          {line || " "}
        </div>
      ))}
      {lines.length > 3 && (
        <button
          className="mt-1 text-[11px] font-medium text-foreground underline-offset-4 hover:underline"
          onClick={onMore}
        >
          More
        </button>
      )}
    </div>
  )
}

function ExitCode({ value }: { value: number }) {
  return (
    <span className={cn("ml-1", value === 0 ? "text-emerald-500" : "text-destructive")}>
      (exit code: {value})
    </span>
  )
}

export function ChangesSummary({ toolCalls, className }: ChangesSummaryProps) {
  const changes = useMemo(() => getApplyPatchSummaryItems(toolCalls), [toolCalls])
  if (changes.length === 0) return null

  return (
    <div className={cn("mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2", className)}>
      <div className="mb-1 text-xs font-medium text-muted-foreground">Changes summary</div>
      <div className="space-y-1">
        {changes.map((change) => (
          <div
            key={change.id}
            className={cn(
              "flex items-center gap-2 text-xs",
              change.status === "error" ? "text-destructive" : "text-foreground/85"
            )}
            title={change.targetPath ? `${change.path} -> ${change.targetPath}` : change.path}
          >
            <FilePenLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{change.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExecutionDetails({
  toolCalls,
  className,
  compact = false,
}: ExecutionDetailsProps) {
  const [dialog, setDialog] = useState<{
    title: string
    content: string
    language: "text" | "json"
  } | null>(null)
  const items = useMemo(() => buildExecutionItems(toolCalls), [toolCalls])

  if (items.length === 0) return null

  return (
    <>
      <div className={cn("space-y-1.5", className)}>
        {items.map((item) => {
          const pending = item.status === "pending"
          return (
            <div
              key={item.id}
              className={cn(
                "relative rounded-md px-2 py-1.5 text-xs transition-colors",
                compact ? "bg-transparent" : "bg-muted/25",
                pending && "overflow-hidden text-muted-foreground"
              )}
            >
              {pending && (
                <span className="pointer-events-none absolute inset-x-2 bottom-0 h-px animate-pulse bg-gradient-to-r from-transparent via-muted-foreground/70 to-transparent" />
              )}
              <div className="flex min-w-0 items-start gap-2">
                <LineIcon item={item} />
                <div className="min-w-0 flex-1">
                  <button
                    className={cn(
                      "min-w-0 max-w-full text-left",
                      item.type === "generic" && "underline-offset-4 hover:underline"
                    )}
                    title={
                      item.type === "patch"
                        ? item.targetPath
                          ? `${item.fullPath} -> ${item.targetPath}`
                          : item.fullPath
                        : item.type === "command"
                          ? item.command
                          : item.type === "explore"
                            ? item.paths.join(", ")
                          : undefined
                    }
                    onClick={() => {
                      if (item.type !== "generic") return
                      setDialog({
                        title: item.label,
                        content: JSON.stringify(rawToolPayload(item.tool), null, 2),
                        language: "json",
                      })
                    }}
                  >
                    <span className="truncate">
                      {item.label}
                      {item.type === "command" && item.exitCode !== undefined && (
                        <ExitCode value={item.exitCode} />
                      )}
                    </span>
                  </button>
                  {item.type === "command" && (
                    <OutputPreview
                      item={item}
                      onMore={() =>
                        setDialog({
                          title: item.label,
                          content: item.error || item.output || "",
                          language: "text",
                        })
                      }
                    />
                  )}
                </div>
                <ExecutionStatusIcon status={item.status} />
              </div>
            </div>
          )
        })}
      </div>

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[82vh] w-full max-w-2xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle className="truncate text-sm">{dialog?.title}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[68vh] overflow-auto p-4 text-xs leading-relaxed thin-scrollbar">
            <code>{dialog?.content}</code>
          </pre>
        </DialogContent>
      </Dialog>
    </>
  )
}
