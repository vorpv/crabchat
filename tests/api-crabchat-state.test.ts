import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/openclaw-gateway"
import { GET, PATCH } from "@/app/api/crabchat/state/route"

const storeMocks = vi.hoisted(() => ({
  getCrabChatState: vi.fn(),
  updateCrabChatState: vi.fn(),
}))

vi.mock("@/lib/crabchat-store", () => storeMocks)

describe("crabchat state API route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns current state", async () => {
    storeMocks.getCrabChatState.mockReturnValue({ pins: ["alpha"] })

    const response = await GET(new Request("http://localhost/api/crabchat/state"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ pins: ["alpha"] })
  })

  it("passes accepted patch fields to the store", async () => {
    storeMocks.updateCrabChatState.mockReturnValue({ pins: ["alpha"] })
    const body = {
      settings: { theme: "dark" },
      modelSelection: { model: "m" },
      pins: ["alpha"],
      features: { archiving: { enabled: false } },
      ignored: true,
    }

    const response = await PATCH(
      new Request("http://localhost/api/crabchat/state", {
        method: "PATCH",
        body: JSON.stringify(body),
      })
    )

    expect(response.status).toBe(200)
    expect(storeMocks.updateCrabChatState).toHaveBeenCalledWith({
      settings: body.settings,
      modelSelection: body.modelSelection,
      pins: body.pins,
      features: body.features,
    })
    expect(await response.json()).toEqual({ pins: ["alpha"] })
  })

  it("serializes AppError failures", async () => {
    storeMocks.getCrabChatState.mockImplementation(() => {
      throw new AppError("Missing gateway auth", 401, "missing_auth")
    })

    const response = await GET(new Request("http://localhost/api/crabchat/state"))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: "Missing gateway auth",
      code: "missing_auth",
    })
  })
})
