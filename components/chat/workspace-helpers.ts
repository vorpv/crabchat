import type {
  Agent,
  AgentActivity,
  ModelOption,
  Session,
  SessionDefaults,
  ThinkingLevelOption,
} from "@/lib/types"

export function getSessionModelId(session: Session) {
  if (!session.model) return ""
  if (session.model.includes("/")) return session.model
  if (session.modelProvider) return `${session.modelProvider}/${session.model}`
  return session.model
}

export function getDefaultsModelId(defaults: SessionDefaults) {
  if (!defaults.model) return ""
  if (defaults.model.includes("/")) return defaults.model
  if (defaults.modelProvider) return `${defaults.modelProvider}/${defaults.model}`
  return defaults.model
}

export function getModelContextCapacity(model?: ModelOption) {
  return model?.contextTokens || model?.contextWindow
}

export function normalizeProviderId(value?: string) {
  return value?.trim().toLowerCase() || ""
}

function normalizeModelRef(value?: string) {
  return value?.trim().toLowerCase() || ""
}

function getModelLeafId(model: ModelOption) {
  const normalizedId = normalizeModelRef(model.id)
  return normalizedId.includes("/") ? normalizedId.split("/").slice(1).join("/") : normalizedId
}

export function hasEquivalentVisibleModel(target: ModelOption, models: ModelOption[]) {
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

export function dedupeModelsById(models: ModelOption[]) {
  const seen = new Set<string>()
  return models.filter((model) => {
    const key = normalizeModelRef(model.id)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildModelOptionFromRef(ref: string): ModelOption | undefined {
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

export function resolveConfiguredAgentModels(agent: Agent | undefined, models: ModelOption[]) {
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

export function getThinkingLevels(
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

export function getPreferredThinkingLevel(
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

export function mergeSessionUpdate(current: Session, updated: Session): Session {
  return {
    ...current,
    ...updated,
    agentId: updated.agentId || current.agentId,
    agentName: updated.agentName || current.agentName,
  }
}

export function getTransientAgentActivity(
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
