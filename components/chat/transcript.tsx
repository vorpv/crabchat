"use client"

import { useRef, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Brain,
  Check,
  Copy,
  Cpu,
  Gauge,
  Hash,
  AlertCircle,
  FileIcon,
  MoreHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { AgentStatusIndicator } from "@/components/chat/agent-status"
import {
  ChangesSummary,
  ExecutionDetails,
  getApplyPatchSummaryItems,
} from "@/components/chat/execution-details"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AgentActivity, Message, MessageUsage, Settings, ToolCall } from "@/lib/types"

interface ChatTranscriptProps {
  messages: Message[]
  workspaceRoot?: string
  workspaceSessionKey?: string
  isResponding?: boolean
  agentActivity?: AgentActivity | null
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  gatewayError?: string | null
  onRetryGateway?: () => void
  retryingGateway?: boolean
  onShowExecutionDetails?: (title: string, toolCalls: ToolCall[]) => void
}

export function ChatTranscript({
  messages,
  workspaceRoot,
  workspaceSessionKey,
  isResponding = false,
  agentActivity,
  settings,
  onSettingsChange,
  gatewayError,
  onRetryGateway,
  retryingGateway = false,
  onShowExecutionDetails,
}: ChatTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  if (messages.length === 0 && !isResponding && !gatewayError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Start a conversation</p>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar"
    >
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {gatewayError && (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{gatewayError}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetryGateway}
              disabled={retryingGateway}
              className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {retryingGateway ? "Retrying" : "Retry"}
            </Button>
          </div>
        )}
        {messages.map((message) => (
          <MessageGroup
            key={message.id}
            messages={messages}
            message={message}
            workspaceRoot={workspaceRoot}
            workspaceSessionKey={workspaceSessionKey}
            settings={settings}
            onSettingsChange={onSettingsChange}
            onShowDetails={(title, toolCalls) => onShowExecutionDetails?.(title, toolCalls)}
          />
        ))}
        {isResponding && <TypingIndicator activity={agentActivity} />}
      </div>
    </div>
  )
}

interface MessageGroupProps {
  messages: Message[]
  message: Message
  workspaceRoot?: string
  workspaceSessionKey?: string
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  onShowDetails: (title: string, toolCalls: ToolCall[]) => void
}

function MessageGroup({
  messages,
  message,
  workspaceRoot,
  workspaceSessionKey,
  settings,
  onSettingsChange,
  onShowDetails,
}: MessageGroupProps) {
  const [copied, setCopied] = useState(false)
  const [displayTime, setDisplayTime] = useState<string>("")
  const messageIndex = messages.findIndex((item) => item.id === message.id)
  const responseToolCalls = getResponseToolCalls(messages, messageIndex)
  const hasDetails = responseToolCalls.length > 0

  useEffect(() => {
    // Format time on client-side only to avoid hydration mismatch
    setDisplayTime(
      message.timestamp.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    )
  }, [message.timestamp])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may be blocked in some contexts
    }
  }

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-2">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {message.attachments.map((attachment, i) => (
              <div
                key={i}
                className="flex max-h-[300px] max-w-[300px] items-center justify-center overflow-hidden rounded-lg bg-muted text-xs text-muted-foreground"
              >
                {attachment.type.startsWith("image/") && attachment.url ? (
                  <img
                    src={attachment.url}
                    alt={attachment.name}
                    className="max-h-[300px] max-w-[300px] object-contain"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center">
                    <FileIcon className="h-5 w-5" />
                    <span className="sr-only">{attachment.name}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="group relative max-w-[85%]">
          <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-user-bubble px-4 py-2.5 text-sm text-user-bubble-foreground">
            {message.content}
          </div>
          <div className="absolute -bottom-6 right-0 flex items-center gap-0 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={handleCopy}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Copy"
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
            <MessageMoreMenu
              hasDetails={false}
              settings={settings}
              onSettingsChange={onSettingsChange}
            />
            <span className="ml-2 text-xs text-muted-foreground">
              {displayTime}
            </span>
            <TokenUsageBadges usage={message.usage} enabled={settings.displayTokenUsage} className="ml-2" />
          </div>
        </div>
      </div>
    )
  }

  if (!message.content.trim() && message.toolCalls && message.toolCalls.length > 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="group relative">
        <div className="prose prose-sm prose-invert max-w-none text-foreground">
          <MessageContent
            content={message.content}
            workspaceRoot={workspaceRoot}
            workspaceSessionKey={workspaceSessionKey}
          />
        </div>
        {message.content.trim() && (
          <ChangesSummaryFrame
            visible={settings.displayChangesSummary}
            toolCalls={responseToolCalls}
          />
        )}
        <div className="mt-2 flex items-center gap-0 opacity-100 transition-opacity group-hover:opacity-100 md:opacity-0">
          <button
            onClick={handleCopy}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Copy"
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
              )}
          </button>
          <MessageMoreMenu
            hasDetails={hasDetails}
            onShowDetails={() => onShowDetails("Execution details", responseToolCalls)}
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
          <span className="ml-2 text-xs text-muted-foreground">
            {displayTime}
          </span>
          <TokenUsageBadges usage={message.usage} enabled={settings.displayTokenUsage} className="ml-2" />
        </div>
      </div>
    </div>
  )
}

function MessageMoreMenu({
  hasDetails,
  onShowDetails,
  settings,
  onSettingsChange,
}: {
  hasDetails: boolean
  onShowDetails?: () => void
  settings: Settings
  onSettingsChange: (settings: Settings) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="More"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {hasDetails && (
          <>
            <DropdownMenuItem onClick={onShowDetails}>
              Show details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuCheckboxItem
          checked={settings.displayChangesSummary}
          onCheckedChange={(checked) =>
            onSettingsChange({ ...settings, displayChangesSummary: checked === true })
          }
        >
          Show changes summary
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={settings.displayTokenUsage}
          onCheckedChange={(checked) =>
            onSettingsChange({ ...settings, displayTokenUsage: checked === true })
          }
        >
          Show token usage
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ChangesSummaryFrame({
  visible,
  toolCalls,
}: {
  visible: boolean
  toolCalls: ToolCall[]
}) {
  const hasChanges = getApplyPatchSummaryItems(toolCalls).length > 0
  if (!hasChanges) return null

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity,margin-top] duration-200 ease-out",
        visible ? "mt-3 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="overflow-hidden">
        <ChangesSummary toolCalls={toolCalls} className="mt-0" />
      </div>
    </div>
  )
}

function TokenUsageBadges({
  usage,
  enabled,
  className,
}: {
  usage?: MessageUsage
  enabled: boolean
  className?: string
}) {
  if (!enabled || !usage) return null

  const items = [
    { icon: ArrowDownToLine, value: formatTokenCount(usage.inputTokens), title: "Input tokens" },
    { icon: ArrowUpFromLine, value: formatTokenCount(usage.outputTokens), title: "Output tokens" },
    { icon: Hash, value: formatTokenCount(usage.totalTokens), title: "Total token usage" },
    { icon: Gauge, value: formatContextUsage(usage), title: "Usage of context" },
    { icon: Cpu, value: formatModelValue(usage), title: "Model used for generating this message" },
    { icon: Brain, value: usage.reasoningLevel, title: "Reasoning used for generating this message" },
  ].filter((item) => item.value)

  if (items.length === 0) return null

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <span
            key={item.title}
            className="inline-flex min-w-0 max-w-28 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 tabular-nums"
            title={item.title}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="truncate">{item.value}</span>
          </span>
        )
      })}
    </div>
  )
}

function formatTokenCount(value?: number) {
  if (value === undefined) return undefined
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard" }).format(value)
}

function formatContextUsage(usage: MessageUsage) {
  if (usage.contextUsagePercent !== undefined) return `${Math.round(usage.contextUsagePercent)}%`
  if (usage.contextTokens === undefined) return undefined
  if (!usage.contextCapacityTokens) return undefined
  const percent = Math.round((usage.contextTokens / usage.contextCapacityTokens) * 100)
  return `${percent}%`
}

function formatModelValue(usage: MessageUsage) {
  const model = usage.model || usage.modelProvider
  if (!model) return undefined
  const parts = model.split("/").filter(Boolean)
  return parts[parts.length - 1] || model
}

function getResponseStartIndex(messages: Message[], index: number) {
  for (let i = index; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return i + 1
  }
  return 0
}

function getResponseToolCalls(messages: Message[], index: number) {
  if (index < 0) return []
  const start = getResponseStartIndex(messages, index)
  return messages.slice(start, index + 1).flatMap((message) => message.toolCalls || [])
}

export function getCurrentResponseToolCalls(messages: Message[]) {
  const lastUserIndex = [...messages].map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index
  if (lastUserIndex === undefined) return []
  return messages.slice(lastUserIndex + 1).flatMap((message) => message.toolCalls || [])
}

function TypingIndicator({ activity }: { activity?: AgentActivity | null }) {
  if (activity?.active) {
    return <AgentStatusIndicator activity={activity} className="w-fit" />
  }

  return null
}

interface MessageContentProps {
  content: string
  workspaceRoot?: string
  workspaceSessionKey?: string
}

function MessageContent({ content, workspaceRoot, workspaceSessionKey }: MessageContentProps) {
  const parts = content.split(/(```[\s\S]*?```)/g)

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("```")) {
          const match = part.match(/```(\w+)?\n([\s\S]*?)```/)
          if (match) {
            const [, language, code] = match
            return (
              <CodeBlock key={index} language={language || "text"} code={code.trim()} />
            )
          }
        }

        const lines = part.split("\n\n")
        return lines.map((line, lineIndex) => {
          if (line.startsWith("## ")) {
            return (
              <h2 key={`${index}-${lineIndex}`} className="mb-3 mt-6 text-base font-semibold text-foreground first:mt-0">
                {line.replace("## ", "")}
              </h2>
            )
          }
          if (line.startsWith("1. ") || line.startsWith("- ")) {
            const items = line.split("\n").filter(Boolean)
            const isOrdered = line.startsWith("1. ")
            const ListTag = isOrdered ? "ol" : "ul"
            return (
              <ListTag
                key={`${index}-${lineIndex}`}
                className={cn(
                  "my-3 space-y-1 pl-4",
                  isOrdered ? "list-decimal" : "list-disc"
                )}
              >
                {items.map((item, i) => (
                  <li key={i} className="text-foreground/90">
                    {formatInlineContent(
                      item.replace(/^(\d+\.\s|-\s)/, ""),
                      workspaceRoot,
                      workspaceSessionKey
                    )}
                  </li>
                ))}
              </ListTag>
            )
          }
          if (line.trim()) {
            return (
              <p key={`${index}-${lineIndex}`} className="my-3 whitespace-pre-wrap leading-relaxed text-foreground/90 first:mt-0">
                {formatInlineContent(line, workspaceRoot, workspaceSessionKey)}
              </p>
            )
          }
          return null
        })
      })}
    </>
  )
}

function isLocalFileHref(href: string) {
  return (
    href.startsWith("/workspace/") ||
    href === "/workspace" ||
    href.startsWith("/home/") ||
    href.startsWith("/tmp/")
  )
}

function getFileDeepLink(href: string, workspaceRoot?: string, workspaceSessionKey?: string) {
  const params = new URLSearchParams({ path: href })
  if (workspaceRoot) {
    params.set("root", workspaceRoot)
  }
  if (workspaceSessionKey) {
    params.set("session", workspaceSessionKey)
  }
  return `/api/open-file?${params.toString()}`
}

function formatInlineContent(text: string, workspaceRoot?: string, workspaceSessionKey?: string) {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return formatInlineLinksAndBold(part, `text-${i}`, workspaceRoot, workspaceSessionKey)
  })
}

function formatInlineLinksAndBold(
  text: string,
  keyPrefix: string,
  workspaceRoot?: string,
  workspaceSessionKey?: string
) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g)

  return parts.map((part, index) => {
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      const [, label, href] = linkMatch
      const localFile = isLocalFileHref(href)
      return (
        <a
          key={`${keyPrefix}-link-${index}`}
          href={localFile ? getFileDeepLink(href, workspaceRoot, workspaceSessionKey) : href}
          target={localFile ? undefined : "_blank"}
          rel={localFile ? undefined : "noreferrer"}
          title={localFile ? `Open ${href}` : href}
          className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          {label}
        </a>
      )
    }

    if (part.includes("**")) {
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g)
      return boldParts.map((boldPart, boldIndex) => {
        if (boldPart.startsWith("**") && boldPart.endsWith("**")) {
          return (
            <strong key={`${keyPrefix}-bold-${index}-${boldIndex}`}>
              {boldPart.slice(2, -2)}
            </strong>
          )
        }
        return boldPart
      })
    }

    return part
  })
}

interface CodeBlockProps {
  language: string
  code: string
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group/code my-4 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{language}</span>
        <button
          onClick={handleCopy}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover/code:opacity-100"
          title="Copy code"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 thin-scrollbar">
        <code className="font-mono text-xs leading-relaxed text-foreground/90">{code}</code>
      </pre>
    </div>
  )
}
