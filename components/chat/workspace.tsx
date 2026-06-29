"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import { ChatSidebar } from "@/components/chat/sidebar"
import { ChatHeader } from "@/components/chat/header"
import { ChatTranscript, getCurrentResponseToolCalls } from "@/components/chat/transcript"
import { ChatComposer } from "@/components/chat/composer"
import { NotesBlock } from "@/components/chat/notes-block"
import { CrabChatPanel, type CrabChatPanelBlock } from "@/components/chat/right-panel"
import { ExecutionDetails } from "@/components/chat/execution-details"
import { SettingsDialog } from "@/components/chat/settings-dialog"
import { SearchDialog } from "@/components/chat/search-dialog"
import { RenameDialog } from "@/components/chat/rename-dialog"
import { DeleteDialog } from "@/components/chat/delete-dialog"
import { Button } from "@/components/ui/button"
import {
  checkStatus,
  createSession,
  exportConversation,
  fetchAgents,
  fetchCrabChatState,
  fetchHistory,
  fetchModels,
  fetchSessions,
  fetchUsageStatus,
  isMissingAuth,
  NEW_CHAT_ID,
  patchSessionPreferences,
  removeSession,
  renameSession,
  deleteNote,
  saveCrabChatState,
  saveNote,
  sendChatMessage,
} from "@/lib/client-api"
import {
  buildModelOptionFromRef,
  dedupeModelsById,
  getDefaultsModelId,
  getModelContextCapacity,
  getPreferredThinkingLevel,
  getSessionModelId,
  getThinkingLevels,
  getTransientAgentActivity,
  hasEquivalentVisibleModel,
  mergeSessionUpdate,
  normalizeProviderId,
  resolveConfiguredAgentModels,
} from "@/components/chat/workspace-helpers"
import type {
  Agent,
  AgentActivity,
  Attachment,
  ContextWindowStatus,
  CrabChatFeatures,
  CrabChatNote,
  Message,
  ModelOption,
  ModelReasoningSelection,
  ProviderUsageSummary,
  Session,
  SessionDefaults,
  Settings,
  ThinkingLevelOption,
  ToolCall,
  UsageStatus,
} from "@/lib/types"

hljs.registerLanguage("bash", bash)

const RESPONSE_POLL_INTERVAL_MS = 1_200
const RESPONSE_POLL_TIMEOUT_MS = 120_000

const defaultSettings: Settings = {
  theme: "system",
  displayChangesSummary: true,
  displayTokenUsage: false,
}

const defaultFeatures: CrabChatFeatures = {
  archiving: {
    enabled: true,
  },
  notes: {
    enabled: true,
    autoSavePrompts: true,
    manualPromptSaving: false,
    useMonospaceFont: false,
    storagePath: "",
  },
}

interface SentAttachment {
  file: File
  preview?: string
  data: string
  type: string
}

export function ChatWorkspace() {
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [agents, setAgents] = useState<Agent[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [usageStatus, setUsageStatus] = useState<UsageStatus | null>(null)
  const [modelSelection, setModelSelection] = useState<ModelReasoningSelection>({
    model: "",
    reasoningLevel: "medium",
  })
  const [newSessionAgentId, setNewSessionAgentId] = useState<string | undefined>()
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionDefaults, setSessionDefaults] = useState<SessionDefaults>({})
  const [activeSessionId, setActiveSessionId] = useState(NEW_CHAT_ID)
  const [historyCache, setHistoryCache] = useState<Record<string, Message[]>>({
    [NEW_CHAT_ID]: [],
  })
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [isResponding, setIsResponding] = useState(false)
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [retryingStatus, setRetryingStatus] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [composerContent, setComposerContent] = useState("")
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesActions, setNotesActions] = useState<React.ReactNode>(null)
  const [notesReloadKey, setNotesReloadKey] = useState(0)
  const [executionDetails, setExecutionDetails] = useState<{
    title: string
    toolCalls: ToolCall[]
  } | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sessionToModify, setSessionToModify] = useState<Session | null>(null)

  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [features, setFeatures] = useState<CrabChatFeatures>(defaultFeatures)
  const pendingSessionPatchRef = useRef(new Map<string, Promise<Session>>())
  const crabStateLoadedRef = useRef(false)
  const promptDraftRef = useRef<CrabChatNote | null>(null)

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const activeAgentId =
    activeSessionId === NEW_CHAT_ID
      ? newSessionAgentId || sessionDefaults.defaultAgentId || agents[0]?.id
      : activeSession?.agentId
  const activeThinkingLevels = useMemo(() => {
    if (activeSessionId === NEW_CHAT_ID) {
      const selectedAgentId =
        newSessionAgentId || sessionDefaults.defaultAgentId || agents[0]?.id
      const mainSession =
        sessions.find((session) => session.key === `agent:${selectedAgentId}:main`) ||
        sessions.find((session) => session.agentId === selectedAgentId && session.key?.endsWith(":main"))
      return getThinkingLevels(mainSession ?? sessionDefaults, sessionDefaults)
    }

    return activeSession ? getThinkingLevels(activeSession, sessionDefaults) : []
  }, [activeSession, activeSessionId, agents, newSessionAgentId, sessionDefaults, sessions])
  const activeMessages = historyCache[activeSessionId] ?? []
  const visibleAgentActivity = useMemo(
    () => getTransientAgentActivity(agentActivity, isResponding),
    [agentActivity, isResponding]
  )
  const selectedAgentForModels = useMemo(() => {
    const targetAgentId =
      activeSessionId === NEW_CHAT_ID
        ? newSessionAgentId || sessionDefaults.defaultAgentId
        : activeSession?.agentId

    return agents.find((agent) => agent.id === targetAgentId)
  }, [activeSession?.agentId, activeSessionId, agents, newSessionAgentId, sessionDefaults.defaultAgentId])
  const visibleModels = useMemo(
    () => dedupeModelsById(resolveConfiguredAgentModels(selectedAgentForModels, models)),
    [models, selectedAgentForModels]
  )
  const composerModels = useMemo(() => {
    const currentModel = models.find((model) => model.id === modelSelection.model)
    if (!currentModel || hasEquivalentVisibleModel(currentModel, visibleModels)) {
      return visibleModels
    }
    return [currentModel, ...visibleModels]
  }, [modelSelection.model, models, visibleModels])
  const activeModelId = useMemo(() => {
    if (activeSessionId === NEW_CHAT_ID) {
      return modelSelection.model || getDefaultsModelId(sessionDefaults)
    }

    return activeSession ? getSessionModelId(activeSession) || getDefaultsModelId(sessionDefaults) : ""
  }, [activeSession, activeSessionId, modelSelection.model, sessionDefaults])
  const activeModel = useMemo(
    () => visibleModels.find((model) => model.id === activeModelId) || models.find((model) => model.id === activeModelId),
    [activeModelId, models, visibleModels]
  )
  const activeProviderId =
    activeModel?.provider ||
    activeSession?.modelProvider ||
    sessionDefaults.modelProvider ||
    (activeModelId.includes("/") ? activeModelId.split("/")[0] : "")
  const activeUsageSummary = useMemo<ProviderUsageSummary | null>(() => {
    if (!usageStatus?.providers.length) return null

    const normalizedProviderId = normalizeProviderId(activeProviderId)
    if (normalizedProviderId) {
      const providerMatch = usageStatus.providers.find(
        (provider) => normalizeProviderId(provider.provider) === normalizedProviderId
      )
      if (providerMatch) return providerMatch
    }

    const preferred = usageStatus.providers.find((provider) =>
      provider.windows.some((window) => /^5h$/i.test(window.label) || /^week$/i.test(window.label))
    )
    return preferred || usageStatus.providers[0] || null
  }, [activeProviderId, usageStatus])
  const contextWindow = useMemo<ContextWindowStatus>(() => {
    const usedTokens = activeSession?.contextTokens || 0
    const capacityTokens =
      activeSession?.contextCapacityTokens || getModelContextCapacity(activeModel)
    const usagePercent = capacityTokens
      ? Math.min(100, Math.max(0, Math.round((usedTokens / capacityTokens) * 100)))
      : 0

    return {
      usedTokens,
      totalTokens:
        activeSession?.totalTokens !== undefined && activeSession.totalTokens !== usedTokens
          ? activeSession.totalTokens
          : undefined,
      capacityTokens,
      usagePercent,
    }
  }, [activeModel, activeSession])

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
      const { sessions: loadedSessions, defaults } = await fetchSessions()
      setSessions(loadedSessions)
      setSessionDefaults(defaults)
      setSetupRequired(false)

      const urlSession = new URLSearchParams(window.location.search).get("session")
      const nextSession = urlSession || loadedSessions[0]?.id || NEW_CHAT_ID
      setActiveSessionId(nextSession)
      setLoadingSessions(false)

      void Promise.allSettled([fetchAgents(), fetchModels(), fetchUsageStatus()]).then((results) => {
        const [agentsResult, modelsResult, usageResult] = results

        if (agentsResult.status === "fulfilled") {
          setAgents(agentsResult.value)
          setNewSessionAgentId(
            (current) => current || defaults.defaultAgentId || agentsResult.value[0]?.id
          )
        }

        if (modelsResult.status === "fulfilled") {
          setModels(modelsResult.value)
          setModelSelection((current) => {
            const storedModel = current.model || getDefaultsModelId(defaults)
            const matchingModel =
              modelsResult.value.find((model) => model.id === storedModel) ??
              modelsResult.value.find((model) => model.id === getDefaultsModelId(defaults)) ??
              modelsResult.value[0]
            const levels = getThinkingLevels(defaults, defaults)
            return {
              model: matchingModel?.id || "",
              reasoningLevel:
                levels.find((level) => level.id === current.reasoningLevel)?.id ||
                getPreferredThinkingLevel(levels, defaults),
            }
          })
        }

        if (usageResult.status === "fulfilled") {
          setUsageStatus(usageResult.value)
        }
      })
    } catch (error) {
      if (isMissingAuth(error)) {
        applyMissingAuth()
      } else {
        setStatusError(error instanceof Error ? error.message : "Could not load sessions")
      }
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

  const waitForPendingSessionPatch = useCallback(async (sessionId: string) => {
    const pending = pendingSessionPatchRef.current.get(sessionId)
    if (pending) {
      await pending
    }
  }, [])

  const queueSessionPreferencePatch = useCallback(
    (
      session: Session,
      patch: {
        model?: string
        thinkingLevel?: string | null
      }
    ) => {
      const identifier = session.key || session.id
      const previous = pendingSessionPatchRef.current.get(session.id)
      const next = (previous ?? Promise.resolve(session))
        .catch(() => session)
        .then(() =>
          patchSessionPreferences(identifier, patch)
        )

      pendingSessionPatchRef.current.set(session.id, next)

      void next
        .then((updated) => {
          setSessions((current) =>
            current.map((item) =>
              item.id === session.id ? mergeSessionUpdate(item, updated) : item
            )
          )
        })
        .catch(async (error) => {
          if (isMissingAuth(error)) {
            applyMissingAuth()
          } else {
            setStatusError(
              error instanceof Error ? error.message : "Could not update session preferences"
            )
            await loadSessionList()
          }
        })
        .finally(() => {
          if (pendingSessionPatchRef.current.get(session.id) === next) {
            pendingSessionPatchRef.current.delete(session.id)
          }
        })

      return next
    },
    [applyMissingAuth, loadSessionList]
  )

  useEffect(() => {
    let cancelled = false
    fetchCrabChatState()
      .then((state) => {
        if (cancelled) return
        setSettings({ ...defaultSettings, ...state.settings })
        setFeatures({ ...defaultFeatures, ...state.features })
        setPinnedIds(new Set(state.pins))
        setModelSelection({
          model: state.modelSelection.model || "",
          reasoningLevel: state.modelSelection.reasoningLevel || "medium",
        })
        crabStateLoadedRef.current = true
      })
      .catch(() => {
        crabStateLoadedRef.current = true
      })
    return () => {
      cancelled = true
    }
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
    if (crabStateLoadedRef.current) {
      void saveCrabChatState({ settings })
    }
    systemPrefersDark.addEventListener("change", applyTheme)

    return () => systemPrefersDark.removeEventListener("change", applyTheme)
  }, [settings])

  useEffect(() => {
    if (crabStateLoadedRef.current) {
      void saveCrabChatState({ modelSelection })
    }
  }, [modelSelection])

  useEffect(() => {
    loadSessionList()
  }, [loadSessionList])

  useEffect(() => {
    loadActiveHistory(activeSessionId)
  }, [activeSessionId, loadActiveHistory])

  useEffect(() => {
    if (activeSessionId === NEW_CHAT_ID) {
      setAgentActivity(null)
      return
    }

    const sessionIdentifier = activeSession?.key || activeSession?.id || activeSessionId
    if (!sessionIdentifier) {
      setAgentActivity(null)
      return
    }

    setAgentActivity(
      activeSession?.hasActiveRun || activeSession?.runtimeStatus === "running"
        ? {
            kind: "thinking",
            label: "Thinking",
            active: true,
            sessionKey: activeSession?.key,
            updatedAt: Date.now(),
          }
        : null
    )

    const source = new EventSource(
      `/api/openclaw/session-status?${new URLSearchParams({
        session: sessionIdentifier,
      }).toString()}`
    )

    const handleStatus = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as AgentActivity
        setAgentActivity(payload.active ? payload : null)
      } catch {
        setAgentActivity(null)
      }
    }

    source.addEventListener("status", handleStatus)
    source.addEventListener("error", () => {
      setAgentActivity((current) => current)
    })

    return () => {
      source.removeEventListener("status", handleStatus)
      source.close()
    }
  }, [activeSession?.id, activeSession?.key, activeSessionId])

  useEffect(() => {
    if (activeSessionId === NEW_CHAT_ID) return
    const session = sessions.find((item) => item.id === activeSessionId)
    if (!session) return

    const sessionModelId = getSessionModelId(session)
    const thinkingLevels = getThinkingLevels(session, sessionDefaults)
    const nextModelId = sessionModelId || getDefaultsModelId(sessionDefaults)
    if (!nextModelId) return

    setModelSelection((current) => {
      const reasoningLevel = getPreferredThinkingLevel(thinkingLevels, session)

      if (current.model === nextModelId && current.reasoningLevel === reasoningLevel) {
        return current
      }

      return {
        model: nextModelId,
        reasoningLevel,
      }
    })
  }, [activeSessionId, sessionDefaults, sessions])

  useEffect(() => {
    if (activeSessionId !== NEW_CHAT_ID || visibleModels.length === 0) return

    setModelSelection((current) => {
      if (visibleModels.some((model) => model.id === current.model)) {
        return current
      }

      return {
        ...current,
        model: visibleModels[0]?.id || current.model,
      }
    })
  }, [activeSessionId, visibleModels])

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

  const handleNewSession = (agentId?: string) => {
    setNewSessionAgentId(agentId || agents[0]?.id)
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
      void saveCrabChatState({ pins: Array.from(next) })
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

  const handleModelSelect = useCallback(
    (modelId: string) => {
      setModelSelection((current) => ({ ...current, model: modelId }))

      if (activeSessionId === NEW_CHAT_ID) return

      const session = sessions.find((item) => item.id === activeSessionId)
      if (!session || getSessionModelId(session) === modelId) return

      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? {
                ...item,
                model: modelId,
              }
            : item
        )
      )

      void queueSessionPreferencePatch(session, { model: modelId })
    },
    [activeSessionId, queueSessionPreferencePatch, sessions]
  )

  const handleReasoningSelect = useCallback(
    (reasoningLevel: string) => {
      setModelSelection((current) => ({ ...current, reasoningLevel }))

      if (activeSessionId === NEW_CHAT_ID) return

      const session = sessions.find((item) => item.id === activeSessionId)
      if (!session) return

      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? {
                ...item,
                thinkingLevel: reasoningLevel,
              }
            : item
        )
      )

      void queueSessionPreferencePatch(session, { thinkingLevel: reasoningLevel })
    },
    [activeSessionId, queueSessionPreferencePatch, sessions]
  )

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

  useEffect(() => {
    if (!features.notes?.enabled || !features.notes.autoSavePrompts) return
    if (setupRequired) return

    const content = composerContent.trim()
    const existingDraft = promptDraftRef.current
    if (!content) {
      if (isResponding) return
      if (existingDraft) {
        promptDraftRef.current = null
        void deleteNote(existingDraft.fileName).catch(() => undefined)
      }
      return
    }

    const timeout = window.setTimeout(async () => {
      try {
        const result = await saveNote({
          fileName: promptDraftRef.current?.fileName,
          title: "untitled",
          agentId: activeAgentId,
          content,
          kind: "prompt",
          baseContent: promptDraftRef.current?.content,
          baseUpdatedAt: promptDraftRef.current?.updatedAt,
          conflictResolution: "overwrite",
        })
        if (!("conflict" in result)) {
          promptDraftRef.current = result.note
        }
      } catch {
        // Draft persistence should not block chat input.
      }
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [activeAgentId, composerContent, features.notes?.autoSavePrompts, features.notes?.enabled, isResponding, setupRequired])

  const savePromptAsNote = async (content: string) => {
    const text = content.trim()
    if (!text || !features.notes?.enabled) return
    try {
      const result = await saveNote({
        title: text.slice(0, 48),
        agentId: activeAgentId,
        content: text,
        kind: "note",
      })
      if (!("conflict" in result) && promptDraftRef.current) {
        await deleteNote(promptDraftRef.current.fileName).catch(() => undefined)
        promptDraftRef.current = null
      }
      setNotesOpen(true)
      setNotesReloadKey((current) => current + 1)
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "Could not save prompt as note")
    }
  }

  const handleToPrompt = useCallback((text: string) => {
    setComposerContent(text)
  }, [])

  const handleShowExecutionDetails = useCallback((title: string, toolCalls: ToolCall[] = []) => {
    if (!toolCalls || toolCalls.length === 0) return
    setExecutionDetails({ title, toolCalls })
  }, [])

  const handleSendMessage = async (content: string, attachments?: SentAttachment[]) => {
    if (isResponding) return
    if (activeSession?.archived) {
      setStatusError("Archived sessions are read-only.")
      return
    }

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
    const existingAssistantIds = new Set(
      (historyCache[optimisticSessionId] ?? [])
        .filter((message) => message.role === "assistant")
        .map((message) => message.id)
    )
    setHistoryCache((cache) => ({
      ...cache,
      [optimisticSessionId]: [...(cache[optimisticSessionId] ?? []), optimisticMessage],
    }))
    setIsResponding(true)

    try {
      let sessionId = optimisticSessionId
      const selectedSelection = modelSelection
      const existingSession = sessions.find((session) => session.id === sessionId)
      const selectedAgentId =
        sessionId === NEW_CHAT_ID ? newSessionAgentId || agents[0]?.id : existingSession?.agentId
      let gatewaySessionId = existingSession?.key || sessionId
      if (sessionId === NEW_CHAT_ID) {
        const createdSession = await createSession(
          trimmedContent.slice(0, 80) || undefined,
          selectedAgentId
        )
        const selectedAgent = agents.find((agent) => agent.id === selectedAgentId)
        const created = {
          ...createdSession,
          agentId: createdSession.agentId || selectedAgentId,
          agentName: createdSession.agentName || selectedAgent?.name,
        }
        setSessions((current) => [created, ...current])
        setHistoryCache((cache) => ({
          ...cache,
          [created.id]: cache[NEW_CHAT_ID] ?? [optimisticMessage],
          [NEW_CHAT_ID]: [],
        }))
        sessionId = created.id
        gatewaySessionId = created.key || created.id
        setNewSessionAgentId(selectedAgentId)
        navigateToSession(created.id)

        const patchedSession = await patchSessionPreferences(gatewaySessionId, {
          model: selectedSelection.model || undefined,
          thinkingLevel: selectedSelection.reasoningLevel || undefined,
        })
        const hydratedSession = {
          ...created,
          ...patchedSession,
          agentId: patchedSession.agentId || created.agentId,
          agentName: patchedSession.agentName || created.agentName,
        }
        setSessions((current) =>
          current.map((session) =>
            session.id === created.id ? hydratedSession : session
          )
        )
        gatewaySessionId = hydratedSession.key || gatewaySessionId
      } else {
        await waitForPendingSessionPatch(sessionId)
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
        attachments: validAttachments,
      })

      if (promptDraftRef.current) {
        const draft = promptDraftRef.current
        promptDraftRef.current = null
        void deleteNote(draft.fileName).catch(() => undefined)
      }

      setHistoryCache((cache) => ({
        ...cache,
        [sessionId]: (cache[sessionId] ?? []).map((message) =>
          message.id === optimisticMessage.id ? { ...message, status: "sent" } : message
        ),
      }))

      const pollDeadline = Date.now() + RESPONSE_POLL_TIMEOUT_MS
      while (Date.now() < pollDeadline) {
        await new Promise((resolve) => setTimeout(resolve, RESPONSE_POLL_INTERVAL_MS))

        const messages = await fetchHistory(gatewaySessionId)
        setHistoryCache((cache) => ({ ...cache, [sessionId]: messages }))

        const hasNewAssistantMessage = messages.some(
          (message) =>
            message.role === "assistant" && !existingAssistantIds.has(message.id)
        )
        if (hasNewAssistantMessage) break
      }

      setIsResponding(false)
    } catch (error) {
      if (isMissingAuth(error)) {
        applyMissingAuth()
        setComposerContent(trimmedContent)
      } else {
        setComposerContent(trimmedContent)
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

  useEffect(() => {
    if (!isResponding) return
    const toolCalls = getCurrentResponseToolCalls(activeMessages)
    if (toolCalls.length === 0) return
    setExecutionDetails({ title: "Execution details", toolCalls })
  }, [activeMessages, isResponding])

  const panelBlocks = useMemo<CrabChatPanelBlock[]>(() => {
    const blocks: CrabChatPanelBlock[] = []
    if (executionDetails?.toolCalls?.length) {
      blocks.push({
        id: "execution-details",
        title: executionDetails.title,
        content: (
          <div className="h-full overflow-y-auto p-3 custom-scrollbar">
            <ExecutionDetails toolCalls={executionDetails.toolCalls} />
          </div>
        ),
      })
    }
    if (features.notes?.enabled && notesOpen) {
      blocks.push({
        id: "notes",
        title: "Notes",
        actions: notesActions,
        content: (
          <NotesBlock
            agents={agents}
            currentAgentId={activeAgentId}
            reloadKey={notesReloadKey}
            useMonospaceFont={features.notes.useMonospaceFont}
            onToPrompt={handleToPrompt}
            onActionsChange={setNotesActions}
          />
        ),
      })
    }
    return blocks
  }, [
    activeAgentId,
    agents,
    executionDetails,
    features.notes?.enabled,
    features.notes?.useMonospaceFont,
    handleToPrompt,
    notesReloadKey,
    notesActions,
    notesOpen,
  ])

  const closePanelBlock = (id: string) => {
    if (id === "notes") setNotesOpen(false)
    if (id === "execution-details") setExecutionDetails(null)
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
          agents={agents}
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
            contextWindow={contextWindow}
            usageSummary={activeUsageSummary}
            agentActivity={visibleAgentActivity}
            onOpenSidebar={() => setSidebarExpanded(true)}
            sidebarExpanded={sidebarExpanded}
            notesEnabled={features.notes?.enabled}
            onOpenNotes={() => setNotesOpen(true)}
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
            workspaceRoot={activeSession?.workspaceRoot}
            workspaceSessionKey={activeSession?.key}
            isResponding={isResponding}
            agentActivity={visibleAgentActivity}
            settings={settings}
            onSettingsChange={setSettings}
            gatewayError={statusError}
            onRetryGateway={refreshStatus}
            retryingGateway={retryingStatus}
            onShowExecutionDetails={handleShowExecutionDetails}
          />

          <ChatComposer
            onSend={handleSendMessage}
            disabled={isResponding || setupRequired || Boolean(activeSession?.archived)}
            models={composerModels}
            thinkingLevels={activeThinkingLevels}
            selection={modelSelection}
            onModelSelect={handleModelSelect}
            onReasoningSelect={handleReasoningSelect}
            contentValue={composerContent}
            onContentChange={setComposerContent}
            manualPromptSaving={features.notes?.enabled && features.notes.manualPromptSaving}
            onSavePrompt={savePromptAsNote}
          />
        </div>
        <CrabChatPanel blocks={panelBlocks} onCloseBlock={closePanelBlock} />
      </div>

      {setupRequired && <ConnectionSetupDialog onRetry={loadSessionList} />}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={setSettings}
        features={features}
        onFeaturesChange={setFeatures}
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
            className="font-brand text-3xl font-normal"
          >
            Connect to the gateway
          </h1>
          <p className="text-sm text-muted-foreground">
            The client needs access to the OpenClaw gateway before chat can begin.
          </p>
        </div>

        <SetupCodeBlock
          label="Configure CRABCHAT_HOME/crabchat.json"
          code={`{
  "openclaw": {
    "gatewayUrl": "ws://127.0.0.1:18789",
    "token": "your-token"
  }
}`}
        />
        <p className="mt-3 text-sm text-muted-foreground">
          By default, CrabChat reads this from ~/.crabchat/crabchat.json. Set CRABCHAT_HOME only if you want a different folder.
        </p>

        <section className="mt-6 rounded-lg border border-border p-4">
          <h2 className="mb-2 text-sm font-medium">Where to find these values</h2>
          <p className="text-sm text-muted-foreground">
            If you deployed OpenClaw locally on this machine, the default gateway URL is{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              ws://127.0.0.1:18789
            </code>
            . To get a token, use the OpenClaw CLI tool:
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
