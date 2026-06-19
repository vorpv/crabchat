import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { getOpenClawConnectionConfig } from "@/lib/crabchat-home"
import { AppError } from "@/lib/openclaw-gateway"

const execFileAsync = promisify(execFile)

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
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function parseJsonOutput(stdout: string, fallback: JsonObject = {}) {
  const trimmed = stdout.trim()
  if (!trimmed) return fallback
  try {
    return JSON.parse(trimmed) as JsonObject
  } catch (error) {
    throw new AppError(`OpenClaw returned invalid JSON: ${String(error)}`, 500)
  }
}

async function runOpenClaw(args: string[]) {
  try {
    const result = await execFileAsync("openclaw", args, {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    })
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    }
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string }
    throw new AppError(err.stderr || err.stdout || err.message || "OpenClaw command failed.", 500)
  }
}

function runOpenClawWithInput(args: string[], input: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("openclaw", args, {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new AppError("OpenClaw command timed out.", 500))
    }, 120_000)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      clearTimeout(timeout)
      reject(new AppError(error.message, 500))
    })
    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new AppError(stderr || stdout || `OpenClaw exited with code ${code}.`, 500))
    })

    child.stdin.end(input)
  })
}

async function getConfigNode(path: string) {
  const result = await runOpenClaw(["config", "get", path, "--json"]).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("Config path not found")) return { stdout: "{}" }
    throw error
  })
  return parseJsonOutput(result.stdout)
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

export async function getOpenClawConfigView(): Promise<OpenClawConfigView> {
  const [gateway, session] = await Promise.all([
    getConfigNode("gateway"),
    getConfigNode("session"),
  ])

  return {
    connection: {
      url: resolveGatewayUrl(gateway),
      password: resolveGatewayPassword(gateway),
    },
    session: normalizeSessionConfig(session),
  }
}

export async function saveOpenClawSessionConfig(
  session: OpenClawSessionConfig
): Promise<OpenClawConfigView> {
  const patch = {
    session: compactObject(structuredClone(session) as JsonObject),
  }
  await runOpenClawWithInput(
    ["config", "patch", "--stdin", "--replace-path", "session"],
    JSON.stringify(patch)
  )
  return getOpenClawConfigView()
}

export async function validateAndRestartOpenClaw() {
  await runOpenClaw(["config", "validate", "--json"])
  const restart = await runOpenClaw(["gateway", "restart", "--safe", "--json"])
  return {
    ok: true,
    stdout: restart.stdout,
    stderr: restart.stderr,
  }
}
