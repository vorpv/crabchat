import { expect, test } from "@playwright/test"

test("CrabChat connects to the Dockerized OpenClaw gateway", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByText("CrabChat")).toBeVisible()
  await expect(page.getByRole("dialog", { name: "Connect to the gateway" })).toHaveCount(0)
  await expect(page.getByPlaceholder("Type a message...")).toBeEnabled()
})
