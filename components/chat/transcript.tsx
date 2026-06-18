"use client"

import { useRef, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Copy, Check, AlertCircle, FileIcon, MoreHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AgentStatusIndicator } from "@/components/chat/agent-status"
import { ChangesSummary, ExecutionDetails } from "@/components/chat/execution-details"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AgentActivity, Message, ToolCall } from "@/lib/types"

interface ChatTranscriptProps {
  messages: Message[]
  workspaceRoot?: string
  workspaceSessionKey?: string
  isResponding?: boolean
  agentActivity?: AgentActivity | null
  displayChangesSummary?: boolean
  gatewayError?: string | null
  onRetryGateway?: () => void
  retryingGateway?: boolean
}

export function ChatTranscript({
  messages,
  workspaceRoot,
  workspaceSessionKey,
  isResponding = false,
  agentActivity,
  displayChangesSummary = true,
  gatewayError,
  onRetryGateway,
  retryingGateway = false,
}: ChatTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [detailsMessage, setDetailsMessage] = useState<{
    title: string
    toolCalls: ToolCall[]
  } | null>(null)

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
            displayChangesSummary={displayChangesSummary}
            onShowDetails={(title, toolCalls) => setDetailsMessage({ title, toolCalls })}
          />
        ))}
        {isResponding && (
          <LiveExecutionDetails messages={messages} activity={agentActivity} />
        )}
        {isResponding && <TypingIndicator activity={agentActivity} />}
      </div>
      {detailsMessage && (
        <ExecutionDetailsPanel
          title={detailsMessage.title}
          toolCalls={detailsMessage.toolCalls}
          onClose={() => setDetailsMessage(null)}
        />
      )}
    </div>
  )
}

interface MessageGroupProps {
  messages: Message[]
  message: Message
  workspaceRoot?: string
  workspaceSessionKey?: string
  displayChangesSummary: boolean
  onShowDetails: (title: string, toolCalls: ToolCall[]) => void
}

function MessageGroup({
  messages,
  message,
  workspaceRoot,
  workspaceSessionKey,
  displayChangesSummary,
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
          <div className="absolute -bottom-6 right-0 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
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
            <span className="text-xs text-muted-foreground">
              {displayTime}
            </span>
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
        {displayChangesSummary && message.content.trim() && (
          <ChangesSummary toolCalls={responseToolCalls} />
        )}
        <div className="mt-2 flex items-center gap-2 opacity-100 transition-opacity group-hover:opacity-100 md:opacity-0">
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
          {hasDetails && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="More"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-36">
                <DropdownMenuItem
                  onClick={() => onShowDetails("Execution details", responseToolCalls)}
                >
                  Show details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <span className="text-xs text-muted-foreground">
            {displayTime}
          </span>
        </div>
      </div>
    </div>
  )
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

function getCurrentResponseToolCalls(messages: Message[]) {
  const lastUserIndex = [...messages].map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index
  if (lastUserIndex === undefined) return []
  return messages.slice(lastUserIndex + 1).flatMap((message) => message.toolCalls || [])
}

function LiveExecutionDetails({
  messages,
  activity,
}: {
  messages: Message[]
  activity?: AgentActivity | null
}) {
  const toolCalls = getCurrentResponseToolCalls(messages)
  if (toolCalls.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Execution details</span>
        {activity?.active && (
          <span className="truncate text-xs text-muted-foreground">{activity.label}</span>
        )}
      </div>
      <ExecutionDetails toolCalls={toolCalls} compact />
    </div>
  )
}

function ExecutionDetailsPanel({
  title,
  toolCalls,
  onClose,
}: {
  title: string
  toolCalls: ToolCall[]
  onClose: () => void
}) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <button
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        <ExecutionDetails toolCalls={toolCalls} />
      </div>
    </aside>
  )
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
