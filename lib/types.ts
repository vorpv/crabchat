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
  agentId?: string
  agentName?: string
  runtimeStatus?: string
  hasActiveRun?: boolean
  model?: string
  modelProvider?: string
  thinkingLevel?: string
  thinkingLevels?: ThinkingLevelOption[]
  thinkingOptions?: string[]
  thinkingDefault?: string
  contextTokens?: number
  totalTokens?: number
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
  status?: "sending" | "sent" | "error"
  error?: string
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
