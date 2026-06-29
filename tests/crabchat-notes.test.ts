import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  deleteNote,
  listNotes,
  saveNote,
  validateNotesStoragePath,
} from "@/lib/crabchat-notes"
import { getCrabChatPaths } from "@/lib/crabchat-home"
import { getCrabChatState, updateCrabChatState } from "@/lib/crabchat-store"
import { useTempCrabChatHome } from "./test-utils"

const gatewayMocks = vi.hoisted(() => {
  class MockAppError extends Error {
    status: number
    code?: string

    constructor(message: string, status = 500, code?: string) {
      super(message)
      this.status = status
      this.code = code
    }
  }

  return {
    AppError: MockAppError,
  }
})

vi.mock("@/lib/openclaw-gateway", () => gatewayMocks)

describe("crabchat notes", () => {
  const getHome = useTempCrabChatHome()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("stores notes as parseable files sorted by update date", () => {
    const first = saveNote({
      title: "example.name",
      agentId: "test.agent",
      content: "Alpha",
      kind: "note",
    })
    expect("note" in first && first.note.fileName).toBe("example_._name_._.test_._agent.txt")

    const second = saveNote({
      title: "",
      content: "Draft",
      kind: "prompt",
    })
    expect("note" in second && second.note.fileName).toBe("untitled..prompt")

    const notes = listNotes().notes
    expect(notes.map((note) => note.content)).toContain("Alpha")
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "example.name",
          displayTitle: "example.name",
          agentId: "test.agent",
          kind: "note",
        }),
        expect.objectContaining({
          title: "",
          displayTitle: "untitled",
          agentId: undefined,
          kind: "prompt",
        }),
      ])
    )
  })

  it("detects external edits before overwriting a note", () => {
    const saved = saveNote({ title: "conflict", content: "Original", kind: "note" })
    expect("note" in saved).toBe(true)
    if (!("note" in saved)) throw new Error("Expected saved note")

    const path = join(getCrabChatPaths().notes, saved.note.fileName)
    writeFileSync(path, "External")

    const conflict = saveNote({
      fileName: saved.note.fileName,
      title: saved.note.title,
      content: "Local",
      kind: "note",
      baseContent: saved.note.content,
      baseUpdatedAt: saved.note.updatedAt,
    })

    expect(conflict).toMatchObject({
      conflict: true,
      note: {
        content: "External",
      },
    })

    const overwritten = saveNote({
      fileName: saved.note.fileName,
      title: saved.note.title,
      content: "Local",
      kind: "note",
      conflictResolution: "overwrite",
    })

    expect("note" in overwritten && overwritten.note.content).toBe("Local")
  })

  it("uses parseable numeric title suffixes for duplicate note names", () => {
    const firstUntitled = saveNote({ title: "", content: "First", kind: "note" })
    const secondUntitled = saveNote({ title: "", content: "Second", kind: "note" })
    const firstNamed = saveNote({ title: "same.name", content: "Named 1", kind: "note" })
    const secondNamed = saveNote({ title: "same.name", content: "Named 2", kind: "note" })

    expect("note" in firstUntitled && firstUntitled.note.fileName).toBe("untitled..txt")
    expect("note" in secondUntitled && secondUntitled.note.fileName).toBe("untitled1..txt")
    expect("note" in firstNamed && firstNamed.note.fileName).toBe("same_._name..txt")
    expect("note" in secondNamed && secondNamed.note.fileName).toBe("same_._name1..txt")

    expect(listNotes().notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: "untitled1..txt", displayTitle: "untitled1" }),
        expect.objectContaining({ fileName: "same_._name1..txt", title: "same.name1" }),
      ])
    )
  })

  it("validates custom storage paths and migrates existing notes", () => {
    const saved = saveNote({ title: "move me", content: "Body", kind: "note" })
    expect("note" in saved).toBe(true)
    if (!("note" in saved)) throw new Error("Expected saved note")

    const target = join(getHome(), "custom-notes")
    expect(validateNotesStoragePath(target)).toMatchObject({ ok: true })
    updateCrabChatState({
      features: {
        ...getCrabChatState().features,
        notes: {
          ...getCrabChatState().features.notes,
          storagePath: target,
        },
      },
    })

    expect(existsSync(join(target, saved.note.fileName))).toBe(true)
    expect(readFileSync(join(target, saved.note.fileName), "utf8")).toBe("Body")
    expect(
      existsSync(getCrabChatPaths().notes) ? readdirSync(getCrabChatPaths().notes) : []
    ).toEqual([])
  })

  it("removes notes from the configured directory", () => {
    const target = join(getHome(), "notes-target")
    mkdirSync(target)
    updateCrabChatState({
      features: {
        ...getCrabChatState().features,
        notes: {
          ...getCrabChatState().features.notes,
          storagePath: target,
        },
      },
    })
    const saved = saveNote(
      { title: "remove", content: "unused", kind: "note" },
      getCrabChatState().features
    )
    expect("note" in saved).toBe(true)
    if (!("note" in saved)) throw new Error("Expected saved note")

    expect(existsSync(join(target, saved.note.fileName))).toBe(true)
    deleteNote(saved.note.fileName, getCrabChatState().features)
    expect(existsSync(join(target, saved.note.fileName))).toBe(false)
  })
})
