"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import {
  ArrowLeft,
  FileText,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  SendToBack,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { deleteNote, fetchNotes, saveNote } from "@/lib/client-api"
import type { Agent, CrabChatNote } from "@/lib/types"

dayjs.extend(relativeTime)

type NotesFilter = "any" | "none" | "current" | string

function getNoteListLabel(note: CrabChatNote) {
  if (isGeneratedUntitledTitle(note.displayTitle)) {
    return note.content.trim() || "untitled"
  }
  return note.displayTitle
}

function isGeneratedUntitledTitle(value: string) {
  return /^untitled\d*$/.test(value)
}

function getEditorTitle(note: CrabChatNote) {
  return isGeneratedUntitledTitle(note.displayTitle) ? "" : note.title
}

function getSaveTitle(title: string, baseline: CrabChatNote) {
  if (!title.trim() && isGeneratedUntitledTitle(baseline.displayTitle)) {
    return baseline.displayTitle
  }
  return title
}

interface NotesBlockProps {
  agents: Agent[]
  currentAgentId?: string
  reloadKey: number
  useMonospaceFont: boolean
  onToPrompt: (text: string) => void
  onActionsChange: (actions: React.ReactNode) => void
}

export function NotesBlock({
  agents,
  currentAgentId,
  reloadKey,
  useMonospaceFont,
  onToPrompt,
  onActionsChange,
}: NotesBlockProps) {
  const [notes, setNotes] = useState<CrabChatNote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<NotesFilter>("any")
  const [editing, setEditing] = useState<CrabChatNote | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CrabChatNote | null>(null)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)

  const visibleNotes = useMemo(() => {
    return notes
      .filter((note) => note.kind !== "prompt")
      .filter((note) => {
        if (filter === "any") return true
        if (filter === "none") return !note.agentId
        if (filter === "current") return note.agentId === currentAgentId
        return note.agentId === filter
      })
  }, [currentAgentId, filter, notes])

  const loadNotes = async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await fetchNotes()
      setNotes(payload.notes)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load notes")
    } finally {
      setLoading(false)
    }
  }

  const createNote = async (agentId?: string) => {
    setAgentPickerOpen(false)
    setError(null)
    try {
      const result = await saveNote({
        title: "",
        agentId,
        content: "",
        kind: "note",
      })
      if ("conflict" in result) return
      setNotes((current) => [result.note, ...current])
      setEditing(result.note)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create note")
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    setNotes((current) => current.filter((note) => note.fileName !== target.fileName))
    try {
      await deleteNote(target.fileName)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete note")
      await loadNotes()
    }
  }

  useEffect(() => {
    void loadNotes()
  }, [reloadKey])

  useEffect(() => {
    onActionsChange(
      <>
        <button
          type="button"
          onClick={() => setAgentPickerOpen(true)}
          aria-label="Create note"
          title="Create note"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Filter notes"
              title="Filter notes"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Filter className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuRadioGroup value={filter} onValueChange={(value) => setFilter(value as NotesFilter)}>
              <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="none">No Agent</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="current" disabled={!currentAgentId}>
                Current Agent
              </DropdownMenuRadioItem>
              {agents.length > 0 && <DropdownMenuSeparator />}
              {agents.map((agent) => (
                <DropdownMenuRadioItem key={agent.id} value={agent.id}>
                  {agent.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={() => void loadNotes()}
          aria-label="Reload notes"
          title="Reload notes"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </>
    )
  }, [agents, currentAgentId, filter, loading, onActionsChange])

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {error && (
          <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
          {loading && notes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading notes
            </div>
          ) : visibleNotes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No notes
            </div>
          ) : (
            <div className="space-y-1">
              {visibleNotes.map((note) => (
                <button
                  key={note.fileName}
                  type="button"
                  onClick={() => setEditing(note)}
                  className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {getNoteListLabel(note)}
                  </span>
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {dayjs(note.updatedAt).fromNow()}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Delete note"
                    title="Delete note"
                    onClick={(event) => {
                      event.stopPropagation()
                      setDeleteTarget(note)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        event.stopPropagation()
                        setDeleteTarget(note)
                      }
                    }}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <NoteEditorDialog
        note={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={(note) => {
          setNotes((current) => [note, ...current.filter((item) => item.fileName !== note.fileName)])
          setEditing(note)
        }}
        onConflictLoad={(note) => {
          setNotes((current) => [note, ...current.filter((item) => item.fileName !== note.fileName)])
          setEditing(note)
        }}
        useMonospaceFont={useMonospaceFont}
        onToPrompt={onToPrompt}
      />

      <Dialog open={agentPickerOpen} onOpenChange={setAgentPickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create note</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => void createNote(undefined)}
              className="w-full rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              Create with no agent
            </button>
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => void createNote(agent.id)}
                className="w-full rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                {agent.name}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the note file from disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function NoteEditorDialog({
  note,
  onOpenChange,
  onSaved,
  onConflictLoad,
  useMonospaceFont,
  onToPrompt,
}: {
  note: CrabChatNote | null
  onOpenChange: (open: boolean) => void
  onSaved: (note: CrabChatNote) => void
  onConflictLoad: (note: CrabChatNote) => void
  useMonospaceFont: boolean
  onToPrompt: (text: string) => void
}) {
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [baseline, setBaseline] = useState<CrabChatNote | null>(null)
  const [status, setStatus] = useState<"" | "saving" | "saved">("")
  const [hasEdited, setHasEdited] = useState(false)
  const [conflict, setConflict] = useState<CrabChatNote | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!note) return
    setTitle(getEditorTitle(note))
    setContent(note.content)
    setBaseline(note)
    setStatus("")
    setHasEdited(false)
    setConflict(null)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [note])

  useEffect(() => {
    if (!note || !baseline) return
    if (!hasEdited) return
    if (title === baseline.title && content === baseline.content && note.kind === "note") return

    setStatus("saving")
    const timeout = window.setTimeout(async () => {
      try {
        const result = await saveNote({
          fileName: baseline.fileName,
          title: getSaveTitle(title, baseline),
          agentId: baseline.agentId,
          content,
          kind: "note",
          baseContent: baseline.content,
          baseUpdatedAt: baseline.updatedAt,
        })
        if ("conflict" in result) {
          setConflict(result.note)
          setStatus("saved")
          return
        }
        setBaseline(result.note)
        onSaved(result.note)
        setStatus("saved")
      } catch {
        setStatus("saved")
      }
    }, 450)

    return () => window.clearTimeout(timeout)
  }, [baseline, content, hasEdited, note, onSaved, title])

  const resolveConflict = async (resolution: "load" | "overwrite" | "separate") => {
    if (!baseline || !conflict) return
    if (resolution === "load") {
      setTitle(getEditorTitle(conflict))
      setContent(conflict.content)
      setBaseline(conflict)
      onConflictLoad(conflict)
      setConflict(null)
      return
    }

    const result = await saveNote({
      fileName: baseline.fileName,
      title: getSaveTitle(title, baseline),
      agentId: baseline.agentId,
      content,
      kind: "note",
      baseContent: baseline.content,
      baseUpdatedAt: baseline.updatedAt,
      conflictResolution: resolution,
    })
    if (!("conflict" in result)) {
      setBaseline(result.note)
      onSaved(result.note)
      setConflict(null)
      setStatus("saved")
    }
  }

  return (
    <>
      <Dialog open={Boolean(note)} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(86vh,52rem)] max-w-[calc(100vw-2rem)] grid-rows-none flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        >
          <DialogHeader className="shrink-0 border-b border-border px-3 py-2">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="justify-self-start">
                <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} title="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </div>
              <DialogTitle className="sr-only">Note</DialogTitle>
              <Input
                value={title}
                placeholder="Title (Optional)"
                onChange={(event) => {
                  setHasEdited(true)
                  setTitle(event.target.value)
                }}
                className="h-8 w-80 border-0 bg-transparent text-center shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center gap-2 justify-self-end">
                {status && (
                  <span className="min-w-14 text-right text-xs text-muted-foreground">
                    {status === "saving" ? "Saving..." : "Saved"}
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    onToPrompt(content)
                    onOpenChange(false)
                  }}
                >
                  <SendToBack className="h-3.5 w-3.5" />
                  To prompt
                </Button>
              </div>
            </div>
          </DialogHeader>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => {
              setHasEdited(true)
              setContent(event.target.value)
            }}
            className={cn(
              "min-h-0 flex-1 resize-none bg-background p-4 text-sm leading-6 outline-none custom-scrollbar",
              useMonospaceFont && "font-mono"
            )}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(conflict)} onOpenChange={(open) => !open && setConflict(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Note changed on disk</AlertDialogTitle>
            <AlertDialogDescription>
              CrabChat detected external edits before saving this note.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:flex-col sm:items-stretch">
            <Button variant="outline" onClick={() => void resolveConflict("load")}>
              Load from disk
            </Button>
            <Button variant="outline" onClick={() => void resolveConflict("separate")}>
              Save as separate note
            </Button>
            <Button onClick={() => void resolveConflict("overwrite")}>
              Overwrite disk version
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
