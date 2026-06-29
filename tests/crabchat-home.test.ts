import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  defaultCrabChatConfig,
  getCrabChatHome,
  getCrabChatPaths,
  readCrabChatConfig,
  writeCrabChatConfig,
} from "@/lib/crabchat-home"
import { useTempCrabChatHome } from "./test-utils"

describe("crabchat home persistence", () => {
  const getHome = useTempCrabChatHome()

  it("resolves paths from CRABCHAT_HOME", () => {
    expect(getCrabChatHome()).toBe(getHome())
    expect(getCrabChatPaths()).toMatchObject({
      home: getHome(),
      config: `${getHome()}/crabchat.json`,
      pins: `${getHome()}/pins.json`,
      features: `${getHome()}/features.json`,
      notes: `${getHome()}/notes`,
      sessions: `${getHome()}/sessions`,
      archive: `${getHome()}/sessions/archive`,
    })
  })

  it("creates a default config when the config file is missing", () => {
    const config = readCrabChatConfig()

    expect(config).toEqual(defaultCrabChatConfig())
    expect(existsSync(`${getHome()}/crabchat.json`)).toBe(true)
  })

  it("falls back to defaults when the config file is malformed", () => {
    mkdirSync(getHome(), { recursive: true })
    writeFileSync(`${getHome()}/crabchat.json`, "{ nope")

    expect(readCrabChatConfig()).toEqual(defaultCrabChatConfig())
  })

  it("writes config as stable JSON", () => {
    const config = defaultCrabChatConfig()
    config.openclaw.token = "test-token"
    config.ui.settings.theme = "dark"

    writeCrabChatConfig(config)

    expect(JSON.parse(readFileSync(`${getHome()}/crabchat.json`, "utf8"))).toEqual(config)
  })
})
