import { writeFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultCrabChatConfig, getCrabChatPaths, writeCrabChatConfig } from "@/lib/crabchat-home"
import {
  AppError,
  createSession,
  getSessionActivitySnapshot,
  getUsageStatus,
  listAgents,
  listConfiguredModels,
  listSessions,
  loadHistory,
  patchSession,
  pingGateway,
  sendMessage,
  subscribeSessionActivity,
  toErrorResponse,
} from "@/lib/openclaw-gateway"
import { useTempCrabChatHome } from "./test-utils"

type GatewayFrame = Record<string, unknown>
type ServerSocket = {
  send: (data: string) => void
}
type GatewayHandler = (params: unknown, frame: GatewayFrame, socket: ServerSocket) => unknown

const wsMock = vi.hoisted(() => {
  type Listener = (...args: any[]) => void
  type Frame = Record<string, unknown>
  type Socket = {
    send: (data: string) => void
  }
  type Handler = (params: unknown, frame: Frame, socket: Socket) => unknown

  function record(value: unknown): Frame {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Frame)
      : {}
  }

  class MockWebSocket {
    private listeners = new Map<string, Set<Listener>>()

    constructor(public url: string) {
      queueMicrotask(() => {
        this.emit("open")
        this.emit("message", JSON.stringify({ type: "challenge", nonce: "test-nonce" }))
      })
    }

    on(event: string, listener: Listener) {
      const listeners = this.listeners.get(event) || new Set<Listener>()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    once(event: string, listener: Listener) {
      const onceListener: Listener = (...args) => {
        this.off(event, onceListener)
        listener(...args)
      }
      return this.on(event, onceListener)
    }

    off(event: string, listener: Listener) {
      this.listeners.get(event)?.delete(listener)
      return this
    }

    send(raw: string) {
      const frame = record(JSON.parse(raw))
      const id = typeof frame.id === "string" ? frame.id : undefined
      const method = typeof frame.method === "string" ? frame.method : ""
      const params = frame.params

      wsMock.requests.push({ method, params })

      const serverSocket: Socket = {
        send: (data) => this.emit("message", data),
      }

      if (method === "connect") {
        const auth = record(record(params).auth)
        if (auth.token !== "test-token") {
          this.emit(
            "message",
            JSON.stringify({
              id,
              ok: false,
              error: {
                message: "Unauthorized",
                code: "UNAUTHORIZED",
                details: { code: "UNAUTHORIZED" },
              },
            })
          )
          return
        }
        this.emit("message", JSON.stringify({ id, ok: true, payload: { connected: true } }))
        return
      }

      const handler = wsMock.handlers[method]
      if (!handler) {
        this.emit(
          "message",
          JSON.stringify({
            id,
            ok: false,
            error: {
              message: `Unhandled method: ${method}`,
              code: "UNHANDLED",
              details: { code: "UNHANDLED" },
            },
          })
        )
        return
      }

      try {
        this.emit(
          "message",
          JSON.stringify({ id, ok: true, payload: handler(params, frame, serverSocket) })
        )
      } catch (error) {
        this.emit(
          "message",
          JSON.stringify({
            id,
            ok: false,
            error: {
              message: error instanceof Error ? error.message : "Gateway request failed",
              code: "TEST_ERROR",
              details: { code: "TEST_ERROR" },
            },
          })
        )
      }
    }

    close() {
      this.emit("close", 1000, Buffer.from(""))
    }

    private emit(event: string, ...args: unknown[]) {
      for (const listener of [...(this.listeners.get(event) || [])]) {
        listener(...args)
      }
    }
  }

  return {
    handlers: {} as Record<string, Handler>,
    requests: [] as Array<{ method: string; params: unknown }>,
    MockWebSocket,
    reset() {
      this.handlers = {}
      this.requests = []
    },
    setHandlers(handlers: Record<string, Handler>) {
      this.handlers = handlers
    },
  }
})

vi.mock("ws", () => ({
  default: wsMock.MockWebSocket,
}))

function asRecord(value: unknown): GatewayFrame {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as GatewayFrame)
    : {}
}

async function startGatewayHarness(handlers: Record<string, GatewayHandler>) {
  wsMock.setHandlers(handlers)
  return {
    requests: wsMock.requests,
    url: "ws://127.0.0.1:18789",
    close: async () => undefined,
  }
}

function configureGateway(url: string, token = "test-token") {
  writeCrabChatConfig({
    ...defaultCrabChatConfig(),
    openclaw: {
      gatewayUrl: url,
      token,
    },
  })
}

describe("openclaw gateway", () => {
  useTempCrabChatHome()
  let cleanup: Array<() => Promise<void>> = []

  beforeEach(() => {
    vi.useRealTimers()
    wsMock.reset()
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("crabchat.sessionListCache")]
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("crabchat.gatewayQueue.v2")]
  })

  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) {
      await close()
    }
  })

  it("performs the challenge/connect handshake before reporting gateway health", async () => {
    const harness = await startGatewayHarness({})
    cleanup.push(harness.close)
    configureGateway(harness.url)

    await expect(pingGateway()).resolves.toEqual({ ok: true })

    expect(harness.requests[0]).toMatchObject({
      method: "connect",
      params: {
        auth: { token: "test-token" },
        minProtocol: 4,
        maxProtocol: 4,
      },
    })
  })

  it("normalizes sessions, agents, models, and usage payloads", async () => {
    const harness = await startGatewayHarness({
      "sessions.list": () => ({
        sessions: [
          {
            key: "agent:coder:session-key",
            friendly_id: "friendly",
            label: "Coder",
            agentRuntime: { name: "Runtime agent" },
            workspace: { root: "/tmp/project" },
            status: "running",
            hasActiveRun: true,
            modelProvider: "openai",
            model: "gpt-5",
            thinkingLevels: [{ id: "high", label: "High" }],
            input_tokens: "10",
            outputTokens: 5,
            used_context_tokens: 100,
            context_tokens: "1000",
            totalTokensFresh: true,
            updated_at: "2025-01-02T00:00:00Z",
            last_message: "Last text",
          },
        ],
        defaults: {
          defaultAgentId: "coder",
          mainKey: "main",
          modelProvider: "openai",
          model: "gpt-5",
          thinkingOptions: ["low", "high"],
          thinkingDefault: "high",
        },
      }),
      "agents.list": () => ({
        agents: [
          {
            id: "coder",
            name: "Coder",
            description: "Writes code",
            model: { primary: "openai/gpt-5", fallbacks: ["openai/gpt-5-mini"] },
          },
        ],
      }),
      "models.list": () => ({
        models: [
          {
            id: "gpt-5",
            provider: "openai",
            alias: "GPT-5",
            default: true,
            context_window: "128000",
          },
        ],
      }),
      "usage.status": () => ({
        updated_at: "42",
        providers: [
          {
            provider: "openai",
            displayName: "OpenAI",
            plan: "pro",
            windows: [{ label: "day", used_percent: "25", reset_at: "100" }],
          },
        ],
      }),
    })
    cleanup.push(harness.close)
    configureGateway(harness.url)

    await expect(listSessions()).resolves.toMatchObject({
      sessions: [
        {
          id: "friendly",
          key: "agent:coder:session-key",
          friendlyId: "friendly",
          title: "Coder",
          agentId: "coder",
          agentName: "Runtime agent",
          workspaceRoot: "/tmp/project",
          runtimeStatus: "running",
          hasActiveRun: true,
          modelProvider: "openai",
          model: "gpt-5",
          inputTokens: 10,
          outputTokens: 5,
          contextTokens: 100,
          contextCapacityTokens: 1000,
          totalTokensFresh: true,
          lastMessage: "Last text",
        },
      ],
      defaults: {
        defaultAgentId: "coder",
        mainKey: "main",
        modelProvider: "openai",
        model: "gpt-5",
        thinkingOptions: ["low", "high"],
        thinkingDefault: "high",
      },
    })
    await expect(listAgents()).resolves.toEqual([
      {
        id: "coder",
        name: "Coder",
        description: "Writes code",
        model: { primary: "openai/gpt-5", fallbacks: ["openai/gpt-5-mini"] },
      },
    ])
    await expect(listConfiguredModels()).resolves.toEqual([
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        provider: "openai",
        isDefault: true,
        contextWindow: 128000,
      },
    ])
    await expect(getUsageStatus()).resolves.toEqual({
      updatedAt: 42,
      providers: [
        {
          provider: "openai",
          displayName: "OpenAI",
          plan: "pro",
          windows: [{ label: "day", usedPercent: 25, resetAt: 100 }],
        },
      ],
    })
  })

  it("creates and patches sessions through resolved OpenClaw keys", async () => {
    const harness = await startGatewayHarness({
      "sessions.create": (params) => ({
        session: {
          key: "agent:coder:new-session",
          friendlyId: "new-session",
          label: asRecord(params).label,
          agentRuntime: { name: "Coder" },
        },
      }),
      "sessions.resolve": (params) => ({
        key: asRecord(params).key === "new-session" ? "agent:coder:new-session" : asRecord(params).key,
      }),
      "sessions.patch": (params) => ({
        session: {
          key: asRecord(params).key,
          friendlyId: "new-session",
          label: asRecord(params).label,
          model: asRecord(params).model,
          thinkingLevel: asRecord(params).thinkingLevel,
        },
      }),
    })
    cleanup.push(harness.close)
    configureGateway(harness.url)

    await expect(createSession("New Session", "coder")).resolves.toMatchObject({
      id: "new-session",
      key: "agent:coder:new-session",
      title: "New Session",
      agentId: "coder",
    })
    await expect(
      patchSession("new-session", {
        label: "Renamed",
        model: "openai/gpt-5",
        thinkingLevel: "high",
      })
    ).resolves.toMatchObject({
      key: "agent:coder:new-session",
      title: "Renamed",
      model: "openai/gpt-5",
      thinkingLevel: "high",
    })

    expect(harness.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "sessions.create",
          params: expect.objectContaining({ label: "New Session", agentId: "coder" }),
        }),
        expect.objectContaining({
          method: "sessions.patch",
          params: expect.objectContaining({
            key: "agent:coder:new-session",
            label: "Renamed",
            model: "openai/gpt-5",
            thinkingLevel: "high",
          }),
        }),
      ])
    )
  })

  it("normalizes history messages, tool calls, attachments, reasoning, and usage", async () => {
    const harness = await startGatewayHarness({
      "sessions.resolve": () => ({ key: "agent:coder:alpha" }),
      "chat.history": () => ({
        messages: [
          {
            id: "u1",
            role: "user",
            text: "Hello",
            timestamp: 1_735_689_600,
            attachments: [{ name: "input.txt", type: "text/plain", size: 4, url: "/file" }],
          },
          {
            id: "a1",
            role: "assistant",
            content: [
              { type: "thinking", text: "Planning" },
              { type: "text", text: "Answer" },
              { type: "tool_call", id: "call-1", name: "shell", input: { cmd: "pwd" } },
            ],
            usage: {
              input_tokens: "11",
              outputTokens: 7,
              total: "18",
              context_capacity_tokens: "1000",
              context_usage_percent: "1.8",
              provider: "openai",
              model: "gpt-5",
              reasoningLevel: "high",
            },
            created_at: "2025-01-02T00:00:00Z",
          },
          {
            id: "t1",
            role: "toolResult",
            content: [
              {
                type: "tool_result",
                toolCallId: "call-1",
                name: "shell",
                output: "{\"status\":\"failed\",\"error\":\"boom\"}",
              },
            ],
          },
        ],
      }),
    })
    cleanup.push(harness.close)
    configureGateway(harness.url)

    await expect(loadHistory("alpha", 20)).resolves.toMatchObject([
      {
        id: "u1",
        role: "user",
        content: "Hello",
        attachments: [{ name: "input.txt", type: "text/plain", size: 4, url: "/file" }],
      },
      {
        id: "a1",
        role: "assistant",
        content: "Answer",
        reasoning: "Planning",
        toolCalls: [
          {
            id: "call-1",
            name: "shell",
            input: { cmd: "pwd" },
            status: "error",
            error: "boom",
          },
        ],
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          totalTokens: 18,
          contextCapacityTokens: 1000,
          contextUsagePercent: 1.8,
          modelProvider: "openai",
          model: "gpt-5",
          reasoningLevel: "high",
        },
      },
    ])
  })

  it("resolves friendly session ids before sending messages", async () => {
    const harness = await startGatewayHarness({
      "sessions.resolve": () => ({ key: "agent:coder:alpha" }),
      "chat.send": (params) => ({ accepted: true, params }),
    })
    cleanup.push(harness.close)
    configureGateway(harness.url)

    await expect(
      sendMessage({
        session: "alpha",
        text: "Hello",
        attachments: [{ name: "a.txt", type: "text/plain", size: 1 }],
        idempotencyKey: "idem",
      })
    ).resolves.toMatchObject({
      accepted: true,
      params: {
        sessionKey: "agent:coder:alpha",
        message: "Hello",
        deliver: true,
        timeoutMs: 120_000,
        idempotencyKey: "idem",
      },
    })
  })

  it("derives activity snapshots and subscription updates from gateway state/events", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123)
    const harness = await startGatewayHarness({
      "sessions.resolve": () => ({ key: "agent:coder:alpha" }),
      "sessions.list": () => ({
        sessions: [
          {
            key: "agent:coder:alpha",
            friendlyId: "alpha",
            label: "Alpha",
            status: "running",
            hasActiveRun: true,
          },
        ],
      }),
      "sessions.subscribe": (_params, _frame, socket) => {
        queueMicrotask(() => {
          socket.send(
            JSON.stringify({
              type: "event",
              event: "session.tool",
              payload: {
                sessionKey: "agent:coder:alpha",
                phase: "start",
                toolName: "shell_exec",
              },
            })
          )
        })
        return { ok: true }
      },
    })
    cleanup.push(harness.close)
    configureGateway(harness.url)

    await expect(listSessions()).resolves.toMatchObject({
      sessions: [
        {
          id: "alpha",
          key: "agent:coder:alpha",
          runtimeStatus: "running",
          hasActiveRun: true,
        },
      ],
    })
    await expect(getSessionActivitySnapshot("alpha")).resolves.toEqual({
      kind: "thinking",
      label: "Thinking",
      active: true,
      sessionKey: "agent:coder:alpha",
      updatedAt: 123,
    })

    const controller = new AbortController()
    const activities: unknown[] = []
    await subscribeSessionActivity("alpha", {
      signal: controller.signal,
      onActivity: (activity) => {
        activities.push(activity)
        if (activities.length === 2) controller.abort()
      },
    })

    expect(activities).toEqual([
      {
        kind: "thinking",
        label: "Thinking",
        active: true,
        sessionKey: "agent:coder:alpha",
        updatedAt: 123,
      },
      {
        kind: "tool",
        label: "Running Shell Exec",
        detail: "shell_exec",
        active: true,
        sessionKey: "agent:coder:alpha",
        updatedAt: 123,
      },
    ])
  })

  it("maps auth failures and missing config to AppError responses", async () => {
    const harness = await startGatewayHarness({})
    cleanup.push(harness.close)
    configureGateway(harness.url, "bad-token")

    await expect(pingGateway()).rejects.toMatchObject({
      message: "Unauthorized",
      status: 401,
      code: "UNAUTHORIZED",
    })

    writeFileSync(
      getCrabChatPaths().config,
      JSON.stringify({ openclaw: { gatewayUrl: harness.url }, ui: defaultCrabChatConfig().ui })
    )

    await expect(pingGateway()).rejects.toMatchObject({
      status: 401,
      code: "missing_auth",
    })

    const response = toErrorResponse(new AppError("No token", 401, "missing_auth"), {
      method: "GET",
      path: "/api/openclaw/status",
    })
    await expect(response.json()).resolves.toEqual({
      error: "No token",
      code: "missing_auth",
    })
    expect(response.status).toBe(401)
  })
})
