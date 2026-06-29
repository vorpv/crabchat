import { getOpenClawConnectionConfig } from "@/lib/crabchat-home"
import { AppError, requestOpenClawGateway } from "@/lib/openclaw-gateway"

type JsonObject = Record<string, unknown>

export interface SessionResetConfig {
  mode?: "daily" | "idle"
  atHour?: number
  idleMinutes?: number
}

export interface OpenClawSessionConfig {
  scope?: "per-sender" | "global"
  dmScope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer"
  reset?: SessionResetConfig
  resetByType?: {
    direct?: SessionResetConfig
    group?: SessionResetConfig
    thread?: SessionResetConfig
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

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function resolveGatewayUrl(gateway: JsonObject) {
  const remote = asObject(gateway.remote)
  const protocol = gateway.tls === true ? "wss" : "ws"
  const host = asString(gateway.host) || "127.0.0.1"
  const port = typeof gateway.port === "number" ? gateway.port : 18789

  return getOpenClawConnectionConfig().gatewayUrl || asString(gateway.url) || asString(remote?.url) || `${protocol}://${host}:${port}`
}

function resolveGatewayPassword(gateway: JsonObject) {
  const auth = asObject(gateway.auth)
  const remote = asObject(gateway.remote)
  return getOpenClawConnectionConfig().password || asString(auth?.password) || asString(remote?.password) || ""
}

function normalizeReset(value: unknown): SessionResetConfig | undefined {
  const record = asObject(value)
  if (!record) return undefined
  const reset: SessionResetConfig = {}
  if (record.mode === "daily" || record.mode === "idle") reset.mode = record.mode
  if (typeof record.atHour === "number") reset.atHour = record.atHour
  if (typeof record.idleMinutes === "number") reset.idleMinutes = record.idleMinutes
  return Object.keys(reset).length > 0 ? reset : undefined
}

function normalizeSessionConfig(value: unknown): OpenClawSessionConfig {
  const record = asObject(value) || {}
  const resetByType = asObject(record.resetByType)
  const maintenance = asObject(record.maintenance)
  const session: OpenClawSessionConfig = {}

  if (record.scope === "per-sender" || record.scope === "global") session.scope = record.scope
  if (
    record.dmScope === "main" ||
    record.dmScope === "per-peer" ||
    record.dmScope === "per-channel-peer" ||
    record.dmScope === "per-account-channel-peer"
  ) {
    session.dmScope = record.dmScope
  }

  session.reset = normalizeReset(record.reset)

  const direct = normalizeReset(resetByType?.direct)
  const group = normalizeReset(resetByType?.group)
  const thread = normalizeReset(resetByType?.thread)
  if (direct || group || thread) {
    session.resetByType = {
      ...(direct ? { direct } : {}),
      ...(group ? { group } : {}),
      ...(thread ? { thread } : {}),
    }
  }

  if (maintenance) {
    const nextMaintenance: NonNullable<OpenClawSessionConfig["maintenance"]> = {}
    if (typeof maintenance.pruneAfter === "string" || typeof maintenance.pruneAfter === "number") {
      nextMaintenance.pruneAfter = maintenance.pruneAfter
    }
    if (typeof maintenance.maxEntries === "number") nextMaintenance.maxEntries = maintenance.maxEntries
    if (Object.keys(nextMaintenance).length > 0) session.maintenance = nextMaintenance
  }

  return session
}

function compactObject<T extends JsonObject>(value: T): T {
  for (const key of Object.keys(value)) {
    const child = value[key]
    if (child && typeof child === "object" && !Array.isArray(child)) {
      compactObject(child as JsonObject)
      if (Object.keys(child as JsonObject).length === 0) delete value[key]
    } else if (child === undefined || child === "") {
      delete value[key]
    }
  }
  return value
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function makeReplacementMergePatch(current: unknown, next: unknown): unknown {
  if (!isPlainObject(current) || !isPlainObject(next)) return next

  const patch: JsonObject = {}
  const keys = new Set([...Object.keys(current), ...Object.keys(next)])

  for (const key of keys) {
    if (!Object.hasOwn(next, key)) {
      patch[key] = null
      continue
    }

    const currentValue = current[key]
    const nextValue = next[key]
    patch[key] = makeReplacementMergePatch(currentValue, nextValue)
  }

  return patch
}

async function getConfigSnapshot() {
  const snapshot = asObject(await requestOpenClawGateway("config.get", {})) || {}
  const config = asObject(snapshot.config) || asObject(snapshot.resolved) || {}
  return {
    snapshot,
    config,
    hash: asString(snapshot.hash),
    exists: snapshot.exists !== false,
  }
}

function configViewFromConfig(config: JsonObject, restart?: unknown): OpenClawConfigView {
  const gateway = asObject(config.gateway) || {}
  const session = asObject(config.session) || {}

  return {
    connection: {
      url: resolveGatewayUrl(gateway),
      password: resolveGatewayPassword(gateway),
    },
    session: normalizeSessionConfig(session),
    ...(restart !== undefined ? { restart } : {}),
  }
}

export async function getOpenClawConfigView(): Promise<OpenClawConfigView> {
  const { config } = await getConfigSnapshot()
  return configViewFromConfig(config)
}

export async function saveOpenClawSessionConfig(
  session: OpenClawSessionConfig
): Promise<OpenClawConfigView> {
  const { config, hash, exists } = await getConfigSnapshot()
  if (exists && !hash) {
    throw new AppError("OpenClaw config hash unavailable; reload the config before saving.", 503)
  }
  const currentSession = asObject(config.session) || {}
  const nextSession = compactObject(structuredClone(session) as JsonObject)
  const patch = {
    session: makeReplacementMergePatch(currentSession, nextSession),
  }
  const patchParams = {
    raw: JSON.stringify(patch),
    ...(hash ? { baseHash: hash } : {}),
  }
  const result = asObject(await requestOpenClawGateway("config.patch", patchParams)) || {}
  const nextConfig = asObject(result.config) || (await getConfigSnapshot()).config
  return configViewFromConfig(nextConfig, result.restart)
}

export async function validateAndRestartOpenClaw() {
  const restart = await requestOpenClawGateway("gateway.restart.request", {
    reason: "CrabChat settings",
  })
  return {
    ok: true,
    result: restart,
  }
}
