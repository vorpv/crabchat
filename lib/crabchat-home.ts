import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"

export interface CrabChatConfigFile {
  openclaw: {
    gatewayUrl?: string
    token?: string
    password?: string
  }
  ui: {
    settings: {
      theme: "system" | "light" | "dark"
      displayChangesSummary: boolean
      displayTokenUsage: boolean
    }
    modelSelection: {
      model: string
      reasoningLevel: string
    }
  }
}

export function getCrabChatHome() {
  return process.env.CRABCHAT_HOME || `${homedir()}/.crabchat`
}

export function getCrabChatPaths() {
  const home = getCrabChatHome()
  return {
    home,
    config: `${home}/crabchat.json`,
    pins: `${home}/pins.json`,
    features: `${home}/features.json`,
    notes: `${home}/notes`,
    sessions: `${home}/sessions`,
    archive: `${home}/sessions/archive`,
  }
}

export function defaultCrabChatConfig(): CrabChatConfigFile {
  return {
    openclaw: {
      gatewayUrl: "ws://127.0.0.1:18789",
    },
    ui: {
      settings: {
        theme: "system",
        displayChangesSummary: true,
        displayTokenUsage: false,
      },
      modelSelection: {
        model: "",
        reasoningLevel: "medium",
      },
    },
  }
}

export function readCrabChatConfig() {
  const paths = getCrabChatPaths()
  mkdirSync(paths.home, { recursive: true })
  if (!existsSync(paths.config)) {
    writeCrabChatConfig(defaultCrabChatConfig())
  }

  try {
    return {
      ...defaultCrabChatConfig(),
      ...JSON.parse(readFileSync(paths.config, "utf8")),
    } as CrabChatConfigFile
  } catch {
    return defaultCrabChatConfig()
  }
}

export function writeCrabChatConfig(config: CrabChatConfigFile) {
  const paths = getCrabChatPaths()
  mkdirSync(paths.home, { recursive: true })
  writeFileSync(paths.config, `${JSON.stringify(config, null, 2)}\n`)
}

export function getOpenClawConnectionConfig() {
  const config = readCrabChatConfig()
  return {
    gatewayUrl: config.openclaw.gatewayUrl || "ws://127.0.0.1:18789",
    token: config.openclaw.token,
    password: config.openclaw.password,
  }
}
