import { mkdirSync, rmSync, writeFileSync } from "node:fs"

const home = process.env.CRABCHAT_STAGING_HOME || "/tmp/outclaw-staging/crabchat-home"
const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789"
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
