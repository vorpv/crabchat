import { expect, test, type Page } from "@playwright/test"

const uniqueText = (prefix: string) =>
  `${prefix} ${new Date().toISOString()} ${Math.random().toString(36).slice(2)}`

async function openCrabChat(page: Page) {
  await page.goto("/")

  await expect(page.getByText("CrabChat")).toBeVisible()
  await expect(page.getByRole("dialog", { name: "Connect to the gateway" })).toHaveCount(0)
  await expect(page.getByPlaceholder("Type a message...")).toBeEnabled()
}

test("CrabChat connects to the Dockerized OpenClaw gateway", async ({ page }) => {
  await openCrabChat(page)
})

test("creates a new chat draft from the sidebar", async ({ page }) => {
  await routeChatFixture(page)
  await openCrabChat(page)

  await page.locator('button[aria-label="New session"]').click()

  const agentMenuItems = page.getByRole("menuitem")
  if ((await agentMenuItems.count()) > 0) {
    await agentMenuItems.first().click()
  }

  await expect(page.getByRole("heading", { name: "New conversation" })).toBeVisible()
  await expect(page.getByPlaceholder("Type a message...")).toBeEnabled()
})

test("sends a message in a new chat and renders the assistant response", async ({ page }) => {
  await routeChatFixture(page)
  await openCrabChat(page)

  const message = uniqueText("Staging message")
  await page.getByPlaceholder("Type a message...").fill(message)
  await page.getByRole("button", { name: "Send message" }).click()

  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await expect(page.getByText(/Mock OpenAI response/i)).toBeVisible({
    timeout: 120_000,
  })
})

async function routeChatFixture(page: Page) {
  const now = new Date().toISOString()
  const agent = { id: "coder", name: "Coder" }
  const model = { id: "gpt-5-staging-mock", name: "gpt-5-staging-mock" }
  const session = {
    id: "staging-chat",
    key: "agent:coder:staging-chat",
    title: "Staging chat",
    pinned: false,
    agentId: agent.id,
    agentName: agent.name,
    updatedAt: now,
    createdAt: now,
  }
  let messages: Array<Record<string, unknown>> = []

  await page.route("**/api/openclaw/status", (route) =>
    route.fulfill({ json: { ok: true } })
  )
  await page.route("**/api/openclaw/sessions", async (route) => {
    const method = route.request().method()
    if (method === "GET") {
      return route.fulfill({
        json: {
          sessions: [],
          defaults: {
            defaultAgentId: agent.id,
            model: model.id,
          },
        },
      })
    }
    if (method === "POST") {
      return route.fulfill({ json: { session } })
    }
    if (method === "PATCH") {
      return route.fulfill({ json: { session } })
    }
    return route.fulfill({ json: { ok: true } })
  })
  await page.route("**/api/openclaw/agents", (route) =>
    route.fulfill({ json: { agents: [agent] } })
  )
  await page.route("**/api/openclaw/models", (route) =>
    route.fulfill({ json: { models: [model] } })
  )
  await page.route("**/api/openclaw/usage", (route) =>
    route.fulfill({ json: { providers: [] } })
  )
  await page.route("**/api/openclaw/send", async (route) => {
    const body = await route.request().postDataJSON()
    const content = String(body.text || "")
    messages = [
      {
        id: "message-user",
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      },
      {
        id: "message-assistant",
        role: "assistant",
        content: `Mock OpenAI response: ${content}`,
        timestamp: new Date().toISOString(),
      },
    ]
    return route.fulfill({ json: { result: { ok: true } } })
  })
  await page.route("**/api/openclaw/history?*", (route) =>
    route.fulfill({ json: { messages } })
  )
  await routeCrabChatState(page)
}

test("opens execution details from a changes summary", async ({ page }) => {
  await routeSummaryFixture(page)
  await page.goto("/")

  await expect(page.getByText("CrabChat")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Summary fixture" })).toBeVisible()

  await expect(page.getByText("Changes summary")).toBeVisible()
  await expect(page.getByText("Created file README.staging.md").first()).toBeVisible()

  await page.getByRole("button", { name: "More" }).last().click()
  await page.getByRole("menuitem", { name: "Show details" }).click()

  await expect(page.getByText("Execution details")).toBeVisible()
  await expect(page.getByText("Created file README.staging.md").last()).toBeVisible()
})

async function routeSummaryFixture(page: Page) {
  const now = new Date().toISOString()
  const session = {
    id: "summary-fixture",
    key: "agent:coder:summary-fixture",
    title: "Summary fixture",
    pinned: false,
    agentId: "coder",
    agentName: "Coder",
    updatedAt: now,
    createdAt: now,
  }

  const messages = [
    {
      id: "summary-user",
      role: "user",
      content: "Create a staging README",
      timestamp: now,
    },
    {
      id: "summary-assistant",
      role: "assistant",
      content: "Created a staging README.",
      timestamp: now,
      toolCalls: [
        {
          id: "patch-1",
          name: "apply_patch",
          status: "success",
          input: {
            changes: [
              {
                path: "README.staging.md",
                kind: {
                  type: "add",
                },
              },
            ],
          },
          output: "Success. Updated files:\nA README.staging.md",
        },
      ],
    },
  ]

  await page.route("**/api/openclaw/status", (route) =>
    route.fulfill({ json: { ok: true } })
  )
  await page.route("**/api/openclaw/sessions", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: {
          sessions: [session],
          defaults: {
            defaultAgentId: "coder",
            model: "gpt-5-staging-mock",
          },
        },
      })
    }
    return route.fallback()
  })
  await page.route("**/api/openclaw/agents", (route) =>
    route.fulfill({ json: { agents: [{ id: "coder", name: "Coder" }] } })
  )
  await page.route("**/api/openclaw/models", (route) =>
    route.fulfill({
      json: {
        models: [{ id: "gpt-5-staging-mock", name: "gpt-5-staging-mock" }],
      },
    })
  )
  await page.route("**/api/openclaw/usage", (route) =>
    route.fulfill({ json: { providers: [] } })
  )
  await page.route("**/api/openclaw/history?*", (route) =>
    route.fulfill({ json: { messages } })
  )
  await routeCrabChatState(page)
}

async function routeCrabChatState(page: Page) {
  const crabChatState = {
    settings: {
      theme: "system",
      displayChangesSummary: true,
      displayTokenUsage: false,
    },
    modelSelection: {
      model: "gpt-5-staging-mock",
      reasoningLevel: "medium",
    },
    pins: [],
    features: {
      archiving: { enabled: true },
      notes: {
        enabled: true,
        autoSavePrompts: true,
        manualPromptSaving: false,
        useMonospaceFont: false,
        storagePath: "",
      },
    },
  }

  await page.route("**/api/crabchat/state", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: crabChatState,
      })
    }
    return route.fulfill({
      json: crabChatState,
    })
  })
}
