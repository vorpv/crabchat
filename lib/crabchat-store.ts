import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import {
  defaultCrabChatConfig,
  getCrabChatPaths,
  readCrabChatConfig,
  writeCrabChatConfig,
  type CrabChatConfigFile,
} from "@/lib/crabchat-home"
import {
  AppError,
  createSession,
  deleteSession,
  listSessions,
  loadHistory,
  patchSession,
} from "@/lib/openclaw-gateway"
import {
  migrateNotesDirectory,
  validateNotesStoragePath,
} from "@/lib/crabchat-notes"
import type {
  Attachment,
  CrabChatFeatures,
  Message,
  ModelReasoningSelection,
  Session,
  SessionDefaults,
  Settings,
} from "@/lib/types"

type StoredSession = {
  version: 1
  session: Session
  messages: Message[]
  archived: boolean
  archivedAt?: string
  lastSyncedAt?: string
}

const defaultSettings: Settings = {
  theme: "system",
  displayChangesSummary: true,
  displayTokenUsage: false,
}

const defaultModelSelection: ModelReasoningSelection = {
  model: "",
  reasoningLevel: "medium",
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

function ensureHome() {
  const p = getCrabChatPaths()
  mkdirSync(p.sessions, { recursive: true })
  mkdirSync(p.archive, { recursive: true })
  if (!existsSync(p.config)) writeCrabChatConfig(defaultCrabChatConfig())
  if (!existsSync(p.pins)) writeJson(p.pins, [])
  if (!existsSync(p.features)) writeJson(p.features, defaultFeatures)
  return p
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function normalizeDate(value: unknown) {
  if (value instanceof Date) return value
  if (typeof value === "number") return new Date(value)
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed)
  }
  return new Date()
}

function normalizeMessage(message: Message): Message {
  return {
    ...message,
    timestamp: normalizeDate(message.timestamp),
  }
}

function normalizeStoredSession(record: StoredSession): StoredSession {
  return {
    ...record,
    session: {
      ...record.session,
      updatedAt: record.session.updatedAt ? normalizeDate(record.session.updatedAt) : undefined,
      createdAt: record.session.createdAt ? normalizeDate(record.session.createdAt) : undefined,
      archivedAt: record.session.archivedAt ? normalizeDate(record.session.archivedAt) : undefined,
    },
    messages: (record.messages || []).map(normalizeMessage),
  }
}

function safeSessionFileName(session: Pick<Session, "id" | "key" | "friendlyId">) {
  const id = session.id || session.friendlyId || session.key || "session"
  return `${id.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`
}

function activeSessionPath(session: Pick<Session, "id" | "key" | "friendlyId">) {
  return `${ensureHome().sessions}/${safeSessionFileName(session)}`
}

function archivedSessionPath(session: Pick<Session, "id" | "key" | "friendlyId">) {
  return `${ensureHome().archive}/${safeSessionFileName(session)}`
}

function isSessionMatch(record: StoredSession, identifier: string) {
  return (
    record.session.id === identifier ||
    record.session.key === identifier ||
    record.session.friendlyId === identifier
  )
}

function readSessionFile(path: string) {
  const name = path.split("/").pop()?.replace(/\.json$/, "") || "session"
  return normalizeStoredSession(readJson<StoredSession>(path, {
    version: 1,
    session: {
      id: name,
      title: name,
      pinned: false,
    },
    messages: [],
    archived: false,
  }))
}

function listSessionFiles(dir: string) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => `${dir}/${file}`)
}

function listActiveRecords() {
  const p = ensureHome()
  return listSessionFiles(p.sessions).map(readSessionFile)
}

function listArchivedRecords() {
  const p = ensureHome()
  return listSessionFiles(p.archive).map(readSessionFile)
}

function writeSessionRecord(record: StoredSession) {
  const target = record.archived
    ? archivedSessionPath(record.session)
    : activeSessionPath(record.session)
  writeJson(target, record)
}

function archiveRecord(record: StoredSession) {
  const archivedAt = new Date().toISOString()
  const archived: StoredSession = {
    ...record,
    archived: true,
    archivedAt,
    session: {
      ...record.session,
      archived: true,
      archivedAt: new Date(archivedAt),
      hasActiveRun: false,
      runtimeStatus: "archived",
    },
  }
  const activePath = activeSessionPath(record.session)
  const archivePath = archivedSessionPath(record.session)
  writeSessionRecord(archived)
  if (existsSync(activePath) && activePath !== archivePath) unlinkSync(activePath)
  return archived
}

function upsertOpenClawSession(session: Session) {
  const activePath = activeSessionPath(session)
  const archivePath = archivedSessionPath(session)
  let existing: StoredSession | undefined
  if (existsSync(activePath)) existing = readSessionFile(activePath)
  if (!existing && existsSync(archivePath)) {
    existing = readSessionFile(archivePath)
    renameSync(archivePath, activePath)
  }

  const record: StoredSession = {
    version: 1,
    session: {
      ...(existing?.session || {}),
      ...session,
      archived: false,
      archivedAt: undefined,
    },
    messages: existing?.messages || [],
    archived: false,
    archivedAt: undefined,
    lastSyncedAt: new Date().toISOString(),
  }
  writeSessionRecord(record)
  return record
}

function readFeatures() {
  const p = ensureHome()
  const saved = readJson<Partial<CrabChatFeatures>>(p.features, {})
  return {
    ...defaultFeatures,
    ...saved,
    archiving: {
      ...defaultFeatures.archiving,
      ...(saved.archiving || {}),
    },
    notes: {
      ...defaultFeatures.notes,
      ...(saved.notes || {}),
    },
  } as CrabChatFeatures
}

export function getCrabChatState() {
  const p = ensureHome()
  const config = readCrabChatConfig()
  const pins = readJson<string[]>(p.pins, [])
  return {
    settings: {
      ...defaultSettings,
      ...(config.ui?.settings || {}),
    },
    modelSelection: {
      ...defaultModelSelection,
      ...(config.ui?.modelSelection || {}),
    },
    pins: Array.isArray(pins) ? pins : [],
    features: readFeatures(),
  }
}

export function updateCrabChatState(patch: {
  settings?: Settings
  modelSelection?: ModelReasoningSelection
  pins?: string[]
  features?: Partial<CrabChatFeatures>
}) {
  const p = ensureHome()
  const current = readCrabChatConfig()
  const next: CrabChatConfigFile = {
    ...defaultCrabChatConfig(),
    ...current,
    ui: {
      settings: patch.settings || current.ui?.settings || defaultSettings,
      modelSelection: patch.modelSelection || current.ui?.modelSelection || defaultModelSelection,
    },
  }
  writeCrabChatConfig(next)
  if (patch.pins) writeJson(p.pins, patch.pins)
  if (patch.features) {
    const previousFeatures = readFeatures()
    const nextFeatures = {
      ...previousFeatures,
      ...readFeatures(),
      ...patch.features,
      notes: {
        ...previousFeatures.notes,
        ...(patch.features.notes || {}),
      },
    }
    const notesValidation = validateNotesStoragePath(nextFeatures.notes.storagePath)
    if (!notesValidation.ok) {
      throw new AppError(
        notesValidation.error || "Notes storage path is invalid.",
        400,
        "INVALID_REQUEST"
      )
    }
    migrateNotesDirectory(previousFeatures, nextFeatures)
    writeJson(p.features, nextFeatures)
  }
  return getCrabChatState()
}

export async function syncCrabChatSessions() {
  const openclaw = await listSessions()
  const openclawSessions = openclaw.sessions
  const liveIds = new Set<string>()

  for (const session of openclawSessions) {
    liveIds.add(session.id)
    if (session.key) liveIds.add(session.key)
    if (session.friendlyId) liveIds.add(session.friendlyId)
    upsertOpenClawSession(session)
  }

  if (readFeatures().archiving?.enabled !== false) {
    for (const record of listActiveRecords()) {
      if (
        !liveIds.has(record.session.id) &&
        (!record.session.key || !liveIds.has(record.session.key)) &&
        (!record.session.friendlyId || !liveIds.has(record.session.friendlyId))
      ) {
        archiveRecord(record)
      }
    }
  }

  return {
    sessions: [...listActiveRecords(), ...listArchivedRecords()]
      .map((record) => ({
        ...record.session,
        archived: record.archived,
        archivedAt: record.archivedAt ? new Date(record.archivedAt) : record.session.archivedAt,
      }))
      .sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1
        return normalizeDate(b.updatedAt).getTime() - normalizeDate(a.updatedAt).getTime()
      }),
    defaults: openclaw.defaults,
  }
}

function findStoredRecord(identifier?: string) {
  if (!identifier) return undefined
  return [...listActiveRecords(), ...listArchivedRecords()].find((record) =>
    isSessionMatch(record, identifier)
  )
}

export async function loadCrabChatHistory(identifier?: string, limit = 200) {
  const stored = findStoredRecord(identifier)
  if (stored?.archived) return stored.messages.slice(-limit)

  const sessionKey = stored?.session.key || identifier
  const messages = await loadHistory(sessionKey, limit)
  if (stored) {
    writeSessionRecord({
      ...stored,
      messages,
      lastSyncedAt: new Date().toISOString(),
    })
  }
  return messages
}

export async function createCrabChatSession(label?: string, agentId?: string) {
  const session = await createSession(label, agentId)
  upsertOpenClawSession(session)
  return session
}

export async function patchCrabChatSession(
  identifier: string,
  patch: {
    label?: string
    model?: string
    thinkingLevel?: string | null
  }
) {
  const stored = findStoredRecord(identifier)
  if (stored?.archived) throw new AppError("Archived sessions cannot be modified.", 409)
  const session = await patchSession(stored?.session.key || identifier, patch)
  upsertOpenClawSession(session)
  return session
}

export async function deleteCrabChatSession(identifier: string) {
  const stored = findStoredRecord(identifier)
  if (stored?.archived) {
    const archivePath = archivedSessionPath(stored.session)
    if (existsSync(archivePath)) unlinkSync(archivePath)
    return { ok: true }
  }
  await deleteSession(stored?.session.key || identifier)
  const activePath = stored ? activeSessionPath(stored.session) : undefined
  if (activePath && existsSync(activePath)) unlinkSync(activePath)
  return { ok: true }
}

export async function sendCrabChatMessage(params: {
  session?: string
  text?: string
  attachments?: Attachment[]
  idempotencyKey: string
}) {
  const stored = findStoredRecord(params.session)
  if (stored?.archived) throw new AppError("Archived sessions are read-only.", 409)
  const { sendMessage } = await import("@/lib/openclaw-gateway")
  return sendMessage({
    ...params,
    session: stored?.session.key || params.session,
  })
}
