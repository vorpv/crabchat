// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  NEW_CHAT_ID,
  fetchHistory,
  fetchSessions,
  isMissingAuth,
  readJsonStorage,
  saveCrabChatState,
  sendChatMessage,
  writeJsonStorage,
} from "@/lib/client-api"

function mockFetch(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(payload),
  }
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))
  return response
}

describe("client api", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it("normalizes session and history dates from API payloads", async () => {
    mockFetch({
      sessions: [{ id: "raw", friendlyId: "friendly", title: "", pinned: false, updatedAt: "2025-01-02T00:00:00Z" }],
      defaults: { model: "openai/gpt-5" },
    })

    const sessions = await fetchSessions()

    expect(fetch).toHaveBeenCalledWith("/api/openclaw/sessions", expect.any(Object))
    expect(sessions.sessions[0]).toMatchObject({
      id: "friendly",
      title: "friendly",
    })
    expect(sessions.sessions[0].updatedAt).toBeInstanceOf(Date)

    mockFetch({
      messages: [{ id: "m", role: "user", content: "Hi", timestamp: 1_735_689_600 }],
    })

    await expect(fetchHistory("friendly")).resolves.toMatchObject([
      { id: "m", timestamp: new Date("2025-01-01T00:00:00.000Z") },
    ])
  })

  it("sends JSON patches and chat messages", async () => {
    mockFetch({ pins: ["alpha"] })
    await saveCrabChatState({ pins: ["alpha"] })

    expect(fetch).toHaveBeenCalledWith(
      "/api/crabchat/state",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ pins: ["alpha"] }),
      })
    )

    vi.stubGlobal("crypto", { randomUUID: () => "uuid" })
    mockFetch({ result: { ok: true } })
    await sendChatMessage({ sessionId: NEW_CHAT_ID, text: "Hi", attachments: [] })

    expect(fetch).toHaveBeenCalledWith(
      "/api/openclaw/send",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session: undefined,
          text: "Hi",
          attachments: [],
          idempotencyKey: "uuid",
        }),
      })
    )
  })

  it("throws API errors with status/code and detects missing auth", async () => {
    mockFetch({ error: "No token", code: "missing_auth" }, { ok: false, status: 401 })

    await expect(fetchSessions()).rejects.toMatchObject({
      message: "No token",
      status: 401,
      code: "missing_auth",
    })
    expect(isMissingAuth({ status: 401 })).toBe(true)
    expect(isMissingAuth({ code: "missing_auth" })).toBe(true)
  })

  it("reads and writes local JSON storage defensively", () => {
    writeJsonStorage("settings", { theme: "dark" })
    expect(readJsonStorage("settings", { theme: "system", compact: false })).toEqual({
      theme: "dark",
      compact: false,
    })

    localStorage.setItem("items", "{}")
    expect(readJsonStorage("items", ["fallback"])).toEqual(["fallback"])
  })
})
