import { existsSync, readdirSync, readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getCrabChatPaths } from "@/lib/crabchat-home"
import {
  createCrabChatSession,
  deleteCrabChatSession,
  getCrabChatState,
  loadCrabChatHistory,
  patchCrabChatSession,
  sendCrabChatMessage,
  syncCrabChatSessions,
  updateCrabChatState,
} from "@/lib/crabchat-store"
import type { Message, Session } from "@/lib/types"
import { useTempCrabChatHome } from "./test-utils"

const gatewayMocks = vi.hoisted(() => {
  class MockAppError extends Error {
    status: number
    code?: string

    constructor(message: string, status = 500, code?: string) {
      super(message)
      this.status = status
      this.code = code
    }
  }

  return {
    AppError: MockAppError,
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn(),
    loadHistory: vi.fn(),
    patchSession: vi.fn(),
    sendMessage: vi.fn(),
  }
})

vi.mock("@/lib/openclaw-gateway", () => gatewayMocks)

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "alpha",
    key: "agent:test:alpha",
    friendlyId: "alpha",
    title: "Alpha",
    pinned: false,
    updatedAt: new Date("2025-01-02T00:00:00Z"),
    ...overrides,
  }
}

function messages(): Message[] {
  return [
    {
      id: "m1",
      role: "user",
      content: "Hello",
      timestamp: new Date("2025-01-02T00:00:00Z"),
    },
  ]
}

describe("crabchat store", () => {
  useTempCrabChatHome()

  beforeEach(() => {
    vi.clearAllMocks()
    gatewayMocks.listSessions.mockResolvedValue({ sessions: [], defaults: {} })
  })

  it("initializes state files with defaults and persists state patches", () => {
    expect(getCrabChatState()).toMatchObject({
      settings: {
        theme: "system",
        displayChangesSummary: true,
        displayTokenUsage: false,
      },
      modelSelection: {
        model: "",
        reasoningLevel: "medium",
      },
      pins: [],
      features: {
        archiving: { enabled: true },
      },
    })

    const updated = updateCrabChatState({
      settings: {
        theme: "dark",
        displayChangesSummary: false,
        displayTokenUsage: true,
      },
      modelSelection: {
        model: "openai/gpt-5",
        reasoningLevel: "high",
      },
      pins: ["alpha"],
      features: {
        archiving: { enabled: false },
      },
    })

    expect(updated).toMatchObject({
      settings: { theme: "dark" },
      modelSelection: { model: "openai/gpt-5", reasoningLevel: "high" },
      pins: ["alpha"],
      features: { archiving: { enabled: false } },
    })
  })

  it("archives local sessions missing from OpenClaw when archiving is enabled", async () => {
    gatewayMocks.createSession.mockResolvedValue(session())
    await createCrabChatSession("Alpha")

    gatewayMocks.listSessions.mockResolvedValue({ sessions: [], defaults: {} })
    await syncCrabChatSessions()

    const paths = getCrabChatPaths()
    expect(readdirSync(paths.sessions).filter((file) => file.endsWith(".json"))).toEqual([])
    expect(readdirSync(paths.archive)).toEqual(["alpha.json"])
    expect(JSON.parse(readFileSync(`${paths.archive}/alpha.json`, "utf8"))).toMatchObject({
      archived: true,
      session: {
        archived: true,
        runtimeStatus: "archived",
        hasActiveRun: false,
      },
    })
  })

  it("keeps missing local sessions active when archiving is disabled", async () => {
    updateCrabChatState({ features: { archiving: { enabled: false } } })
    gatewayMocks.createSession.mockResolvedValue(session())
    await createCrabChatSession("Alpha")

    await syncCrabChatSessions()

    const paths = getCrabChatPaths()
    expect(existsSync(`${paths.sessions}/alpha.json`)).toBe(true)
    expect(readdirSync(paths.archive)).toEqual([])
  })

  it("loads archived history from the local snapshot and blocks writes", async () => {
    gatewayMocks.createSession.mockResolvedValue(session())
    gatewayMocks.loadHistory.mockResolvedValue(messages())
    await createCrabChatSession("Alpha")
    await loadCrabChatHistory("alpha")

    gatewayMocks.listSessions.mockResolvedValue({ sessions: [], defaults: {} })
    await syncCrabChatSessions()
    gatewayMocks.loadHistory.mockClear()

    await expect(loadCrabChatHistory("alpha")).resolves.toEqual(messages())
    expect(gatewayMocks.loadHistory).not.toHaveBeenCalled()
    await expect(patchCrabChatSession("alpha", { label: "New" })).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      sendCrabChatMessage({ session: "alpha", text: "Nope", idempotencyKey: "k" })
    ).rejects.toMatchObject({ status: 409 })
  })

  it("deletes archived sessions locally without calling OpenClaw", async () => {
    gatewayMocks.createSession.mockResolvedValue(session())
    await createCrabChatSession("Alpha")
    await syncCrabChatSessions()

    await deleteCrabChatSession("alpha")

    expect(gatewayMocks.deleteSession).not.toHaveBeenCalled()
    expect(existsSync(`${getCrabChatPaths().archive}/alpha.json`)).toBe(false)
  })
})
