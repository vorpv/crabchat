import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.CRABCHAT_STAGING_PORT || "3100")
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`
const crabChatHome =
  process.env.CRABCHAT_STAGING_HOME || "/tmp/outclaw-staging/crabchat-home"

export default defineConfig({
  testDir: "./tests/staging",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      CRABCHAT_HOME: crabChatHome,
    },
  },
})
