import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

function loadStagingEnv() {
  const path = new URL("./.env", import.meta.url)
  if (!existsSync(path)) return

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const separator = trimmed.indexOf("=")
    if (separator < 0) continue

    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, "")
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

loadStagingEnv()

const home = process.env.CRABCHAT_STAGING_HOME || "/tmp/outclaw-staging/crabchat-home"
const gatewayPort = process.env.OPENCLAW_GATEWAY_PORT || "18789"
const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || `ws://127.0.0.1:${gatewayPort}`
const token = process.env.OPENCLAW_GATEWAY_TOKEN || "test-token"

if (!process.env.CRABCHAT_STAGING_KEEP_HOME) {
  rmSync(home, { recursive: true, force: true })
}

mkdirSync(home, { recursive: true })

writeFileSync(
  `${home}/crabchat.json`,
  `${JSON.stringify(
    {
      openclaw: {
        gatewayUrl,
        token,
      },
      ui: {
        settings: {
          theme: "system",
          displayChangesSummary: true,
          displayTokenUsage: true,
        },
        modelSelection: {
          model: "",
          reasoningLevel: "medium",
        },
      },
    },
    null,
    2
  )}\n`
)

writeFileSync(
  `${home}/features.json`,
  `${JSON.stringify(
    {
      archiving: {
        enabled: true,
      },
      notes: {
        enabled: true,
        autoSavePrompts: true,
        manualPromptSaving: false,
        useMonospaceFont: false,
        storagePath: "",
      },
    },
    null,
    2
  )}\n`
)

console.log(`Prepared CRABCHAT_HOME at ${home}`)
console.log(`Configured OpenClaw gateway ${gatewayUrl}`)
