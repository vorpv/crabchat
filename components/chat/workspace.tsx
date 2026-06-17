"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  fetchAgents,
  fetchHistory,
  fetchModels,
  fetchSessions,
  fetchUsageStatus,
  isMissingAuth,
  NEW_CHAT_ID,
  patchSessionPreferences,
  readJsonStorage,
  removeSession,
  renameSession,
  sendChatMessage,
  writeJsonStorage,
} from "@/lib/client-api"
import type {
  Agent,
  AgentActivity,
  Attachment,
  ContextWindowStatus,
  Message,
  ModelOption,
  ModelReasoningSelection,
  ProviderUsageSummary,
  Session,
  SessionDefaults,
  Settings,
  ThinkingLevelOption,
  UsageStatus,
} from "@/lib/types"

hljs.registerLanguage("bash", bash)

const SETTINGS_KEY = "openclaw-chat-settings"
const PINNED_KEY = "openclaw-pinned-sessions"
const MODEL_SELECTION_KEY = "openclaw-model-selection"
const RESPONSE_POLL_INTERVAL_MS = 1_200
const RESPONSE_POLL_TIMEOUT_MS = 120_000

const defaultSettings: Settings = {
  theme: "system",
  displayChangesSummary: true,
}

interface SentAttachment {
  file: File
  preview?: string
  data: string
  type: string
}

function getSessionModelId(session: Session) {
  if (!session.model) return ""
  if (session.model.includes("/")) return session.model
  if (session.modelProvider) return `${session.modelProvider}/${session.model}`
  return session.model
}

function getDefaultsModelId(defaults: SessionDefaults) {
  if (!defaults.model) return ""
  if (defaults.model.includes("/")) return defaults.model
  if (defaults.modelProvider) return `${defaults.modelProvider}/${defaults.model}`
  return defaults.model
}

function getModelContextCapacity(model?: ModelOption) {
  return model?.contextTokens || model?.contextWindow
}

function normalizeProviderId(value?: string) {
  return value?.trim().toLowerCase() || ""
}

function normalizeModelRef(value?: string) {
  return value?.trim().toLowerCase() || ""
}

function getModelLeafId(model: ModelOption) {
  const normalizedId = normalizeModelRef(model.id)
  return normalizedId.includes("/") ? normalizedId.split("/").slice(1).join("/") : normalizedId
}

function hasEquivalentVisibleModel(target: ModelOption, models: ModelOption[]) {
  const targetId = normalizeModelRef(target.id)
  const targetLeafId = getModelLeafId(target)
  const targetName = target.name.trim().toLowerCase()

  return models.some((model) => {
    const modelId = normalizeModelRef(model.id)
    if (modelId === targetId) return true
    if (getModelLeafId(model) === targetLeafId) return true
    return model.name.trim().toLowerCase() === targetName
  })
}

function dedupeModelsById(models: ModelOption[]) {
  const seen = new Set<string>()
  return models.filter((model) => {
    const key = normalizeModelRef(model.id)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildModelOptionFromRef(ref: string): ModelOption | undefined {
  const normalized = ref.trim()
  if (!normalized) return undefined

  const [provider, ...modelParts] = normalized.split("/")
  const modelId = modelParts.join("/")
  if (!provider || !modelId) {
    return {
      id: normalized,
      name: normalized,
    }
  }

  return {
    id: `${provider}/${modelId}`,
    name: modelId,
    provider,
  }
}

function resolveConfiguredAgentModels(agent: Agent | undefined, models: ModelOption[]) {
  if (!agent?.model) return models

  const configuredRefs = [
    agent.model.primary,
    ...(agent.model.fallbacks || []),
  ]
    .map((entry) => normalizeModelRef(entry))
    .filter(Boolean)

  if (configuredRefs.length === 0) return models

  const filtered = models.filter((model) => {
    const modelId = normalizeModelRef(model.id)
    const suffix = modelId.includes("/") ? modelId.split("/").slice(1).join("/") : modelId
    return configuredRefs.some((configuredRef) => {
      if (configuredRef === modelId) return true
      if (!configuredRef.includes("/") && configuredRef === suffix) return true
      return false
    })
  })

  if (filtered.length > 0) return filtered

  const fallbackModels = configuredRefs
    .map((configuredRef) => buildModelOptionFromRef(configuredRef))
    .filter(Boolean) as ModelOption[]

  return fallbackModels.length > 0 ? fallbackModels : models
}

function getThinkingLevels(
  session: Pick<
    Session | SessionDefaults,
    "model" | "modelProvider" | "thinkingLevels" | "thinkingOptions"
  >,
  defaults: SessionDefaults
) {
  if (session.thinkingLevels?.length) return session.thinkingLevels

  const sessionModelId =
    session.model && session.modelProvider && !session.model.includes("/")
      ? `${session.modelProvider}/${session.model}`
      : session.model || ""
  const defaultsModelId = getDefaultsModelId(defaults)
  const sameModel = !sessionModelId || sessionModelId === defaultsModelId

  if (sameModel && defaults.thinkingLevels?.length) {
    return defaults.thinkingLevels
  }

  const thinkingOptions =
    session.thinkingOptions ||
    (sameModel ? defaults.thinkingOptions : undefined) ||
    []

  return thinkingOptions.map((option) => ({
    id: option,
    label: option,
  }))
}

function getPreferredThinkingLevel(
  levels: ThinkingLevelOption[],
  session: Pick<Session | SessionDefaults, "thinkingLevel" | "thinkingDefault">
) {
  if (session.thinkingLevel && levels.some((level) => level.id === session.thinkingLevel)) {
    return session.thinkingLevel
  }
  if (session.thinkingDefault && levels.some((level) => level.id === session.thinkingDefault)) {
    return session.thinkingDefault
  }
  return levels[0]?.id || "medium"
}

function mergeSessionUpdate(current: Session, updated: Session): Session {
  return {
    ...current,
    ...updated,
    agentId: updated.agentId || current.agentId,
    agentName: updated.agentName || current.agentName,
  }
}

function getTransientAgentActivity(
  current: AgentActivity | null,
  isResponding: boolean
): AgentActivity | null {
  if (current?.active) return current
  if (!isResponding) return null

  return {
    kind: "thinking",
    label: "Thinking",
    active: true,
    updatedAt: Date.now(),
  }
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

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sessionToModify, setSessionToModify] = useState<Session | null>(null)

  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const pendingSessionPatchRef = useRef(new Map<string, Promise<Session>>())

  const activeSession = sessions.find((session) => session.id === activeSessionId)
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
    setSettings({ ...defaultSettings, ...readJsonStorage(SETTINGS_KEY, defaultSettings) })
    setPinnedIds(new Set(readJsonStorage<string[]>(PINNED_KEY, [])))
    setModelSelection(
      readJsonStorage<ModelReasoningSelection>(MODEL_SELECTION_KEY, {
        model: "",
        reasoningLevel: "medium",
      })
    )
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
    writeJsonStorage(MODEL_SELECTION_KEY, modelSelection)
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
            agentActivity={visibleAgentActivity}
            displayChangesSummary={settings.displayChangesSummary}
            gatewayError={statusError}
            onRetryGateway={refreshStatus}
            retryingGateway={retryingStatus}
          />

          <ChatComposer
            onSend={handleSendMessage}
            disabled={isResponding || setupRequired}
            models={composerModels}
            thinkingLevels={activeThinkingLevels}
            selection={modelSelection}
            onModelSelect={handleModelSelect}
            onReasoningSelect={handleReasoningSelect}
          />
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
            className="font-brand text-3xl font-normal"
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
          Then restart CrabChat server for changes to apply
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
