"use client"

import { useState, useEffect } from "react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { MessageSquare } from "lucide-react"
import type { Session } from "@/lib/types"

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: Session[]
  onSelectSession: (id: string) => void
}

export function SearchDialog({
  open,
  onOpenChange,
  sessions,
  onSelectSession,
}: SearchDialogProps) {
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!open) {
      setSearch("")
    }
  }, [open])

  const filteredSessions = sessions.filter((session) =>
    session.title.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search sessions"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="thin-scrollbar">
        <CommandEmpty>No sessions found.</CommandEmpty>
        <CommandGroup heading="Sessions">
          {filteredSessions.map((session) => (
            <CommandItem
              key={session.id}
              value={session.title}
              onSelect={() => onSelectSession(session.id)}
              className="gap-2"
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{session.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="flex items-center gap-4 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
            ↑
          </kbd>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
            ↓
          </kbd>
          <span>Navigate</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
            ↵
          </kbd>
          <span>Open</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
            Esc
          </kbd>
          <span>Close</span>
        </div>
      </div>
    </CommandDialog>
  )
}
