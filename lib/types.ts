export interface ThinkingLevelOption {
  id: string
  label: string
}

export interface Session {
  id: string
  key?: string
  friendlyId?: string
  title: string
  pinned: boolean
  archived?: boolean
  archivedAt?: Date
  agentId?: string
  agentName?: string
  workspaceRoot?: string
  runtimeStatus?: string
  hasActiveRun?: boolean
  model?: string
  modelProvider?: string
  thinkingLevel?: string
  thinkingLevels?: ThinkingLevelOption[]
  thinkingOptions?: string[]
  thinkingDefault?: string
  inputTokens?: number
  outputTokens?: number
  contextTokens?: number
  contextCapacityTokens?: number
  totalTokens?: number
  totalTokensFresh?: boolean
  createdAt?: Date
  updatedAt?: Date
  lastMessage?: string
}

export interface Agent {
  id: string
  name: string
  description?: string
  model?: {
    primary?: string
    fallbacks?: string[]
  }
}

export interface ModelReasoningSelection {
  model: string
  reasoningLevel: string
}

export interface ModelOption {
  id: string
  name: string
  provider?: string
  isDefault?: boolean
  contextTokens?: number
  contextWindow?: number
}

export interface SessionDefaults {
  defaultAgentId?: string
  mainKey?: string
  mainSessionKey?: string
  model?: string
  modelProvider?: string
  thinkingLevel?: string
  thinkingLevels?: ThinkingLevelOption[]
  thinkingOptions?: string[]
  thinkingDefault?: string
}

export interface Message {
  id: string
  role: "user" | "assistant" | "tool"
  content: string
  timestamp: Date
  attachments?: Attachment[]
  reasoning?: string
  toolCalls?: ToolCall[]
  usage?: MessageUsage
  status?: "sending" | "sent" | "error"
  error?: string
}

export interface MessageUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  contextTokens?: number
  contextCapacityTokens?: number
  contextUsagePercent?: number
  model?: string
  modelProvider?: string
  reasoningLevel?: string
}

export interface Attachment {
  name: string
  size: number
  type: string
  url?: string
  data?: string
  error?: string
}

export interface ToolCall {
  id: string
  name: string
  input?: Record<string, unknown>
  output?: string
  error?: string
  status: "pending" | "success" | "error"
  rawCall?: unknown
  rawResults?: unknown[]
}

export interface Settings {
  theme: "system" | "light" | "dark"
  displayChangesSummary: boolean
  displayTokenUsage: boolean
}

export interface CrabChatFeatures {
  archiving: {
    enabled: boolean
  }
  notes: {
    enabled: boolean
    autoSavePrompts: boolean
    manualPromptSaving: boolean
    useMonospaceFont: boolean
    storagePath: string
  }
}

export interface CrabChatState {
  settings: Settings
  modelSelection: ModelReasoningSelection
  pins: string[]
  features: CrabChatFeatures
}

export interface OpenClawSessionResetConfig {
  mode?: "daily" | "idle"
  atHour?: number
  idleMinutes?: number
}

export interface OpenClawSessionConfig {
  scope?: "per-sender" | "global"
  dmScope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer"
  reset?: OpenClawSessionResetConfig
  resetByType?: {
    direct?: OpenClawSessionResetConfig
    group?: OpenClawSessionResetConfig
    thread?: OpenClawSessionResetConfig
  }
  maintenance?: {
    pruneAfter?: string | number
    maxEntries?: number
  }
}

export interface OpenClawConfigView {
  connection: {
    url: string
    password: string
  }
  session: OpenClawSessionConfig
  restart?: unknown
}

export interface ProviderUsageWindow {
  label: string
  usedPercent: number
  resetAt?: number
}

export interface ProviderUsageSummary {
  provider: string
  displayName: string
  windows: ProviderUsageWindow[]
  plan?: string
  error?: string
}

export interface UsageStatus {
  updatedAt: number
  providers: ProviderUsageSummary[]
}

export interface ContextWindowStatus {
  usedTokens: number
  totalTokens?: number
  capacityTokens?: number
  usagePercent: number
}

export type AgentActivityKind = "idle" | "thinking" | "tool" | "operation"

export interface AgentActivity {
  kind: AgentActivityKind
  label: string
  detail?: string
  active: boolean
  sessionKey?: string
  updatedAt?: number
}

export type CrabChatNoteKind = "note" | "prompt"

export interface CrabChatNote {
  fileName: string
  title: string
  displayTitle: string
  agentId?: string
  content: string
  kind: CrabChatNoteKind
  updatedAt: string
}

export interface CrabChatNotesList {
  notes: CrabChatNote[]
  storagePath: string
}

export interface CrabChatNoteSaveConflict {
  conflict: true
  note: CrabChatNote
}
