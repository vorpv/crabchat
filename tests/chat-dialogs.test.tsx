// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DeleteDialog } from "@/components/chat/delete-dialog"
import { RenameDialog } from "@/components/chat/rename-dialog"

describe("chat dialogs", () => {
  afterEach(() => {
    cleanup()
  })

  it("submits a trimmed session title and disables empty titles", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <RenameDialog
        open
        onOpenChange={onOpenChange}
        currentTitle="Original title"
        onConfirm={onConfirm}
      />
    )

    expect(screen.getByRole("heading", { name: "Rename session" })).toBeInTheDocument()
    const input = screen.getByPlaceholderText("Session title")
    const save = screen.getByRole("button", { name: "Save" })

    await user.clear(input)
    expect(save).toBeDisabled()

    await user.type(input, "  New title  ")
    await user.click(save)

    expect(onConfirm).toHaveBeenCalledWith("New title")
  })

  it("reports cancel and confirm actions from the delete dialog", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(<DeleteDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />)

    expect(screen.getByRole("alertdialog", { name: "Delete session" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.any(Object))

    await user.click(screen.getByRole("button", { name: "Delete" }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
