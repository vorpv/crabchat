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
import { getOpenClawConnectionConfig } from "@/lib/crabchat-home"
import type { KeyObject } from "node:crypto"
import type {
  Agent,
  AgentActivity,
  Attachment,
  Message,
  ModelOption,
  ProviderUsageSummary,
  ProviderUsageWindow,
  Session,
  SessionDefaults,
  ThinkingLevelOption,
  ToolCall,
  UsageStatus,
} from "@/lib/types"

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789"
const REQUEST_TIMEOUT_MS = 20_000
const DEVICE_KEYS_PATH = pathResolve(process.cwd(), ".device-keys.json")
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")
const GATEWAY_QUEUE = Symbol.for("crabchat.gatewayQueue.v2")
const SESSION_LIST_CACHE = Symbol.for("crabchat.sessionListCache")
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
  value: {
    sessions: Session[]
    defaults: SessionDefaults
  }
}

type GatewayQueue = {
  tail: Promise<void>
}

type PendingGatewayRequest = {
  reject: (error: Error) => void
  resolve: (payload: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

type OpenGatewayOptions = {
  onEvent?: (event: string, payload: GatewayFrame) => void
  onClose?: (error: AppError) => void
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

function setSessionListCache(value: { sessions: Session[]; defaults: SessionDefaults }) {
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

type ErrorResponseContext = {
  method?: string
  path?: string
}

function getGatewayAuth(): GatewayAuth {
  const { token, password } = getOpenClawConnectionConfig()

  if (!token && !password) {
    throw new AppError(
      "Missing gateway auth. Configure openclaw.token or openclaw.password in crabchat.json.",
      401,
      "missing_auth"
    )
  }

  return { token, password }
}

function getGatewayUrl() {
  return getOpenClawConnectionConfig().gatewayUrl || DEFAULT_GATEWAY_URL
}

function isLoopbackGatewayUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
  } catch {
    return false
  }
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

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
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

function isEventFrame(frame: GatewayFrame) {
  return frame.type === "event" && typeof frame.event === "string"
}

function makeGatewayCloseError(code: number, reasonBuffer: Buffer) {
  const reason = reasonBuffer.toString()
  if (code === 1008) reportPairingRequired(reason)

  return new AppError(
    reason
      ? `Gateway connection closed (${code}): ${reason}`
      : `Gateway connection closed (${code})`,
    503,
    "gateway_connection_closed"
  )
}

async function makeConnectionRequest(auth: GatewayAuth, challenge?: string) {
  const clientId = "gateway-client"
  const clientMode = "backend"
  const role = "operator"
  const scopes = ["operator.read", "operator.write", "operator.admin"]
  const gatewayUrl = getGatewayUrl()
  const useSharedLoopbackBackendAuth =
    Boolean(auth.token || auth.password) && isLoopbackGatewayUrl(gatewayUrl)
  const request: GatewayFrame = {
    minProtocol: 4,
    maxProtocol: 4,
    client: {
      id: clientId,
      displayName: "CrabChat",
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

  if (!useSharedLoopbackBackendAuth) {
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

async function openGateway(options: OpenGatewayOptions = {}) {
  const auth = getGatewayAuth()
  const ws = new WebSocket(getGatewayUrl())
  const pendingFrames: GatewayFrame[] = []

  // Buffer early frames so we do not miss the pre-connect challenge if the
  // gateway sends it immediately after the socket opens.
  const bufferEarlyFrames = (data: WebSocket.RawData) => {
    try {
      const frame = asRecord(JSON.parse(String(data)))
      if (frame) pendingFrames.push(frame)
    } catch {
      // Ignore malformed early frames; the normal request path will fail cleanly.
    }
  }

  ws.on("message", bufferEarlyFrames)

  const waitForOpen = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new AppError(
            "Gateway connection timed out",
            503,
            "gateway_connection_timeout"
          )
        ),
      REQUEST_TIMEOUT_MS
    )

    ws.once("open", () => {
      clearTimeout(timeout)
      resolve()
    })
    ws.once("error", (error) => {
      clearTimeout(timeout)
      reject(
        new AppError(
          error.message || "Gateway connection failed",
          503,
          "gateway_connection_failed"
        )
      )
    })
  })

  await waitForOpen

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
        reject(
          new AppError(
            "Gateway response timed out",
            503,
            "gateway_response_timeout"
          )
        )
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
        const reason = reasonBuffer.toString()
        if (code === 1008) reportPairingRequired(reason)
        reject(
          new AppError(
            reason
              ? `Gateway connection closed (${code}): ${reason}`
              : `Gateway connection closed (${code})`,
            503,
            "gateway_connection_closed"
          )
        )
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
    throw new AppError(
      "Gateway connect challenge missing nonce",
      503,
      "gateway_challenge_missing_nonce"
    )
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
    throw new AppError("Gateway handshake failed", 503, "gateway_handshake_failed")
  })

  ws.off("message", bufferEarlyFrames)

  const pendingRequests = new Map<string, PendingGatewayRequest>()
  let closedError: AppError | null = null

  const rejectPendingRequests = (error: AppError) => {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    pendingRequests.clear()
  }

  const handleClose = (code: number, reasonBuffer: Buffer) => {
    closedError = makeGatewayCloseError(code, reasonBuffer)
    rejectPendingRequests(closedError)
    options.onClose?.(closedError)
  }

  const dispatchFrame = (data: WebSocket.RawData) => {
    let frame: GatewayFrame | undefined
    try {
      frame = asRecord(JSON.parse(String(data)))
    } catch {
      return
    }

    if (!frame) return

    const id = asString(frame.id)
    if (id && pendingRequests.has(id)) {
      const pending = pendingRequests.get(id)
      if (!pending) return
      pendingRequests.delete(id)
      clearTimeout(pending.timeout)
      try {
        pending.resolve(extractPayload(frame))
      } catch (error) {
        pending.reject(
          error instanceof Error
            ? error
            : new AppError("Gateway request failed", 503, "gateway_request_failed")
        )
      }
      return
    }

    if (isEventFrame(frame)) {
      options.onEvent?.(String(frame.event), asRecord(frame.payload) ?? frame)
      return
    }

    pendingFrames.push(frame)
  }

  ws.on("message", dispatchFrame)
  ws.on("close", handleClose)

  for (const frame of pendingFrames.splice(0)) {
    if (isEventFrame(frame)) {
      options.onEvent?.(String(frame.event), asRecord(frame.payload) ?? frame)
    }
  }

  return {
    request: async (method: string, params?: unknown) => {
      if (closedError) throw closedError
      const id = randomUUID()
      return new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRequests.delete(id)
          reject(
            new AppError(
              "Gateway response timed out",
              503,
              "gateway_response_timeout"
            )
          )
        }, REQUEST_TIMEOUT_MS)

        pendingRequests.set(id, { resolve, reject, timeout })

        try {
          ws.send(JSON.stringify(makeRpcFrame(id, method, params)))
        } catch (error) {
          clearTimeout(timeout)
          pendingRequests.delete(id)
          reject(
            new AppError(
              error instanceof Error ? error.message : "Gateway request failed",
              503,
              "gateway_request_failed"
            )
          )
        }
      })
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

function getAgentIdFromSessionKey(key: string) {
  const match = /^agent:([^:]+):/.exec(key)
  return match?.[1]
}

function normalizeThinkingLevelOption(raw: unknown): ThinkingLevelOption | undefined {
  const item = asRecord(raw)
  if (!item) return undefined

  const id = asString(item.id)
  const label = asString(item.label)
  if (!id || !label) return undefined

  return { id, label }
}

function normalizeThinkingOptions(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : undefined
}

function normalizeUsageWindow(raw: unknown): ProviderUsageWindow | undefined {
  const item = asRecord(raw)
  if (!item) return undefined

  const label = asString(item.label)
  const usedPercent = asNumber(item.usedPercent ?? item.used_percent)
  if (!label || usedPercent === undefined) return undefined

  return {
    label,
    usedPercent,
    resetAt: asNumber(item.resetAt ?? item.reset_at),
  }
}

function normalizeUsageProvider(raw: unknown): ProviderUsageSummary | undefined {
  const item = asRecord(raw)
  if (!item) return undefined

  const provider = asString(item.provider)
  if (!provider) return undefined

  return {
    provider,
    displayName: asString(item.displayName) || provider,
    windows: Array.isArray(item.windows)
      ? (item.windows.map(normalizeUsageWindow).filter(Boolean) as ProviderUsageWindow[])
      : [],
    plan: asString(item.plan),
    error: asString(item.error),
  }
}

function normalizeSessionAgentName(item: GatewayFrame) {
  const runtime = asRecord(item.agentRuntime)
  const agent = asRecord(item.agent)

  return (
    asString(item.agentName) ||
    asString(item.agent_name) ||
    asString(runtime?.name) ||
    asString(agent?.name)
  )
}

function normalizeSessionWorkspaceRoot(item: GatewayFrame) {
  const workspace = asRecord(item.workspace)
  const runtime = asRecord(item.agentRuntime)
  const runtimeWorkspace = asRecord(runtime?.workspace)
  const agent = asRecord(item.agent)
  const agentWorkspace = asRecord(agent?.workspace)

  return (
    asString(item.workspaceRoot) ||
    asString(item.workspace_root) ||
    asString(item.workspacePath) ||
    asString(item.workspace_path) ||
    asString(item.workingDirectory) ||
    asString(item.working_directory) ||
    asString(item.projectRoot) ||
    asString(item.project_root) ||
    asString(workspace?.root) ||
    asString(workspace?.path) ||
    asString(runtime?.workspaceRoot) ||
    asString(runtime?.workspace_root) ||
    asString(runtime?.workspacePath) ||
    asString(runtime?.workspace_path) ||
    asString(runtime?.workingDirectory) ||
    asString(runtime?.working_directory) ||
    asString(runtimeWorkspace?.root) ||
    asString(runtimeWorkspace?.path) ||
    asString(agent?.workspaceRoot) ||
    asString(agent?.workspace_root) ||
    asString(agent?.workspacePath) ||
    asString(agent?.workspace_path) ||
    asString(agentWorkspace?.root) ||
    asString(agentWorkspace?.path)
  )
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
  const agentId = getAgentIdFromSessionKey(key)
  const agentName = normalizeSessionAgentName(item)
  const explicitTitle = asString(item.label) || asString(item.title)
  const derivedTitle =
    asString(item.derivedTitle) ||
    asString(item.derived_title) ||
    asString(item.lastMessage)
  const normalizedExplicitTitle = explicitTitle?.trim().toLowerCase()
  const shouldPreferDerivedTitle =
    Boolean(derivedTitle) &&
    Boolean(
      normalizedExplicitTitle &&
        (normalizedExplicitTitle === agentId?.trim().toLowerCase() ||
          normalizedExplicitTitle === agentName?.trim().toLowerCase())
    )
  const title =
    (shouldPreferDerivedTitle ? derivedTitle : undefined) ||
    explicitTitle ||
    derivedTitle ||
    friendlyId

  return {
    id: friendlyId,
    key,
    friendlyId,
    title,
    pinned: false,
    agentId,
    agentName,
    workspaceRoot: normalizeSessionWorkspaceRoot(item),
    runtimeStatus: asString(item.status),
    hasActiveRun: item.hasActiveRun === true,
    model: asString(item.model),
    modelProvider: asString(item.modelProvider),
    thinkingLevel: asString(item.thinkingLevel),
    thinkingLevels: Array.isArray(item.thinkingLevels)
      ? item.thinkingLevels.map(normalizeThinkingLevelOption).filter(Boolean) as ThinkingLevelOption[]
      : undefined,
    thinkingOptions: normalizeThinkingOptions(item.thinkingOptions),
    thinkingDefault: asString(item.thinkingDefault),
    inputTokens: asNumber(item.inputTokens ?? item.input_tokens),
    outputTokens: asNumber(item.outputTokens ?? item.output_tokens),
    contextTokens: asNumber(
      item.usedContextTokens ??
        item.used_context_tokens ??
        item.contextUsedTokens ??
        item.context_used_tokens ??
        item.totalTokens ??
        item.total_tokens
    ),
    contextCapacityTokens: asNumber(item.contextTokens ?? item.context_tokens),
    totalTokens: asNumber(item.totalTokens ?? item.total_tokens),
    totalTokensFresh: item.totalTokensFresh === true,
    updatedAt: normalizeTimestamp(item.updatedAt ?? item.updated_at ?? item.modifiedAt),
    lastMessage: asString(item.lastMessage) || asString(item.last_message),
  }
}

function normalizeSessionDefaults(raw: unknown): SessionDefaults {
  const item = asRecord(raw) ?? {}
  return {
    defaultAgentId: asString(item.defaultAgentId),
    mainKey: asString(item.mainKey),
    mainSessionKey: asString(item.mainSessionKey),
    model: asString(item.model),
    modelProvider: asString(item.modelProvider),
    thinkingLevel: asString(item.thinkingLevel),
    thinkingLevels: Array.isArray(item.thinkingLevels)
      ? item.thinkingLevels.map(normalizeThinkingLevelOption).filter(Boolean) as ThinkingLevelOption[]
      : undefined,
    thinkingOptions: normalizeThinkingOptions(item.thinkingOptions),
    thinkingDefault: asString(item.thinkingDefault),
  }
}

function normalizeAgent(raw: unknown): Agent | undefined {
  const item = asRecord(raw)
  if (!item) return undefined

  const id = asString(item.id)
  if (!id) return undefined
  const model = asRecord(item.model)

  return {
    id,
    name: asString(item.name) || id,
    description: asString(item.description),
    model: model
      ? {
          primary: asString(model.primary),
          fallbacks: Array.isArray(model.fallbacks)
            ? model.fallbacks
                .map((entry) => asString(entry))
                .filter(Boolean) as string[]
            : undefined,
        }
      : undefined,
  }
}

function normalizeModel(raw: unknown): ModelOption | undefined {
  const item = asRecord(raw)
  if (!item) return undefined

  const modelId = asString(item.id)
  const provider = asString(item.provider)
  const id =
    modelId && provider && !modelId.includes("/") ? `${provider}/${modelId}` : modelId
  if (!id) return undefined

  return {
    id,
    name: asString(item.alias) || asString(item.name) || id,
    provider,
    isDefault: item.default === true || item.isDefault === true,
    contextTokens: asNumber(item.contextTokens ?? item.context_tokens),
    contextWindow: asNumber(item.contextWindow ?? item.context_window),
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

function getToolCallId(part: GatewayFrame) {
  return (
    asString(part.id) ||
    asString(part.callId) ||
    asString(part.toolCallId) ||
    asString(part.toolUseId) ||
    asString(part.tool_use_id)
  )
}

function isToolCallPart(type: string | undefined) {
  return (
    type === "tool_call" ||
    type === "tool-call" ||
    type === "toolCall" ||
    type === "tool"
  )
}

function isToolResultPart(type: string | undefined) {
  return type === "tool_result" || type === "tool-result" || type === "toolResult"
}

function getFailedToolPayload(output: string) {
  if (!output.trim()) return undefined

  try {
    const parsed = asRecord(JSON.parse(output))
    const status = asString(parsed?.status)?.toLowerCase()
    if (["failed", "failure", "error", "errored", "cancelled", "canceled"].includes(status || "")) {
      return parsed
    }
    if (parsed?.ok === false || parsed?.success === false || parsed?.isError === true) {
      return parsed
    }
  } catch {
    return undefined
  }

  return undefined
}

function normalizeToolCall(part: GatewayFrame, index: number): ToolCall {
  const result = asRecord(part.result)
  const output =
    asString(part.output) ||
    asString(result?.text) ||
    asString(result?.output) ||
    extractTextPart(part)
  const failedPayload = getFailedToolPayload(output)
  const isError =
    part.error === true ||
    part.isError === true ||
    result?.error === true ||
    Boolean(failedPayload) ||
    typeof part.error === "string"
  const error =
    typeof part.error === "string"
      ? part.error
      : asString(result?.error) || asString(failedPayload?.error) || (isError ? output : undefined)
  return {
    id: getToolCallId(part) || `tool-${index}`,
    name: asString(part.name) || asString(part.toolName) || asString(part.tool) || "tool",
    input: asRecord(part.input) || asRecord(part.arguments),
    output,
    error,
    status: isError ? "error" : output || result ? "success" : "pending",
    rawCall: part,
  }
}

function normalizeMessage(raw: unknown, index: number): Message | undefined {
  const item = asRecord(raw)
  if (!item) return undefined

  const rawRole = asString(item.role) || asString(item.author) || "assistant"
  const role = rawRole === "toolResult" ? "tool" : rawRole
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
    } else if (isToolCallPart(partType) || isToolResultPart(partType)) {
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
  const rawUsage = asRecord(item.usage)
  const rawUsageContext = asRecord(rawUsage?.context)
  const rawContextWindow = asRecord(item.contextWindow) || asRecord(item.context_window)
  const usage = {
    inputTokens: asNumber(
      rawUsage?.input ??
        rawUsage?.inputTokens ??
        rawUsage?.input_tokens ??
        item.inputTokens ??
        item.input_tokens
    ),
    outputTokens: asNumber(
      rawUsage?.output ??
        rawUsage?.outputTokens ??
        rawUsage?.output_tokens ??
        item.outputTokens ??
        item.output_tokens
    ),
    totalTokens: asNumber(
      rawUsage?.totalTokens ??
        rawUsage?.total_tokens ??
        rawUsage?.total ??
        item.totalTokens ??
        item.total_tokens
    ),
    contextTokens: asNumber(
      rawUsage?.contextTokens ??
        rawUsage?.context_tokens ??
        rawUsage?.usedContextTokens ??
        rawUsage?.used_context_tokens ??
        rawUsage?.totalTokens ??
        rawUsage?.total_tokens ??
        rawUsage?.total ??
        item.contextTokens ??
        item.context_tokens ??
        item.totalTokens ??
        item.total_tokens
    ),
    contextCapacityTokens: asNumber(
      rawUsage?.contextCapacityTokens ??
        rawUsage?.context_capacity_tokens ??
        rawUsageContext?.capacityTokens ??
        rawUsageContext?.capacity_tokens ??
        rawContextWindow?.capacityTokens ??
        rawContextWindow?.capacity_tokens ??
        item.contextCapacityTokens ??
        item.context_capacity_tokens
    ),
    contextUsagePercent: asNumber(
      rawUsage?.contextUsagePercent ??
        rawUsage?.context_usage_percent ??
        rawUsage?.contextPercent ??
        rawUsage?.context_percent ??
        rawUsage?.usagePercent ??
        rawUsage?.usage_percent ??
        rawUsageContext?.usagePercent ??
        rawUsageContext?.usage_percent ??
        rawUsageContext?.percent ??
        rawContextWindow?.usagePercent ??
        rawContextWindow?.usage_percent ??
        rawContextWindow?.percent ??
        item.contextUsagePercent ??
        item.context_usage_percent
    ),
    model: asString(item.model) || asString(rawUsage?.model),
    modelProvider: asString(item.provider) || asString(item.modelProvider) || asString(rawUsage?.provider),
    reasoningLevel:
      asString(item.reasoningLevel) ||
      asString(item.thinkingLevel) ||
      asString(rawUsage?.reasoningLevel) ||
      asString(rawUsage?.thinkingLevel),
  }
  const hasUsage = Object.values(usage).some((value) => value !== undefined)

  const message: Message = {
    id: asString(item.id) || asString(item.messageId) || `message-${index}`,
    role: role as Message["role"],
    content,
    timestamp: normalizeTimestamp(item.timestamp ?? item.createdAt ?? item.created_at),
    attachments: [...attachments, ...rawAttachments.map(normalizeAttachment).filter(Boolean)] as Attachment[],
    reasoning: reasoningParts.filter(Boolean).join("\n\n") || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: hasUsage ? usage : undefined,
  }

  const hasVisibleContent = message.content.trim().length > 0
  const hasVisibleAttachments = Boolean(message.attachments && message.attachments.length > 0)
  const hasVisibleReasoning = Boolean(message.reasoning && message.reasoning.trim().length > 0)
  const hasVisibleToolCalls = Boolean(message.toolCalls && message.toolCalls.length > 0)

  if (
    message.role !== "user" &&
    !hasVisibleContent &&
    !hasVisibleAttachments &&
    !hasVisibleReasoning &&
    !hasVisibleToolCalls
  ) {
    return undefined
  }

  return message
}

function mergeToolResultMessages(messages: Message[]) {
  const merged: Message[] = []
  const toolCallsById = new Map<string, ToolCall>()

  for (const message of messages) {
    if (message.role === "tool" && message.toolCalls && message.toolCalls.length > 0) {
      let consumed = false

      for (const result of message.toolCalls) {
        const existing = toolCallsById.get(result.id)
        if (!existing) continue

        existing.output =
          existing.output && result.output
            ? `${existing.output}\n${result.output}`
            : result.output || existing.output
        existing.error = result.error || existing.error
        existing.status =
          existing.status === "error" || result.status === "error"
            ? "error"
            : result.status
        existing.rawResults = [...(existing.rawResults || []), result.rawCall].filter(Boolean)
        consumed = true
      }

      if (consumed && message.content.trim().length === 0) {
        continue
      }
    }

    merged.push(message)

    for (const toolCall of message.toolCalls || []) {
      toolCallsById.set(toolCall.id, toolCall)
    }
  }

  return merged
}

function listFromPayload(payload: unknown) {
  if (Array.isArray(payload)) return payload
  const record = asRecord(payload)
  if (!record) return []
  return (
    (Array.isArray(record.sessions) && record.sessions) ||
    (Array.isArray(record.agents) && record.agents) ||
    (Array.isArray(record.items) && record.items) ||
    (Array.isArray(record.messages) && record.messages) ||
    []
  )
}

function isSessionActivelyRunning(status?: string, hasActiveRun?: boolean) {
  if (typeof hasActiveRun === "boolean") return hasActiveRun
  return status === "running"
}

function isTerminalSessionStatus(status?: string) {
  return ["done", "failed", "killed", "timeout"].includes(status || "")
}

function formatOperationLabel(operation?: string) {
  if (!operation) return "Running"
  if (operation === "compact") return "Compacting context"
  return operation
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function deriveSessionActivity(params: {
  sessionKey?: string
  status?: string
  hasActiveRun?: boolean
  operation?: string
  operationPhase?: string
  toolName?: string
  toolPhase?: string
}): AgentActivity {
  const {
    sessionKey,
    status,
    hasActiveRun,
    operation,
    operationPhase,
    toolName,
    toolPhase,
  } = params

  if (toolName && toolPhase === "start") {
    const formattedToolName = formatOperationLabel(toolName)
    return {
      kind: "tool",
      label: `Running ${formattedToolName}`,
      detail: toolName,
      active: true,
      sessionKey,
      updatedAt: Date.now(),
    }
  }

  if (operation && operationPhase === "start") {
    return {
      kind: "operation",
      label: formatOperationLabel(operation),
      detail: operation,
      active: true,
      sessionKey,
      updatedAt: Date.now(),
    }
  }

  if (isSessionActivelyRunning(status, hasActiveRun) && !isTerminalSessionStatus(status)) {
    return {
      kind: "thinking",
      label: "Thinking",
      active: true,
      sessionKey,
      updatedAt: Date.now(),
    }
  }

  return {
    kind: "idle",
    label: "Idle",
    active: false,
    sessionKey,
    updatedAt: Date.now(),
  }
}

function getToolEventName(payload: GatewayFrame) {
  const data = asRecord(payload.data)
  return (
    asString(data?.name) ||
    asString(payload.name) ||
    asString(payload.toolName) ||
    asString(payload.tool)
  )
}

function getToolEventPhase(payload: GatewayFrame) {
  const data = asRecord(payload.data)
  return asString(data?.phase) || asString(payload.phase) || asString(payload.status)
}

export async function getSessionActivitySnapshot(identifier: string): Promise<AgentActivity> {
  const resolvedKey = await resolveSessionKey(identifier)
  const { sessions } = await listSessions()
  const session = sessions.find((item) => item.key === resolvedKey || item.id === identifier)

  return deriveSessionActivity({
    sessionKey: session?.key || resolvedKey,
    status: session?.runtimeStatus,
    hasActiveRun: session?.hasActiveRun,
  })
}

export async function subscribeSessionActivity(
  identifier: string,
  callbacks: {
    onActivity: (activity: AgentActivity) => void
    onError?: (error: AppError) => void
    signal?: AbortSignal
  }
) {
  const resolvedKey = await resolveSessionKey(identifier)
  const { sessions } = await listSessions().catch(() => ({ sessions: [] as Session[] }))
  const initialSession = sessions.find(
    (item) => item.key === resolvedKey || item.id === identifier
  )
  let lastKnownStatus = initialSession?.runtimeStatus
  let lastKnownHasActiveRun = initialSession?.hasActiveRun
  let lastActivity = deriveSessionActivity({
    sessionKey: initialSession?.key || resolvedKey,
    status: lastKnownStatus,
    hasActiveRun: lastKnownHasActiveRun,
  })

  const emitIfChanged = (next: AgentActivity) => {
    if (
      next.kind === lastActivity.kind &&
      next.label === lastActivity.label &&
      next.active === lastActivity.active
    ) {
      return
    }

    lastActivity = next
    callbacks.onActivity(next)
  }

  callbacks.onActivity(lastActivity)

  const gateway = await openGateway({
    onClose: (error) => {
      if (!callbacks.signal?.aborted) callbacks.onError?.(error)
    },
    onEvent: (event, payload) => {
      const eventSessionKey =
        asString(payload.sessionKey) ||
        asString(payload.key) ||
        asString(asRecord(payload.session)?.key)
      if (eventSessionKey !== resolvedKey) return

      if (event === "sessions.changed") {
        lastKnownStatus = asString(payload.status)
        lastKnownHasActiveRun =
          typeof payload.hasActiveRun === "boolean" ? payload.hasActiveRun : undefined
        emitIfChanged(
          deriveSessionActivity({
            sessionKey: eventSessionKey,
            status: lastKnownStatus,
            hasActiveRun: lastKnownHasActiveRun,
          })
        )
        return
      }

      if (event === "session.operation") {
        const phase = asString(payload.phase)
        const operation = asString(payload.operation)
        if (phase === "start") {
          emitIfChanged(
            deriveSessionActivity({
              sessionKey: eventSessionKey,
              operation,
              operationPhase: phase,
            })
          )
        } else {
          emitIfChanged(
            deriveSessionActivity({
              sessionKey: eventSessionKey,
              status: lastKnownStatus,
              hasActiveRun: lastKnownHasActiveRun,
            })
          )
        }
        return
      }

      if (event === "session.tool") {
        const phase = getToolEventPhase(payload)
        const toolName = getToolEventName(payload)
        if (phase === "start" && toolName) {
          emitIfChanged(
            deriveSessionActivity({
              sessionKey: eventSessionKey,
              toolName,
              toolPhase: phase,
            })
          )
        } else {
          emitIfChanged(
            deriveSessionActivity({
              sessionKey: eventSessionKey,
              status: lastKnownStatus,
              hasActiveRun: lastKnownHasActiveRun,
            })
          )
        }
      }
    },
  })

  try {
    await gateway.request("sessions.subscribe", {})

    if (callbacks.signal?.aborted) {
      gateway.close()
      return
    }

    await new Promise<void>((resolve) => {
      if (!callbacks.signal) return

      const handleAbort = () => {
        callbacks.signal?.removeEventListener("abort", handleAbort)
        gateway.close()
        resolve()
      }

      callbacks.signal.addEventListener("abort", handleAbort)
    })
  } finally {
    gateway.close()
  }
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
      limit: 500,
      includeLastMessage: true,
      includeDerivedTitles: true,
    })
    const payloadRecord = asRecord(payload)
    const sessions = listFromPayload(payload).map(normalizeSession)
    const result = {
      sessions,
      defaults: normalizeSessionDefaults(payloadRecord?.defaults),
    }
    setSessionListCache(result)
    return result
  } catch (error) {
    if (cached) return cached.value
    throw error
  }
}

export async function listAgents() {
  const payload = await requestFirst(["agents.list"])
  return listFromPayload(payload).map(normalizeAgent).filter(Boolean) as Agent[]
}

export async function listConfiguredModels() {
  const payload = await requestFirst(["models.list"], { view: "all" })
  const record = asRecord(payload)
  const models = Array.isArray(record?.models)
    ? record.models
    : Array.isArray(record?.items)
      ? record.items
      : []
  return models.map(normalizeModel).filter(Boolean) as ModelOption[]
}

export async function getUsageStatus(): Promise<UsageStatus> {
  const payload = asRecord(await requestFirst(["usage.status"])) ?? {}

  return {
    updatedAt: asNumber(payload.updatedAt ?? payload.updated_at) ?? Date.now(),
    providers: Array.isArray(payload.providers)
      ? (payload.providers
          .map(normalizeUsageProvider)
          .filter(Boolean) as ProviderUsageSummary[])
      : [],
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
  const sessionRows = Array.isArray(sessions) ? sessions : sessions.sessions
  return (
    sessionRows.find(
      (session) =>
        session.id === identifier ||
        session.friendlyId === identifier ||
        session.key === identifier
    )?.key || resolvedKey || identifier
  )
}

export async function createSession(label?: string, agentId?: string) {
  const friendlyId = `${slugify(label || "conversation")}-${Date.now().toString(36)}`
  const payload = await requestFirst(["sessions.create"], {
    label,
    key: friendlyId,
    agentId,
  })
  await requestFirst(["sessions.resolve"], {
    key: friendlyId,
    agentId,
    includeUnknown: true,
    includeGlobal: true,
  }).catch(() => undefined)
  invalidateSessionListCache()
  const session = normalizeSession(
    asRecord(payload)?.session ?? payload ?? { key: friendlyId, friendlyId, label, agentId }
  )
  return { ...session, agentId: session.agentId || agentId }
}

export async function updateSession(identifier: string, label: string) {
  const resolvedKey = await resolveSessionKey(identifier)
  const payload = await requestFirst(["sessions.patch"], { key: resolvedKey, label })
  invalidateSessionListCache()
  return normalizeSession(asRecord(payload)?.session ?? payload ?? { key: identifier, label })
}

export async function patchSession(
  identifier: string,
  patch: {
    label?: string
    model?: string
    thinkingLevel?: string | null
  }
) {
  const resolvedKey = await resolveSessionKey(identifier)
  const payload = await requestFirst(["sessions.patch"], {
    key: resolvedKey,
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.model !== undefined ? { model: patch.model } : {}),
    ...(patch.thinkingLevel !== undefined ? { thinkingLevel: patch.thinkingLevel } : {}),
  })
  invalidateSessionListCache()
  return normalizeSession(asRecord(payload)?.session ?? payload ?? { key: identifier, ...patch })
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
  const messages = listFromPayload(payload)
    .map(normalizeMessage)
    .filter(Boolean) as Message[]

  return mergeToolResultMessages(messages)
}

export async function sendMessage(params: {
  session?: string
  text?: string
  attachments?: Attachment[]
  idempotencyKey: string
}) {
  const sessionKey = params.session ? await resolveSessionKey(params.session) : ""

  return requestFirst(["chat.send"], {
    sessionKey: sessionKey || "main",
    message: params.text,
    attachments: params.attachments,
    deliver: true,
    timeoutMs: 120_000,
    idempotencyKey: params.idempotencyKey,
  })
}

export function toErrorResponse(error: unknown, context: ErrorResponseContext = {}) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(error instanceof Error ? error.message : "Unexpected error")

  if (appError.status === 503) {
    console.error("[openclaw-api] 503 response", {
      method: context.method,
      path: context.path,
      code: appError.code,
      message: appError.message,
      gatewayUrl: getGatewayUrl(),
      stack: error instanceof Error ? error.stack : undefined,
    })
  }

  return Response.json(
    { error: appError.message, code: appError.code },
    { status: appError.status }
  )
}
