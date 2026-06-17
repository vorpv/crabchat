"use client"

import { useState, useRef, useEffect, useCallback, useLayoutEffect, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ChevronDown, ChevronRight, FileIcon, ImageIcon, SendHorizonal, X } from "lucide-react"
import type {
  ModelOption,
  ModelReasoningSelection,
  ThinkingLevelOption,
} from "@/lib/types"

interface ChatComposerProps {
  onSend: (content: string, attachments?: SentAttachment[]) => void
  disabled: boolean
  models: ModelOption[]
  thinkingLevels: ThinkingLevelOption[]
  selection: ModelReasoningSelection
  onModelSelect: (modelId: string) => void
  onReasoningSelect: (reasoningLevel: string) => void
}

interface AttachmentPreview {
  file: File
  preview?: string
  data?: string
  error?: string
}

interface SentAttachment {
  file: File
  preview?: string
  data: string
  type: string
}

const VALID_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 1280
const TARGET_ENCODED_SIZE = 1_500_000
const TEXTAREA_LINE_HEIGHT = 20
const TEXTAREA_VERTICAL_PADDING = 12
const TEXTAREA_SINGLE_LINE_HEIGHT = 32
const TEXTAREA_MAX_HEIGHT = TEXTAREA_LINE_HEIGHT * 8 + TEXTAREA_VERTICAL_PADDING
const TEXTAREA_COMPACT_GAP = 8

let textMeasureCanvas: HTMLCanvasElement | null = null

function measureLongestLineWidth(textarea: HTMLTextAreaElement, value: string) {
  if (!textMeasureCanvas) {
    textMeasureCanvas = document.createElement("canvas")
  }

  const context = textMeasureCanvas.getContext("2d")
  if (!context) {
    return 0
  }

  const styles = window.getComputedStyle(textarea)
  context.font = styles.font

  return value
    .split("\n")
    .reduce((maxWidth, line) => Math.max(maxWidth, context.measureText(line || " ").width), 0)
}

export function ChatComposer({
  onSend,
  disabled,
  models,
  thinkingLevels,
  selection,
  onModelSelect,
  onReasoningSelect,
}: ChatComposerProps) {
  const [content, setContent] = useState("")
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([])
  const [hoveredAttachment, setHoveredAttachment] = useState<AttachmentPreview | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null)
  const [textareaLayout, setTextareaLayout] = useState({
    multiline: false,
    scrollable: false,
  })
  const [actionsRegrouping, setActionsRegrouping] = useState(false)
  const composerInputRef = useRef<HTMLDivElement>(null)
  const composerActionsRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const didObserveLayoutModeRef = useRef(false)
  const contentRef = useRef(content)
  contentRef.current = content

  const syncTextareaLayout = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    const previousHeight = textarea.offsetHeight
    textarea.style.height = "auto"
    const scrollHeight = textarea.scrollHeight
    const nextHeight = Math.max(
      TEXTAREA_SINGLE_LINE_HEIGHT,
      Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)
    )

    if (previousHeight > 0 && Math.abs(previousHeight - nextHeight) > 1) {
      textarea.style.height = `${previousHeight}px`
      void textarea.offsetHeight
    }
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden"

    const composerWidth = composerInputRef.current?.clientWidth ?? textarea.clientWidth
    const actionsWidth = composerActionsRef.current?.offsetWidth ?? 0
    const compactTextareaWidth = Math.max(
      0,
      composerWidth - actionsWidth - TEXTAREA_COMPACT_GAP
    )
    const longestLineWidth =
      measureLongestLineWidth(textarea, contentRef.current) + TEXTAREA_VERTICAL_PADDING
    const overflowsCompactRow =
      compactTextareaWidth > 0 && longestLineWidth > compactTextareaWidth + 1
    const nextLayout = {
      multiline: overflowsCompactRow || scrollHeight > TEXTAREA_SINGLE_LINE_HEIGHT + 2,
      scrollable: scrollHeight > TEXTAREA_MAX_HEIGHT + 1,
    }

    setTextareaLayout((current) =>
      current.multiline === nextLayout.multiline && current.scrollable === nextLayout.scrollable
        ? current
        : nextLayout
    )
  }, [])

  useLayoutEffect(() => {
    syncTextareaLayout()
  }, [content, syncTextareaLayout, textareaLayout.multiline])

  useEffect(() => {
    if (!didObserveLayoutModeRef.current) {
      didObserveLayoutModeRef.current = true
      return
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return
    }

    setActionsRegrouping(true)
    const timeout = window.setTimeout(() => setActionsRegrouping(false), 160)
    return () => window.clearTimeout(timeout)
  }, [textareaLayout.multiline])

  useEffect(() => {
    window.addEventListener("resize", syncTextareaLayout)
    return () => window.removeEventListener("resize", syncTextareaLayout)
  }, [syncTextareaLayout])

  useEffect(() => {
    if (modelPickerOpen && selection.model) {
      setExpandedModelId(selection.model)
    }
  }, [modelPickerOpen, selection.model])

  useEffect(() => {
    if (!modelPickerOpen) {
      setExpandedModelId(null)
    }
  }, [modelPickerOpen])

  const handleSend = () => {
    if (disabled) return
    const validAttachments = attachments.filter(
      (attachment) => !attachment.error && attachment.data
    )
    if (!content.trim() && validAttachments.length === 0) return

    onSend(
      content.trim(),
      validAttachments.length > 0
        ? validAttachments.map(({ file, preview, data }) => ({
            file,
            preview,
            data: data!,
            type: file.type,
          }))
        : undefined
    )
    setContent("")
    attachments.forEach((attachment) => {
      if (attachment.preview) URL.revokeObjectURL(attachment.preview)
    })
    setAttachments([])
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const newAttachments = await Promise.all(files.map(processAttachment))
    setAttachments([...attachments, ...newAttachments])
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleRemoveAttachment = (index: number) => {
    const attachment = attachments[index]
    if (attachment.preview) {
      URL.revokeObjectURL(attachment.preview)
    }
    setAttachments(attachments.filter((_, i) => i !== index))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getFileExtension = (name: string) => {
    const parts = name.split(".")
    return parts.length > 1 ? `.${parts.pop()}` : ""
  }

  const canSend =
    Boolean(selection.model) &&
    (content.trim() || attachments.some((attachment) => !attachment.error && attachment.data)) &&
    !disabled
  const selectedModel = models.find((model) => model.id === selection.model) ?? models[0]
  const selectedThinkingLevel =
    thinkingLevels.find((level) => level.id === selection.reasoningLevel)?.label ||
    selection.reasoningLevel
  const selectionLabel =
    models.length === 0
      ? "Loading models..."
      : selectedModel
        ? `${selectedModel.name} / ${selectedThinkingLevel}`
        : "Select model / reasoning"

  const handleModelClick = (model: ModelOption) => {
    onModelSelect(model.id)
    if (expandedModelId === model.id) {
      setExpandedModelId(null)
      return
    }
    setExpandedModelId(model.id)
  }

  const handleReasoningLevelSelect = (reasoningLevel: ModelReasoningSelection["reasoningLevel"]) => {
    onReasoningSelect(reasoningLevel)
    setModelPickerOpen(false)
  }

  return (
    <TooltipProvider delay={0}>
      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border border-border bg-card shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-ring">
            {/* Attachment Previews */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-border p-3">
                {attachments.map((attachment, index) => (
                  <Popover key={index} open={hoveredAttachment === attachment}>
                    <PopoverTrigger asChild>
                      <div
                        className={cn(
                          "group relative flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                          attachment.error
                            ? "border-destructive/50 bg-destructive/10"
                            : "border-border bg-muted/50 hover:bg-muted"
                        )}
                        onMouseEnter={() => setHoveredAttachment(attachment)}
                        onMouseLeave={() => setHoveredAttachment(null)}
                      >
                        {attachment.preview ? (
                          <div className="h-8 w-8 overflow-hidden rounded">
                            <img
                              src={attachment.preview}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                            <FileIcon className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="max-w-32">
                          <div className="truncate text-xs font-medium">
                            {attachment.file.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {attachment.error || (
                              <>
                                {getFileExtension(attachment.file.name)}{" "}
                                {formatFileSize(attachment.file.size)}
                              </>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${attachment.file.name}`}
                          onClick={() => handleRemoveAttachment(index)}
                          className="h-5 w-5 shrink-0 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="start"
                      className="w-auto p-2"
                    >
                      {attachment.preview && (
                        <img
                          src={attachment.preview}
                          alt=""
                          className="mb-2 max-h-48 max-w-64 rounded"
                        />
                      )}
                      <div className="text-sm font-medium">
                        {attachment.file.name.length > 40
                          ? `${attachment.file.name.slice(0, 40)}...`
                          : attachment.file.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatFileSize(attachment.file.size)}
                      </div>
                    </PopoverContent>
                  </Popover>
                ))}
              </div>
            )}

            {/* Text Input */}
            <div
              ref={composerInputRef}
              className={cn(
                "flex p-3 transition-[gap] duration-200 ease-out motion-reduce:transition-none",
                textareaLayout.multiline ? "flex-col items-stretch gap-2" : "items-center gap-2"
              )}
            >
              <div
                className={cn(
                  "relative min-w-0 transition-[width,flex-basis] duration-200 ease-out motion-reduce:transition-none",
                  textareaLayout.multiline ? "w-full" : "flex-1"
                )}
              >
                {textareaLayout.scrollable && (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-card to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-5 bg-gradient-to-t from-card to-transparent" />
                  </>
                )}
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  disabled={disabled}
                  rows={1}
                  className={cn(
                    "block w-full resize-none bg-transparent py-1.5 text-sm leading-5 text-foreground transition-[height] duration-200 ease-out motion-reduce:transition-none",
                    "placeholder:text-muted-foreground",
                    "focus:outline-none",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    textareaLayout.scrollable ? "thin-scrollbar pr-1" : "overflow-hidden"
                  )}
                />
              </div>

              <div
                ref={composerActionsRef}
                className={cn(
                  "flex items-center gap-1 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
                  textareaLayout.multiline ? "justify-end" : "shrink-0",
                  actionsRegrouping && "translate-y-0.5 opacity-80"
                )}
              >
                <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                    type="button"
                      aria-label="Select model and reasoning"
                      disabled={disabled || models.length === 0}
                      className={cn(
                        "inline-flex h-8 max-w-56 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                        "disabled:cursor-not-allowed disabled:opacity-50"
                      )}
                    >
                      <span className="truncate">{selectionLabel}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    side="top"
                    sideOffset={8}
                    className="w-80 gap-1 p-1.5"
                  >
                    {models.map((model) => {
                      const expanded = expandedModelId === model.id
                      const selected = selection.model === model.id

                      return (
                        <div key={model.id} className="rounded-md">
                          <button
                            type="button"
                            onClick={() => handleModelClick(model)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                              selected && "bg-accent/60 text-foreground"
                            )}
                          >
                            {expanded ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="min-w-0 flex-1 truncate">{model.name}</span>
                          </button>

                          {expanded && (
                            <div className="ml-5 mt-1 flex flex-col gap-0.5 border-l border-border pl-2">
                              {thinkingLevels.map((level) => (
                                <button
                                  key={`${model.id}-${level.id}`}
                                  type="button"
                                  onClick={() => handleReasoningLevelSelect(level.id)}
                                  className={cn(
                                    "rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                                    selection.model === model.id &&
                                      selection.reasoningLevel === level.id &&
                                      "bg-accent text-accent-foreground"
                                  )}
                                >
                                  {level.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </PopoverContent>
                </Popover>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={disabled}
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <ImageIcon className="h-4 w-4" />
                      <span className="sr-only">Attach image</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Attach image</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={!canSend}
                      className="h-8 w-8 rounded-full"
                    >
                      <SendHorizonal className="h-4 w-4" />
                      <span className="sr-only">Send message</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Send message</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

async function processAttachment(file: File): Promise<AttachmentPreview> {
  if (!VALID_IMAGE_TYPES.includes(file.type)) {
    return { file, error: "Unsupported image type" }
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return { file, error: "Image is larger than 10MB" }
  }

  const preview = URL.createObjectURL(file)

  try {
    const data = await resizeAndEncodeImage(file)
    return { file, preview, data }
  } catch {
    URL.revokeObjectURL(preview)
    return { file, error: "Could not process image" }
  }
}

async function resizeAndEncodeImage(file: File) {
  if (file.type === "image/gif") {
    return stripDataUrl(await fileToDataUrl(file))
  }

  const image = await loadImage(file)
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight)
  )
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas is unavailable")
  context.drawImage(image, 0, 0, width, height)

  if (file.type === "image/png") {
    return stripDataUrl(canvas.toDataURL("image/png"))
  }

  let quality = 0.86
  let dataUrl = canvas.toDataURL("image/jpeg", quality)
  while (dataUrl.length > TARGET_ENCODED_SIZE && quality > 0.5) {
    quality -= 0.08
    dataUrl = canvas.toDataURL("image/jpeg", quality)
  }
  return stripDataUrl(dataUrl)
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Image load failed"))
    }
    image.src = url
  })
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("File read failed"))
    reader.readAsDataURL(file)
  })
}

function stripDataUrl(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl
}
