"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Bot,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Search,
  Settings,
  MoreHorizontal,
  Pin,
  Pencil,
  Trash2,
} from "lucide-react"
import type { Agent, Session } from "@/lib/types"

interface ChatSidebarProps {
  expanded: boolean
  onToggleExpanded: () => void
  agents: Agent[]
  sessions: Session[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onNewSession: (agentId?: string) => void
  onOpenSearch: () => void
  onOpenSettings: () => void
  onPinSession: (id: string) => void
  onRenameSession: (session: Session) => void
  onDeleteSession: (session: Session) => void
}

export function ChatSidebar({
  expanded,
  onToggleExpanded,
  agents,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onOpenSearch,
  onOpenSettings,
  onPinSession,
  onRenameSession,
  onDeleteSession,
}: ChatSidebarProps) {
  const [collapsedAgentIds, setCollapsedAgentIds] = useState<Set<string>>(new Set())

  const agentGroups = useMemo(() => {
    const knownAgents = new Map(agents.map((agent) => [agent.id, agent]))
    const groups = new Map<
      string,
      { id: string; name: string; sessions: Session[] }
    >()

    for (const session of sessions) {
      const id = session.agentId || "unknown"
      const knownAgent = knownAgents.get(id)
      const name = session.agentName || knownAgent?.name || "Unknown agent"

      if (!groups.has(id)) {
        groups.set(id, { id, name, sessions: [] })
      }
      groups.get(id)?.sessions.push(session)
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.id === "unknown") return 1
      if (b.id === "unknown") return -1
      return a.name.localeCompare(b.name)
    })
  }, [agents, sessions])

  const flatSessions = useMemo(
    () =>
      sessions
        .slice()
        .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [sessions]
  )

  const toggleAgentGroup = (agentId: string) => {
    setCollapsedAgentIds((current) => {
      const next = new Set(current)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  return (
    <>
      {expanded && (
        <button
          aria-label="Close sidebar"
          className="fixed inset-0 z-30 bg-background/60 md:hidden"
          onClick={onToggleExpanded}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-sidebar transition-all duration-150 ease-out md:relative md:z-auto",
          expanded
            ? "w-72 translate-x-0"
            : "w-72 -translate-x-full md:w-12 md:translate-x-0"
        )}
      >
      {/* Header */}
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-border px-2",
          expanded ? "justify-between" : "justify-center"
        )}
      >
        {expanded && (
          <div className="flex h-8 items-center gap-2 px-2 text-sidebar-foreground">
            <img src="/hat.svg" alt="" className="h-5 w-5 dark:invert" />
            <span className="font-rye text-base tracking-wide">
              Outclaw
            </span>
          </div>
        )}
        <button
          onClick={onToggleExpanded}
          aria-label={expanded ? "Close sidebar" : "Open sidebar"}
          title={expanded ? "Close sidebar" : "Open sidebar"}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {expanded ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Actions */}
      <div className={cn("flex flex-col gap-1 p-2", !expanded && "items-center")}>
        <NewSessionButton
          expanded={expanded}
          agents={agents}
          onNewSession={onNewSession}
        />
        <ActionButton
          expanded={expanded}
          icon={Search}
          label="Search sessions"
          shortcut="Command K"
          onClick={onOpenSearch}
        />
      </div>

      {/* Session List */}
      <ScrollArea className="flex-1 thin-scrollbar">
        <div className="px-2 pb-2">
          {!expanded && (
            <div className="flex flex-col items-center gap-0.5">
              {flatSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  expanded={expanded}
                  isActive={session.id === activeSessionId}
                  onSelect={() => onSelectSession(session.id)}
                  onPin={() => onPinSession(session.id)}
                  onRename={() => onRenameSession(session)}
                  onDelete={() => onDeleteSession(session)}
                />
              ))}
            </div>
          )}

          {expanded &&
            agentGroups.map((group) => {
              const collapsed = collapsedAgentIds.has(group.id)
              const groupSessions = group.sessions
                .slice()
                .sort((a, b) => Number(b.pinned) - Number(a.pinned))

              return (
                <div key={group.id} className="mb-2">
                  <button
                    type="button"
                    onClick={() => toggleAgentGroup(group.id)}
                    className="mb-1 flex h-7 w-full items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  >
                    {collapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-left">{group.name}</span>
                    <span className="tabular-nums">{group.sessions.length}</span>
                  </button>

                  {!collapsed && (
                    <div className="flex flex-col gap-0.5">
                      {groupSessions.map((session) => (
                        <SessionRow
                          key={session.id}
                          session={session}
                          expanded={expanded}
                          isActive={session.id === activeSessionId}
                          onSelect={() => onSelectSession(session.id)}
                          onPin={() => onPinSession(session.id)}
                          onRename={() => onRenameSession(session)}
                          onDelete={() => onDeleteSession(session)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

          {sessions.length === 0 && expanded && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No sessions yet.
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div
        className={cn(
          "border-t border-border p-2",
          !expanded && "flex justify-center"
        )}
      >
        <ActionButton
          expanded={expanded}
          icon={Settings}
          label="Settings"
          onClick={onOpenSettings}
        />
      </div>
      </aside>
    </>
  )
}

interface NewSessionButtonProps {
  expanded: boolean
  agents: Agent[]
  onNewSession: (agentId?: string) => void
}

function NewSessionButton({
  expanded,
  agents,
  onNewSession,
}: NewSessionButtonProps) {
  const fallbackAgent = agents[0]

  if (!expanded && agents.length <= 1) {
    return (
      <button
        onClick={() => onNewSession(fallbackAgent?.id)}
        aria-label="New session"
        title="New session"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    )
  }

  if (agents.length === 0) {
    return (
      <ActionButton
        expanded={expanded}
        icon={Plus}
        label="New session"
        shortcut="Shift Command O"
        onClick={() => onNewSession()}
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="New session"
          title="New session"
          className={cn(
            "group flex h-8 items-center gap-2 rounded-lg text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
            expanded
              ? "w-full justify-start px-2"
              : "w-8 justify-center text-muted-foreground hover:text-sidebar-foreground"
          )}
        >
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
          {expanded && (
            <>
              <span className="truncate">New session</span>
              <span className="ml-auto text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                Shift Command O
              </span>
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {agents.map((agent) => (
          <DropdownMenuItem key={agent.id} onClick={() => onNewSession(agent.id)}>
            <Bot className="mr-2 h-4 w-4" />
            <span className="truncate">{agent.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ActionButtonProps {
  expanded: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  onClick: () => void
}

function ActionButton({
  expanded,
  icon: Icon,
  label,
  shortcut,
  onClick,
}: ActionButtonProps) {
  if (!expanded) {
    return (
      <button
        onClick={onClick}
        aria-label={label}
        title={label}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <Icon className="h-4 w-4" />
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className="group flex h-8 w-full items-center justify-start gap-2 rounded-lg px-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      {shortcut && (
        <span className="ml-auto text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {shortcut}
        </span>
      )}
    </button>
  )
}

interface SessionRowProps {
  session: Session
  expanded: boolean
  isActive: boolean
  onSelect: () => void
  onPin: () => void
  onRename: () => void
  onDelete: () => void
}

function SessionRow({
  session,
  expanded,
  isActive,
  onSelect,
  onPin,
  onRename,
  onDelete,
}: SessionRowProps) {
  if (!expanded) {
    return (
      <button
        onClick={onSelect}
        aria-label={session.title}
        title={session.title}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        )}
      >
        <MessageSquare className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
    >
      {session.pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />}
      <span className="flex-1 truncate">{session.title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open menu for ${session.title}`}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={onPin}>
            <Pin className="mr-2 h-4 w-4" />
            {session.pinned ? "Unpin session" : "Pin session"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
