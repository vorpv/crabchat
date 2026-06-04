"use client"

import type { Attachment, Message, Session, Settings } from "@/lib/types"

export interface ApiError extends Error {
  status?: number
  code?: string
}

export const NEW_CHAT_ID = "new"

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(payload.error || "Request failed") as ApiError
    error.status = response.status
    error.code = payload.code
    throw error
  }

  return payload
}

export function isMissingAuth(error: unknown) {
  const apiError = error as ApiError
  return apiError?.code === "missing_auth" || apiError?.status === 401
}

export function normalizeDate(value: unknown) {
  if (value instanceof Date) return value
  if (typeof value === "number") {
    return new Date(value < 10_000_000_000 ? value * 1000 : value)
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed)
  }
  return new Date()
}

function normalizeSession(session: Session): Session {
  return {
    ...session,
    id: session.friendlyId || session.id || session.key || "main",
    title: session.title || session.friendlyId || session.id || "Conversation",
    updatedAt: normalizeDate(session.updatedAt),
    createdAt: session.createdAt ? normalizeDate(session.createdAt) : undefined,
  }
}

function normalizeMessage(message: Message): Message {
  return {
    ...message,
    timestamp: normalizeDate(message.timestamp),
  }
}

export async function checkStatus() {
  return apiFetch<{ ok: true }>("/api/openclaw/status")
}

export async function fetchSessions() {
  const payload = await apiFetch<{ sessions: Session[] }>("/api/openclaw/sessions")
  return payload.sessions.map(normalizeSession)
}

export async function createSession(label?: string) {
  const payload = await apiFetch<{ session: Session }>("/api/openclaw/sessions", {
    method: "POST",
    body: JSON.stringify({ label }),
  })
  return normalizeSession(payload.session)
}

export async function renameSession(identifier: string, label: string) {
  const payload = await apiFetch<{ session: Session }>("/api/openclaw/sessions", {
    method: "PATCH",
    body: JSON.stringify({ identifier, label }),
  })
  return normalizeSession(payload.session)
}

export async function removeSession(identifier: string) {
  return apiFetch<{ ok: true }>("/api/openclaw/sessions", {
    method: "DELETE",
    body: JSON.stringify({ identifier }),
  })
}

export async function fetchHistory(sessionId: string) {
  const query = new URLSearchParams({ session: sessionId, limit: "200" })
  const payload = await apiFetch<{ messages: Message[] }>(
    `/api/openclaw/history?${query.toString()}`
  )
  return payload.messages.map(normalizeMessage)
}

export async function sendChatMessage(params: {
  sessionId: string
  text: string
  thinkingLevel: Settings["thinkingLevel"]
  attachments: Attachment[]
}) {
  return apiFetch<{ result: unknown }>("/api/openclaw/send", {
    method: "POST",
    body: JSON.stringify({
      session: params.sessionId === NEW_CHAT_ID ? undefined : params.sessionId,
      text: params.text,
      thinkingLevel: params.thinkingLevel,
      attachments: params.attachments,
      idempotencyKey: crypto.randomUUID(),
    }),
  })
}

export function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

export function writeJsonStorage(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function exportConversation(
  format: "markdown" | "json" | "text",
  title: string,
  messages: Message[]
) {
  const exportedMessages = messages.filter((message) =>
    ["user", "assistant"].includes(message.role)
  )
  if (exportedMessages.length === 0) return

  const exportedAt = new Date()
  const timestamp = exportedAt.toISOString()
  const safeTitle = title || "Conversation"

  const formatMessage = (message: Message) => {
    const role = message.role === "user" ? "User" : "Assistant"
    return `${role} (${message.timestamp.toISOString()})\n${message.content}`
  }

  let body: string
  let mime: string
  let extension: string

  if (format === "json") {
    body = JSON.stringify(
      {
        title: safeTitle,
        exportedAt: timestamp,
        messageCount: exportedMessages.length,
        messages: exportedMessages.map((message) => ({
          role: message.role,
          text: message.content,
          timestamp: message.timestamp.toISOString(),
        })),
      },
      null,
      2
    )
    mime = "application/json"
    extension = "json"
  } else if (format === "markdown") {
    body = [
      `# ${safeTitle}`,
      "",
      `Exported: ${timestamp}`,
      "",
      ...exportedMessages.flatMap((message) => [
        "---",
        "",
        `**${message.role === "user" ? "User" : "Assistant"}**`,
        "",
        `_${message.timestamp.toISOString()}_`,
        "",
        message.content,
        "",
      ]),
    ].join("\n")
    mime = "text/markdown"
    extension = "md"
  } else {
    body = [`${safeTitle}`, `Exported: ${timestamp}`, ""]
      .concat(exportedMessages.map(formatMessage).join("\n\n---\n\n"))
      .join("\n")
    mime = "text/plain"
    extension = "txt"
  }

  const filenameBase =
    safeTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "conversation"
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${filenameBase}.${extension}`
  link.click()
  URL.revokeObjectURL(url)
}
