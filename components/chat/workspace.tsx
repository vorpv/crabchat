"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import { ChatSidebar } from "@/components/chat/sidebar"
import { ChatHeader } from "@/components/chat/header"
import { ChatTranscript } from "@/components/chat/transcript"
import { ChatComposer } from "@/components/chat/composer"
import { SettingsDialog } from "@/components/chat/settings-dialog"
import { SearchDialog } from "@/components/chat/search-dialog"
import { RenameDialog } from "@/components/chat/rename-dialog"
import { DeleteDialog } from "@/components/chat/delete-dialog"
import { Button } from "@/components/ui/button"
import {
  checkStatus,
  createSession,
  exportConversation,
  fetchHistory,
  fetchSessions,
  isMissingAuth,
  NEW_CHAT_ID,
  readJsonStorage,
  removeSession,
  renameSession,
  sendChatMessage,
  writeJsonStorage,
} from "@/lib/client-api"
import type { Attachment, Message, Session, Settings } from "@/lib/types"

hljs.registerLanguage("bash", bash)

const SETTINGS_KEY = "openclaw-chat-settings"
const PINNED_KEY = "openclaw-pinned-sessions"

const defaultSettings: Settings = {
  theme: "system",
  showToolMessages: true,
  showReasoningBlocks: false,
  thinkingLevel: "medium",
}

interface SentAttachment {
  file: File
  preview?: string
  data: string
  type: string
}

export function ChatWorkspace() {
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState(NEW_CHAT_ID)
  const [historyCache, setHistoryCache] = useState<Record<string, Message[]>>({
    [NEW_CHAT_ID]: [],
  })
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [isResponding, setIsResponding] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [retryingStatus, setRetryingStatus] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sessionToModify, setSessionToModify] = useState<Session | null>(null)

  const [settings, setSettings] = useState<Settings>(defaultSettings)

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const activeMessages = historyCache[activeSessionId] ?? []
  const contextUsage = 0

  const sessionsWithPins = useMemo(
    () =>
      sessions.map((session) => ({
        ...session,
        pinned: pinnedIds.has(session.id),
      })),
    [sessions, pinnedIds]
  )

  const navigateToSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    const url = new URL(window.location.href)
    if (sessionId === NEW_CHAT_ID) {
      url.searchParams.delete("session")
    } else {
      url.searchParams.set("session", sessionId)
    }
    window.history.pushState({}, "", url)
  }, [])

  const applyMissingAuth = useCallback(() => {
    setSetupRequired(true)
    setStatusError(null)
  }, [])

  const loadSessionList = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const loadedSessions = await fetchSessions()
      setSessions(loadedSessions)
      setSetupRequired(false)

      const urlSession = new URLSearchParams(window.location.search).get("session")
      const nextSession = urlSession || loadedSessions[0]?.id || NEW_CHAT_ID
      setActiveSessionId(nextSession)
    } catch (error) {
      if (isMissingAuth(error)) {
        applyMissingAuth()
      } else {
        setStatusError(error instanceof Error ? error.message : "Could not load sessions")
      }
    } finally {
      setLoadingSessions(false)
    }
  }, [applyMissingAuth])

  const refreshStatus = useCallback(async () => {
    setRetryingStatus(true)
    try {
      await checkStatus()
      setStatusError(null)
      setSetupRequired(false)
    } catch (error) {
      if (isMissingAuth(error)) {
        applyMissingAuth()
      } else {
        setStatusError(error instanceof Error ? error.message : "Gateway status check failed")
      }
    } finally {
      setRetryingStatus(false)
    }
  }, [applyMissingAuth])

  const loadActiveHistory = useCallback(
    async (sessionId: string) => {
      if (sessionId === NEW_CHAT_ID) return
      try {
        const gatewaySessionId =
          sessions.find((session) => session.id === sessionId)?.key || sessionId
        const messages = await fetchHistory(gatewaySessionId)
        setHistoryCache((cache) => ({ ...cache, [sessionId]: messages }))
      } catch (error) {
        if (isMissingAuth(error)) {
          applyMissingAuth()
        } else {
          setStatusError(error instanceof Error ? error.message : "Could not load history")
          navigateToSession(NEW_CHAT_ID)
        }
      }
    },
    [applyMissingAuth, navigateToSession, sessions]
  )

  useEffect(() => {
    setSettings(readJsonStorage(SETTINGS_KEY, defaultSettings))
    setPinnedIds(new Set(readJsonStorage<string[]>(PINNED_KEY, [])))
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)")
    const syncSidebarWithViewport = () => setSidebarExpanded(mediaQuery.matches)

    syncSidebarWithViewport()
    mediaQuery.addEventListener("change", syncSidebarWithViewport)

    return () => mediaQuery.removeEventListener("change", syncSidebarWithViewport)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)")

    const applyTheme = () => {
      const shouldUseDark =
        settings.theme === "dark" ||
        (settings.theme === "system" && systemPrefersDark.matches)
      root.classList.toggle("dark", shouldUseDark)
    }

    applyTheme()
    writeJsonStorage(SETTINGS_KEY, settings)
    systemPrefersDark.addEventListener("change", applyTheme)

    return () => systemPrefersDark.removeEventListener("change", applyTheme)
  }, [settings])

  useEffect(() => {
    loadSessionList()
  }, [loadSessionList])

  useEffect(() => {
    loadActiveHistory(activeSessionId)
  }, [activeSessionId, loadActiveHistory])

  useEffect(() => {
    if (!isResponding || activeSessionId === NEW_CHAT_ID) return

    const timeout = setTimeout(async () => {
      await loadActiveHistory(activeSessionId)
      setIsResponding(false)
    }, 120_000)

    return () => clearTimeout(timeout)
  }, [activeSessionId, isResponding, loadActiveHistory])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCommand = event.metaKey || event.ctrlKey
      if (event.shiftKey && isCommand && event.key.toLowerCase() === "o") {
        event.preventDefault()
        handleNewSession()
      }
      if (isCommand && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen(true)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  })

  const handleNewSession = () => {
    setHistoryCache((cache) => ({ ...cache, [NEW_CHAT_ID]: [] }))
    setIsResponding(false)
    navigateToSession(NEW_CHAT_ID)
    if (window.innerWidth < 768) {
      setSidebarExpanded(false)
    }
  }

  const handleSelectSession = (sessionId: string) => {
    navigateToSession(sessionId)
    setIsResponding(false)
    if (window.innerWidth < 768) {
      setSidebarExpanded(false)
    }
  }

  const handlePinSession = (sessionId: string) => {
    setPinnedIds((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      writeJsonStorage(PINNED_KEY, Array.from(next))
      return next
    })
  }

  const handleRenameSession = (session: Session) => {
    setSessionToModify(session)
    setRenameDialogOpen(true)
  }

  const handleDeleteSession = (session: Session) => {
    setSessionToModify(session)
    setDeleteDialogOpen(true)
  }

  const handleConfirmRename = async (newTitle: string) => {
    if (!sessionToModify) return

    const previousSessions = sessions
    const identifier = sessionToModify.key || sessionToModify.id
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionToModify.id ? { ...session, title: newTitle } : session
      )
    )
    setRenameDialogOpen(false)
    setSessionToModify(null)

    try {
      const updated = await renameSession(identifier, newTitle)
      setSessions((current) =>
        current.map((session) => (session.id === sessionToModify.id ? updated : session))
      )
    } catch (error) {
      setSessions(previousSessions)
      if (isMissingAuth(error)) applyMissingAuth()
      else setStatusError(error instanceof Error ? error.message : "Could not rename session")
      await loadSessionList()
    }
  }

  const handleConfirmDelete = async () => {
    if (!sessionToModify) return

    const previousSessions = sessions
    const identifier = sessionToModify.key || sessionToModify.id
    setSessions((current) => current.filter((session) => session.id !== sessionToModify.id))
    if (activeSessionId === sessionToModify.id) {
      navigateToSession(NEW_CHAT_ID)
    }
    setDeleteDialogOpen(false)
    setSessionToModify(null)

    try {
      await removeSession(identifier)
      await loadSessionList()
    } catch (error) {
      setSessions(previousSessions)
      if (isMissingAuth(error)) applyMissingAuth()
      else setStatusError(error instanceof Error ? error.message : "Could not delete session")
    }
  }

  const handleSendMessage = async (content: string, attachments?: SentAttachment[]) => {
    if (isResponding) return

    const trimmedContent = content.trim()
    const validAttachments: Attachment[] =
      attachments?.map(({ file, preview, data, type }) => ({
        name: file.name,
        size: file.size,
        type,
        url: preview,
        data,
      })) ?? []
    if (!trimmedContent && validAttachments.length === 0) return

    const optimisticMessage: Message = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      content: trimmedContent,
      timestamp: new Date(),
      attachments: validAttachments,
      status: "sending",
    }

    const optimisticSessionId = activeSessionId
    setHistoryCache((cache) => ({
      ...cache,
      [optimisticSessionId]: [...(cache[optimisticSessionId] ?? []), optimisticMessage],
    }))
    setIsResponding(true)

    try {
      let sessionId = optimisticSessionId
      let gatewaySessionId =
        sessions.find((session) => session.id === sessionId)?.key || sessionId
      if (sessionId === NEW_CHAT_ID) {
        const created = await createSession(trimmedContent.slice(0, 80) || undefined)
        setSessions((current) => [created, ...current])
        setHistoryCache((cache) => ({
          ...cache,
          [created.id]: cache[NEW_CHAT_ID] ?? [optimisticMessage],
          [NEW_CHAT_ID]: [],
        }))
        sessionId = created.id
        gatewaySessionId = created.key || created.id
        navigateToSession(created.id)
      }

      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? { ...session, lastMessage: trimmedContent, updatedAt: new Date() }
            : session
        )
      )

      await sendChatMessage({
        sessionId: gatewaySessionId,
        text: trimmedContent,
        thinkingLevel: settings.thinkingLevel,
        attachments: validAttachments,
      })

      setHistoryCache((cache) => ({
        ...cache,
        [sessionId]: (cache[sessionId] ?? []).map((message) =>
          message.id === optimisticMessage.id ? { ...message, status: "sent" } : message
        ),
      }))

      setTimeout(async () => {
        await loadActiveHistory(sessionId)
        setIsResponding(false)
      }, 1200)
    } catch (error) {
      if (isMissingAuth(error)) {
        applyMissingAuth()
      } else {
        setHistoryCache((cache) => ({
          ...cache,
          [optimisticSessionId]: (cache[optimisticSessionId] ?? []).map((message) =>
            message.id === optimisticMessage.id
              ? {
                  ...message,
                  status: "error",
                  error: error instanceof Error ? error.message : "Send failed",
                }
              : message
          ),
        }))
        setStatusError(error instanceof Error ? error.message : "Send failed")
      }
      setIsResponding(false)
    }
  }

  return (
    <div className="relative h-screen overflow-hidden bg-background">
      <div
        className={
          setupRequired
            ? "pointer-events-none flex h-full overflow-hidden blur-sm"
            : "flex h-full overflow-hidden"
        }
        aria-hidden={setupRequired}
      >
        <ChatSidebar
          expanded={sidebarExpanded}
          onToggleExpanded={() => setSidebarExpanded(!sidebarExpanded)}
          sessions={sessionsWithPins}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onPinSession={handlePinSession}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatHeader
            title={
              activeSession?.title ??
              (loadingSessions ? "Loading sessions" : "New conversation")
            }
            contextUsage={contextUsage}
            onOpenSidebar={() => setSidebarExpanded(true)}
            sidebarExpanded={sidebarExpanded}
            onExport={(format) =>
              exportConversation(
                format,
                activeSession?.title ?? "Conversation",
                activeMessages
              )
            }
          />

          <ChatTranscript
            messages={activeMessages}
            isResponding={isResponding}
            showReasoningBlocks={settings.showReasoningBlocks}
            showToolMessages={settings.showToolMessages}
            gatewayError={statusError}
            onRetryGateway={refreshStatus}
            retryingGateway={retryingStatus}
          />

          <ChatComposer onSend={handleSendMessage} disabled={isResponding || setupRequired} />
        </div>
      </div>

      {setupRequired && <ConnectionSetupDialog onRetry={loadSessionList} />}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={setSettings}
      />

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        sessions={sessionsWithPins}
        onSelectSession={(id) => {
          handleSelectSession(id)
          setSearchOpen(false)
        }}
      />

      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        currentTitle={sessionToModify?.title ?? ""}
        onConfirm={handleConfirmRename}
      />

      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

function ConnectionSetupDialog({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-setup-title"
        className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-xl"
      >
        <div className="space-y-2">
          <h1
            id="connection-setup-title"
            className="font-[family-name:var(--font-rye)] text-3xl font-normal"
          >
            Connect to the gateway
          </h1>
          <p className="text-sm text-muted-foreground">
            The client needs access to the OpenClaw gateway before chat can begin.
          </p>
        </div>

        <SetupCodeBlock
          label="Set up environment variables"
          code={`OCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OCLAW_GATEWAY_TOKEN=your-token

# Optional, if you have password auth enabled or disabled toekn auth
OCLAW_GATEWAY_PASSWORD=your-password`}
        />
        <p className="mt-3 text-sm text-muted-foreground">
          Then restart Outclaw server for changes to apply
        </p>

        <section className="mt-6 rounded-lg border border-border p-4">
          <h2 className="mb-2 text-sm font-medium">Where to find these values</h2>
          <p className="text-sm text-muted-foreground">
            If you deployed OpenClaw locally on this machine, the default gateway URL is{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              ws://127.0.0.1:18789
            </code>
            . To get a token, you can use OpenClaw CLI tool:
          </p>
          <SetupCodeBlock
            code="openclaw config get gateway.auth.token"
            compact
          />
        </section>

        <div className="mt-6 flex justify-end">
          <Button onClick={onRetry}>Retry</Button>
        </div>
      </div>
    </div>
  )
}

function SetupCodeBlock({
  label,
  code,
  compact = false,
}: {
  label?: string
  code: string
  compact?: boolean
}) {
  const highlightedCode = hljs.highlight(code, { language: "bash" }).value

  return (
    <section className={compact ? "mt-3" : "mt-6 space-y-2"}>
      {label && <h2 className="text-sm font-medium">{label}</h2>}
      <pre className="overflow-x-auto rounded-lg border border-border bg-card p-3 text-xs">
        <code
          className="font-mono leading-relaxed"
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
    </section>
  )
}
