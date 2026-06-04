export interface Session {
  id: string
  key?: string
  friendlyId?: string
  title: string
  pinned: boolean
  createdAt?: Date
  updatedAt?: Date
  lastMessage?: string
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
}

export interface Settings {
  theme: "system" | "light" | "dark"
  showToolMessages: boolean
  showReasoningBlocks: boolean
  thinkingLevel: "low" | "medium" | "high"
}
