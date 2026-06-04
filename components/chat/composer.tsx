"use client"

import { useState, useRef, useEffect, type KeyboardEvent } from "react"
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
import { ImageIcon, SendHorizonal, X, FileIcon } from "lucide-react"

interface ChatComposerProps {
  onSend: (content: string, attachments?: SentAttachment[]) => void
  disabled: boolean
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

export function ChatComposer({ onSend, disabled }: ChatComposerProps) {
  const [content, setContent] = useState("")
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([])
  const [hoveredAttachment, setHoveredAttachment] = useState<AttachmentPreview | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [content])

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
    (content.trim() || attachments.some((attachment) => !attachment.error && attachment.data)) &&
    !disabled

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
            <div className="flex items-end gap-2 p-3">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                disabled={disabled}
                rows={1}
                className={cn(
                  "flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "thin-scrollbar"
                )}
              />

              <div className="flex items-center gap-1">
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
