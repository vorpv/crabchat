"use client"

import { useRef, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Copy, Check, ChevronDown, ChevronRight, AlertCircle, FileIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Message, ToolCall } from "@/lib/types"

interface ChatTranscriptProps {
  messages: Message[]
  isResponding?: boolean
  showReasoningBlocks?: boolean
  showToolMessages?: boolean
  gatewayError?: string | null
  onRetryGateway?: () => void
  retryingGateway?: boolean
}

export function ChatTranscript({
  messages,
  isResponding = false,
  showReasoningBlocks = true,
  showToolMessages = true,
  gatewayError,
  onRetryGateway,
  retryingGateway = false,
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
            message={message}
            showReasoningBlocks={showReasoningBlocks}
            showToolMessages={showToolMessages}
          />
        ))}
        {isResponding && <TypingIndicator />}
      </div>
    </div>
  )
}

interface MessageGroupProps {
  message: Message
  showReasoningBlocks: boolean
  showToolMessages: boolean
}

function MessageGroup({
  message,
  showReasoningBlocks,
  showToolMessages,
}: MessageGroupProps) {
  const [copied, setCopied] = useState(false)
  const [displayTime, setDisplayTime] = useState<string>("")

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

  return (
    <div className="flex flex-col gap-2">
      {showReasoningBlocks && message.reasoning && (
        <ReasoningBlock content={message.reasoning} />
      )}
      {showToolMessages && message.toolCalls && message.toolCalls.length > 0 && (
        <div className="space-y-2">
          {message.toolCalls.map((tool) => (
            <ToolBlock key={tool.id} tool={tool} />
          ))}
        </div>
      )}
      <div className="group relative">
        <div className="prose prose-sm prose-invert max-w-none text-foreground">
          <MessageContent content={message.content} />
        </div>
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
          <span className="text-xs text-muted-foreground">
            {displayTime}
          </span>
        </div>
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground/60" />
      <span>Assistant is typing</span>
    </div>
  )
}

interface MessageContentProps {
  content: string
}

function MessageContent({ content }: MessageContentProps) {
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
                    {item.replace(/^(\d+\.\s|-\s)/, "")}
                  </li>
                ))}
              </ListTag>
            )
          }
          if (line.trim()) {
            return (
              <p key={`${index}-${lineIndex}`} className="my-3 whitespace-pre-wrap leading-relaxed text-foreground/90 first:mt-0">
                {formatInlineCode(line)}
              </p>
            )
          }
          return null
        })
      })}
    </>
  )
}

function formatInlineCode(text: string) {
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
    if (part.includes("**")) {
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g)
      return boldParts.map((bp, j) => {
        if (bp.startsWith("**") && bp.endsWith("**")) {
          return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>
        }
        return bp
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

interface ReasoningBlockProps {
  content: string
}

function ReasoningBlock({ content }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-muted/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <span className="font-medium">Reasoning</span>
      </button>
      {expanded && (
        <div className="whitespace-pre-wrap border-t border-border px-3 py-2 text-sm text-muted-foreground">
          {content}
        </div>
      )}
    </div>
  )
}

interface ToolBlockProps {
  tool: ToolCall
}

function ToolBlock({ tool }: ToolBlockProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={cn(
        "rounded-lg border",
        tool.status === "error"
          ? "border-destructive/50 bg-destructive/10"
          : "border-border bg-muted/30"
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        {tool.status === "error" && (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
        <span className="font-mono text-xs">{tool.name}</span>
        <span
          className={cn(
            "ml-auto text-xs",
            tool.status === "error" ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {tool.status === "pending"
            ? "Running..."
            : tool.status === "error"
              ? "Error"
              : "Complete"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2">
          {tool.input && (
            <div className="mb-2">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Input
              </div>
              <pre className="overflow-x-auto rounded bg-background p-2 text-xs thin-scrollbar">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          )}
          {tool.output && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Output
              </div>
              <pre className="overflow-x-auto rounded bg-background p-2 text-xs thin-scrollbar">
                {tool.output}
              </pre>
            </div>
          )}
          {tool.error && (
            <div>
              <div className="mb-1 text-xs font-medium text-destructive">
                Error
              </div>
              <pre className="overflow-x-auto rounded bg-background p-2 text-xs text-destructive thin-scrollbar">
                {tool.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
