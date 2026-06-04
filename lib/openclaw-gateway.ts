import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve as pathResolve } from "node:path"
import WebSocket from "ws"
import type { KeyObject } from "node:crypto"
import type { Attachment, Message, Session, ToolCall } from "@/lib/types"

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789"
const REQUEST_TIMEOUT_MS = 20_000
const DEVICE_KEYS_PATH = pathResolve(process.cwd(), ".device-keys.json")
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")
const GATEWAY_QUEUE = Symbol.for("outclaw.gatewayQueue.v2")
const SESSION_LIST_CACHE = Symbol.for("outclaw.sessionListCache")
const SESSION_LIST_CACHE_MS = 5_000

type GatewayFrame = Record<string, unknown>

interface GatewayAuth {
  token?: string
  password?: string
}

type StoredDeviceKeys = {
  version: 2
  algorithm: "ed25519"
  publicKeyPem: string
  privateKeyPem: string
  createdAtMs: number
}

type DeviceIdentity = {
  deviceId: string
  privateKey: KeyObject
  publicKeyRawBase64Url: string
}

type SessionListCache = {
  expiresAt: number
  value: Session[]
}

type GatewayQueue = {
  tail: Promise<void>
}

function getGatewayQueue() {
  const globals = globalThis as typeof globalThis & {
    [GATEWAY_QUEUE]?: GatewayQueue
  }

  if (!globals[GATEWAY_QUEUE]) {
    globals[GATEWAY_QUEUE] = { tail: Promise.resolve() }
  }

  return globals[GATEWAY_QUEUE]
}

async function withGatewaySlot<T>(operation: () => Promise<T>) {
  const queue = getGatewayQueue()
  const previous = queue.tail
  let release: () => void = () => undefined
  queue.tail = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

function getSessionListCache() {
  const globals = globalThis as typeof globalThis & {
    [SESSION_LIST_CACHE]?: SessionListCache
  }

  return globals[SESSION_LIST_CACHE]
}

function setSessionListCache(value: Session[]) {
  const globals = globalThis as typeof globalThis & {
    [SESSION_LIST_CACHE]?: SessionListCache
  }
  globals[SESSION_LIST_CACHE] = {
    expiresAt: Date.now() + SESSION_LIST_CACHE_MS,
    value,
  }
}

function invalidateSessionListCache() {
  const globals = globalThis as typeof globalThis & {
    [SESSION_LIST_CACHE]?: SessionListCache
  }
  delete globals[SESSION_LIST_CACHE]
}

export class AppError extends Error {
  status: number
  code?: string

  constructor(message: string, status = 500, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function getGatewayAuth(): GatewayAuth {
  const token = process.env.OCLAW_GATEWAY_TOKEN
  const password = process.env.OCLAW_GATEWAY_PASSWORD

  if (!token && !password) {
    throw new AppError(
      "Missing gateway auth. Set OCLAW_GATEWAY_TOKEN or OCLAW_GATEWAY_PASSWORD.",
      401,
      "missing_auth"
    )
  }

  return { token, password }
}

function getGatewayUrl() {
  return process.env.OCLAW_GATEWAY_URL || DEFAULT_GATEWAY_URL
}

function isStoredDeviceKeys(value: unknown): value is StoredDeviceKeys {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 2 &&
    candidate.algorithm === "ed25519" &&
    typeof candidate.publicKeyPem === "string" &&
    typeof candidate.privateKeyPem === "string"
  )
}

function base64UrlEncode(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function derivePublicKeyRaw(publicKey: KeyObject): Buffer {
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length)
  }

  return spki
}

function deriveDeviceIdFromRawPublicKey(rawPublicKey: Uint8Array): string {
  return createHash("sha256").update(rawPublicKey).digest("hex")
}

function importStoredKeyPair(stored: StoredDeviceKeys): {
  publicKey: KeyObject
  privateKey: KeyObject
} {
  const publicKey = createPublicKey(stored.publicKeyPem)
  const privateKey = createPrivateKey(stored.privateKeyPem)
  return { publicKey, privateKey }
}

function generateAndPersistKeyPair(): {
  publicKey: KeyObject
  privateKey: KeyObject
} {
  const keyPair = generateKeyPairSync("ed25519")
  const publicKeyPem = keyPair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString()
  const privateKeyPem = keyPair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString()

  const payload: StoredDeviceKeys = {
    version: 2,
    algorithm: "ed25519",
    publicKeyPem,
    privateKeyPem,
    createdAtMs: Date.now(),
  }

  mkdirSync(dirname(DEVICE_KEYS_PATH), { recursive: true })
  writeFileSync(DEVICE_KEYS_PATH, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  })
  try {
    chmodSync(DEVICE_KEYS_PATH, 0o600)
  } catch {
    // chmod is best-effort on filesystems that support POSIX permissions.
  }

  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey }
}

function loadOrCreateDeviceIdentity(): DeviceIdentity {
  let keyPair: { publicKey: KeyObject; privateKey: KeyObject } | null = null

  if (existsSync(DEVICE_KEYS_PATH)) {
    try {
      const stored = JSON.parse(readFileSync(DEVICE_KEYS_PATH, "utf8")) as unknown
      if (isStoredDeviceKeys(stored)) {
        keyPair = importStoredKeyPair(stored)
      }
    } catch {
      // Ignore invalid stored keys and replace them with a fresh identity.
    }
  }

  if (!keyPair) {
    keyPair = generateAndPersistKeyPair()
  }

  const rawPublicKey = derivePublicKeyRaw(keyPair.publicKey)
  const deviceId = deriveDeviceIdFromRawPublicKey(rawPublicKey)

  return {
    deviceId,
    privateKey: keyPair.privateKey,
    publicKeyRawBase64Url: base64UrlEncode(rawPublicKey),
  }
}

function signPayload(privateKey: KeyObject, payload: string): string {
  const signature = sign(null, Buffer.from(payload, "utf8"), privateKey)
  return base64UrlEncode(signature)
}

let deviceIdentityPromise: Promise<DeviceIdentity> | null = null

function getDeviceIdentity(): Promise<DeviceIdentity> {
  if (!deviceIdentityPromise) {
    deviceIdentityPromise = Promise.resolve(loadOrCreateDeviceIdentity())
  }

  return deviceIdentityPromise
}

function reportPairingRequired(reason?: string) {
  void getDeviceIdentity()
    .then((identity) => {
      console.error(
        `[openclaw-gateway] Device auth rejected (${reason || "policy violation"}). Device ID: ${identity.deviceId}`
      )
      console.error(
        `[openclaw-gateway] If pairing is required, run: openclaw devices approve ${identity.deviceId}`
      )
    })
    .catch(() => {
      console.error(
        `[openclaw-gateway] Device auth rejected (${reason || "policy violation"}).`
      )
    })
}

function asRecord(value: unknown): GatewayFrame | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as GatewayFrame)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function normalizeError(frame: GatewayFrame) {
  const error = asRecord(frame.error)
  return (
    asString(frame.message) ||
    asString(frame.error) ||
    asString(error?.message) ||
    "Gateway request failed"
  )
}

function errorStatusFromFrame(frame: GatewayFrame) {
  const error = asRecord(frame.error)
  const details = asRecord(error?.details)
  const code = asString(error?.code) || asString(details?.code)
  const authReason = asString(details?.authReason)

  if (
    code === "AUTH_TOKEN_MISMATCH" ||
    code === "UNAUTHORIZED" ||
    authReason === "token_mismatch" ||
    authReason === "missing"
  ) {
    return 401
  }

  return 503
}

function appErrorFromFrame(frame: GatewayFrame) {
  const error = asRecord(frame.error)
  const details = asRecord(error?.details)
  return new AppError(
    normalizeError(frame),
    errorStatusFromFrame(frame),
    asString(details?.code) || asString(error?.code)
  )
}

function reportPairingErrorFromFrame(frame: GatewayFrame) {
  const error = asRecord(frame.error)
  const details = asRecord(error?.details)
  const code = asString(details?.code) || asString(error?.code)
  const reason = asString(details?.reason) || asString(details?.authReason) || code

  if (
    code === "AUTH_SCOPE_MISMATCH" ||
    code === "DEVICE_PAIRING_REQUIRED" ||
    code === "DEVICE_AUTH_REJECTED"
  ) {
    reportPairingRequired(reason)
  }
}

function extractPayload(frame: GatewayFrame) {
  if (frame.ok === false) {
    throw appErrorFromFrame(frame)
  }

  return frame.payload ?? frame.result ?? frame.data ?? frame
}

function isChallengeFrame(frame: GatewayFrame) {
  const payload = asRecord(frame.payload)

  return (
    frame.type === "challenge" ||
    frame.event === "challenge" ||
    frame.event === "connect.challenge" ||
    frame.kind === "challenge" ||
    typeof frame.nonce === "string" ||
    typeof frame.challenge === "string" ||
    typeof payload?.nonce === "string" ||
    typeof payload?.challenge === "string"
  )
}

function getNonce(frame: GatewayFrame) {
  const payload = asRecord(frame.payload)
  return (
    asString(frame.nonce) ||
    asString(frame.challenge) ||
    asString(payload?.nonce) ||
    asString(payload?.challenge)
  )
}

async function makeConnectionRequest(auth: GatewayAuth, challenge?: string) {
  const clientId = "gateway-client"
  const clientMode = "ui"
  const role = "operator"
  const scopes = ["operator.admin"]
  const request: GatewayFrame = {
    minProtocol: 4,
    maxProtocol: 4,
    client: {
      id: clientId,
      displayName: "outclaw",
      version: "dev",
      platform: process.platform,
      mode: clientMode,
      instanceId: randomUUID(),
    },
    role,
    scopes,
    auth: {
      token: auth.token || undefined,
      password: auth.password || undefined,
    },
  }

  try {
    const identity = await getDeviceIdentity()
    const signedAt = Date.now()
    const version = challenge ? "v2" : "v1"
    const base = [
      version,
      identity.deviceId,
      clientId,
      clientMode,
      role,
      scopes.join(","),
      String(signedAt),
      auth.token || "",
    ]
    if (version === "v2") base.push(challenge || "")
    const signature = signPayload(identity.privateKey, base.join("|"))

    request.device = {
      id: identity.deviceId,
      publicKey: identity.publicKeyRawBase64Url,
      signature,
      signedAt,
      nonce: challenge,
    }
  } catch (error) {
    console.warn(
      "[openclaw-gateway] Device auth unavailable, continuing without device signature:",
      error instanceof Error ? error.message : String(error)
    )
  }

  return request
}

function makeRpcFrame(id: string, method: string, params?: unknown) {
  return {
    id,
    type: "req",
    method,
    params: params ?? {},
  }
}

async function openGateway() {
  const auth = getGatewayAuth()
  const ws = new WebSocket(getGatewayUrl())

  const waitForOpen = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new AppError("Gateway connection timed out", 503)),
      REQUEST_TIMEOUT_MS
    )

    ws.once("open", () => {
      clearTimeout(timeout)
      resolve()
    })
    ws.once("error", () => {
      clearTimeout(timeout)
      reject(new AppError("Gateway connection failed", 503))
    })
  })

  await waitForOpen

  const pendingFrames: GatewayFrame[] = []

  const nextFrame = (predicate: (frame: GatewayFrame) => boolean) =>
    new Promise<GatewayFrame>((resolve, reject) => {
      const existingIndex = pendingFrames.findIndex(predicate)
      if (existingIndex >= 0) {
        const [frame] = pendingFrames.splice(existingIndex, 1)
        resolve(frame)
        return
      }

      const timeout = setTimeout(() => {
        cleanup()
        reject(new AppError("Gateway response timed out", 503))
      }, REQUEST_TIMEOUT_MS)

      const onMessage = (data: WebSocket.RawData) => {
        let frame: GatewayFrame | undefined
        try {
          frame = asRecord(JSON.parse(String(data)))
        } catch {
          return
        }

        if (!frame) return

        try {
          if (predicate(frame)) {
            cleanup()
            resolve(frame)
          } else {
            pendingFrames.push(frame)
          }
        } catch (error) {
          cleanup()
          reject(error)
        }
      }

      const onClose = (code: number, reasonBuffer: Buffer) => {
        cleanup()
        if (code === 1008) reportPairingRequired(reasonBuffer.toString())
        reject(new AppError("Gateway connection closed", 503))
      }

      const cleanup = () => {
        clearTimeout(timeout)
        ws.off("message", onMessage)
        ws.off("close", onClose)
      }

      ws.on("message", onMessage)
      ws.on("close", onClose)
    })

  const firstFrame = await nextFrame(() => true)
  const challenge = isChallengeFrame(firstFrame) ? getNonce(firstFrame) : undefined
  if (!challenge) {
    pendingFrames.push(firstFrame)
    throw new AppError("Gateway connect challenge missing nonce", 503)
  }
  if (firstFrame && !isChallengeFrame(firstFrame)) pendingFrames.push(firstFrame)

  const connectId = randomUUID()
  ws.send(JSON.stringify(makeRpcFrame(connectId, "connect", await makeConnectionRequest(auth, challenge))))

  await nextFrame((frame) => {
    if (frame.ok === false) {
      reportPairingErrorFromFrame(frame)
      throw appErrorFromFrame(frame)
    }
    return frame.id === connectId && frame.ok === true
  }).catch((error) => {
    if (error instanceof AppError) throw error
    throw new AppError("Gateway handshake failed", 503)
  })

  return {
    request: async (method: string, params?: unknown) => {
      const id = randomUUID()
      ws.send(JSON.stringify(makeRpcFrame(id, method, params)))
      const frame = await nextFrame((candidate) => candidate.id === id)
      return extractPayload(frame)
    },
    close: () => ws.close(),
  }
}

async function requestFirst(methods: string[], params?: unknown) {
  return withGatewaySlot(async () => {
    const gateway = await openGateway()
    try {
      let lastError: unknown
      for (const method of methods) {
        try {
          return await gateway.request(method, params)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError
    } finally {
      gateway.close()
    }
  })
}

function slugify(value: string | undefined) {
  const slug = (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)

  return slug || "main"
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "number") {
    return new Date(value < 10_000_000_000 ? value * 1000 : value)
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed)
  }
  return new Date()
}

function normalizeSession(raw: unknown): Session {
  const item = asRecord(raw) ?? {}
  const key =
    asString(item.key) ||
    asString(item.sessionKey) ||
    asString(item.session_key) ||
    asString(item.id) ||
    "main"
  const friendlyId =
    asString(item.friendlyId) ||
    asString(item.friendly_id) ||
    asString(item.routeId) ||
    asString(item.route_id) ||
    slugify(key.split("/").pop())
  const title =
    asString(item.label) ||
    asString(item.title) ||
    asString(item.derivedTitle) ||
    asString(item.derived_title) ||
    asString(item.lastMessage) ||
    friendlyId

  return {
    id: friendlyId,
    key,
    friendlyId,
    title,
    pinned: false,
    updatedAt: normalizeTimestamp(item.updatedAt ?? item.updated_at ?? item.modifiedAt),
    lastMessage: asString(item.lastMessage) || asString(item.last_message),
  }
}

function normalizeAttachment(raw: unknown): Attachment | undefined {
  const item = asRecord(raw)
  if (!item) return undefined
  const name = asString(item.name) || "attachment"
  const type = asString(item.type) || asString(item.mimeType) || "application/octet-stream"
  const size = typeof item.size === "number" ? item.size : 0
  const url = asString(item.url) || asString(item.previewUrl)
  return { name, type, size, url }
}

function extractTextPart(part: GatewayFrame) {
  return (
    asString(part.text) ||
    asString(part.content) ||
    asString(part.value) ||
    ""
  )
}

function normalizeToolCall(part: GatewayFrame, index: number): ToolCall {
  const result = asRecord(part.result)
  const isError = part.error === true || result?.error === true || typeof part.error === "string"
  return {
    id: asString(part.id) || asString(part.callId) || `tool-${index}`,
    name: asString(part.name) || asString(part.tool) || "tool",
    input: asRecord(part.input) || asRecord(part.arguments),
    output: asString(part.output) || asString(result?.text) || asString(result?.output),
    error: typeof part.error === "string" ? part.error : asString(result?.error),
    status: isError ? "error" : result || part.output ? "success" : "pending",
  }
}

function normalizeMessage(raw: unknown, index: number): Message | undefined {
  const item = asRecord(raw)
  if (!item) return undefined

  const role = asString(item.role) || asString(item.author) || "assistant"
  if (!["user", "assistant", "tool"].includes(role)) return undefined

  const parts = Array.isArray(item.parts)
    ? item.parts
    : Array.isArray(item.content)
      ? item.content
      : []
  const textParts: string[] = []
  const reasoningParts: string[] = []
  const toolCalls: ToolCall[] = []
  const attachments: Attachment[] = []

  for (const part of parts) {
    const record = asRecord(part)
    if (!record) continue
    const partType = asString(record.type) || asString(record.kind)
    if (partType === "thinking" || partType === "reasoning") {
      reasoningParts.push(extractTextPart(record))
    } else if (partType === "tool_call" || partType === "tool-call" || partType === "tool") {
      toolCalls.push(normalizeToolCall(record, toolCalls.length))
    } else if (partType === "image" || String(partType).startsWith("image")) {
      const attachment = normalizeAttachment(record)
      if (attachment) attachments.push(attachment)
    } else {
      const text = extractTextPart(record)
      if (text) textParts.push(text)
    }
  }

  const content = asString(item.text) || asString(item.message) || asString(item.content) || textParts.join("\n\n")
  const rawAttachments = Array.isArray(item.attachments) ? item.attachments : []

  return {
    id: asString(item.id) || asString(item.messageId) || `message-${index}`,
    role: role as Message["role"],
    content,
    timestamp: normalizeTimestamp(item.timestamp ?? item.createdAt ?? item.created_at),
    attachments: [...attachments, ...rawAttachments.map(normalizeAttachment).filter(Boolean)] as Attachment[],
    reasoning: reasoningParts.filter(Boolean).join("\n\n") || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

function listFromPayload(payload: unknown) {
  if (Array.isArray(payload)) return payload
  const record = asRecord(payload)
  if (!record) return []
  return (
    (Array.isArray(record.sessions) && record.sessions) ||
    (Array.isArray(record.items) && record.items) ||
    (Array.isArray(record.messages) && record.messages) ||
    []
  )
}

export async function pingGateway() {
  return withGatewaySlot(async () => {
    const gateway = await openGateway()
    gateway.close()
    return { ok: true }
  })
}

export async function listSessions() {
  const cached = getSessionListCache()
  if (cached && cached.expiresAt > Date.now()) return cached.value

  try {
    const payload = await requestFirst(["sessions.list"], {
      limit: 50,
      includeLastMessage: true,
      includeDerivedTitles: true,
    })
    const sessions = listFromPayload(payload).map(normalizeSession)
    setSessionListCache(sessions)
    return sessions
  } catch (error) {
    if (cached) return cached.value
    throw error
  }
}

async function resolveSessionKey(identifier: string) {
  if (identifier.includes(":")) return identifier

  const resolved = await requestFirst(["sessions.resolve"], {
    key: identifier,
    includeUnknown: true,
    includeGlobal: true,
  }).catch(() => undefined)
  const resolvedRecord = asRecord(resolved)
  const resolvedSession = asRecord(resolvedRecord?.session)
  const resolvedKey =
    asString(resolvedRecord?.key) ||
    asString(resolvedRecord?.sessionKey) ||
    asString(resolvedSession?.key)
  if (resolvedKey && resolvedKey !== identifier) return resolvedKey

  const sessions = await listSessions().catch(() => [])
  return (
    sessions.find(
      (session) =>
        session.id === identifier ||
        session.friendlyId === identifier ||
        session.key === identifier
    )?.key || resolvedKey || identifier
  )
}

export async function createSession(label?: string) {
  const friendlyId = `${slugify(label || "conversation")}-${Date.now().toString(36)}`
  const payload = await requestFirst(["sessions.patch"], { label, key: friendlyId })
  await requestFirst(["sessions.resolve"], {
    key: friendlyId,
    includeUnknown: true,
    includeGlobal: true,
  }).catch(() => undefined)
  invalidateSessionListCache()
  return normalizeSession(asRecord(payload)?.session ?? payload ?? { key: friendlyId, friendlyId, label })
}

export async function updateSession(identifier: string, label: string) {
  const resolvedKey = await resolveSessionKey(identifier)
  const payload = await requestFirst(["sessions.patch"], { key: resolvedKey, label })
  invalidateSessionListCache()
  return normalizeSession(asRecord(payload)?.session ?? payload ?? { key: identifier, label })
}

export async function deleteSession(identifier: string) {
  const resolvedKey = await resolveSessionKey(identifier)
  await requestFirst(["sessions.delete"], { key: resolvedKey })
  if (resolvedKey !== identifier) {
    await requestFirst(["sessions.delete"], { key: identifier }).catch(() => undefined)
  }
  invalidateSessionListCache()
  return { ok: true }
}

export async function loadHistory(identifier?: string, limit = 200) {
  const sessionKey = identifier ? await resolveSessionKey(identifier) : ""
  const payload = await requestFirst(["chat.history"], {
    sessionKey: sessionKey || "main",
    limit,
  })
  return listFromPayload(payload)
    .map(normalizeMessage)
    .filter(Boolean) as Message[]
}

export async function sendMessage(params: {
  session?: string
  text?: string
  thinkingLevel: "low" | "medium" | "high"
  attachments?: Attachment[]
  idempotencyKey: string
}) {
  const sessionKey = params.session ? await resolveSessionKey(params.session) : ""

  return requestFirst(["chat.send"], {
    sessionKey: sessionKey || "main",
    message: params.text,
    thinking: params.thinkingLevel,
    attachments: params.attachments,
    deliver: true,
    timeoutMs: 120_000,
    idempotencyKey: params.idempotencyKey,
  })
}

export function toErrorResponse(error: unknown) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(error instanceof Error ? error.message : "Unexpected error")

  return Response.json(
    { error: appError.message, code: appError.code },
    { status: appError.status }
  )
}
