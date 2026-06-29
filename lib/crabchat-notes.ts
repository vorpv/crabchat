import {
  accessSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { constants } from "node:fs"
import { getCrabChatPaths } from "@/lib/crabchat-home"
import { AppError } from "@/lib/openclaw-gateway"
import type { CrabChatFeatures, CrabChatNote, CrabChatNotesList } from "@/lib/types"

export const UNTITLED_NOTE_TITLE = "untitled"

const NOTE_EXTENSIONS = [".txt", ".prompt"] as const
const TITLE_AGENT_SEPARATOR = "_._."

type NoteExtension = (typeof NOTE_EXTENSIONS)[number]

export interface NoteSaveInput {
  fileName?: string
  title?: string
  agentId?: string
  content: string
  kind?: "note" | "prompt"
  baseContent?: string
  baseUpdatedAt?: string
  conflictResolution?: "load" | "overwrite" | "separate"
}

function notesFeature(features?: Partial<CrabChatFeatures>) {
  return {
    enabled: features?.notes?.enabled !== false,
    autoSavePrompts: features?.notes?.autoSavePrompts !== false,
    manualPromptSaving: features?.notes?.manualPromptSaving === true,
    useMonospaceFont: features?.notes?.useMonospaceFont === true,
    storagePath: features?.notes?.storagePath || "",
  }
}

export function getNotesDirectory(features?: Partial<CrabChatFeatures>) {
  const configured = notesFeature(features).storagePath.trim()
  return configured ? resolve(configured) : getCrabChatPaths().notes
}

export function validateNotesStoragePath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, path: getCrabChatPaths().notes }
  if (!isAbsolute(trimmed)) {
    return { ok: false, path: trimmed, error: "Use an absolute folder path." }
  }

  const target = resolve(trimmed)
  try {
    if (existsSync(target)) {
      const stats = statSync(target)
      if (!stats.isDirectory()) {
        return { ok: false, path: target, error: "Path exists but is not a folder." }
      }
      accessSync(target, constants.R_OK | constants.W_OK)
      return { ok: true, path: target }
    }

    const parent = dirname(target)
    if (!existsSync(parent)) {
      return { ok: false, path: target, error: "Parent folder does not exist." }
    }
    const parentStats = statSync(parent)
    if (!parentStats.isDirectory()) {
      return { ok: false, path: target, error: "Parent path is not a folder." }
    }
    accessSync(parent, constants.R_OK | constants.W_OK)
    return { ok: true, path: target }
  } catch (error) {
    return {
      ok: false,
      path: target,
      error: error instanceof Error ? error.message : "Path is not readable and writable.",
    }
  }
}

export function migrateNotesDirectory(
  previousFeatures: CrabChatFeatures,
  nextFeatures: CrabChatFeatures
) {
  const previous = getNotesDirectory(previousFeatures)
  const next = getNotesDirectory(nextFeatures)
  if (previous === next || !existsSync(previous)) return

  const files = listNoteFiles(previous)
  if (files.length === 0) return

  const validation = validateNotesStoragePath(next)
  if (!validation.ok) {
    throw new AppError(validation.error || "Notes storage path is invalid.", 400, "INVALID_REQUEST")
  }

  mkdirSync(next, { recursive: true })
  for (const file of files) {
    const target = uniqueFilePath(next, file)
    renameSync(join(previous, file), target)
  }

  try {
    if (readdirSync(previous).length === 0) {
      rmdirSync(previous)
    }
  } catch {
    // A non-empty or concurrently touched old directory can remain safely.
  }
}

function listNoteFiles(directory: string) {
  if (!existsSync(directory)) return []
  return readdirSync(directory).filter((file) =>
    NOTE_EXTENSIONS.some((extension) => file.endsWith(extension))
  )
}

function encodePart(value: string) {
  return value.replace(/\./g, "_._").replace(/[\\/:\0]/g, "_").trim() || UNTITLED_NOTE_TITLE
}

function decodePart(value: string) {
  return value.replace(/_\._/g, ".")
}

function extensionForKind(kind: "note" | "prompt"): NoteExtension {
  return kind === "prompt" ? ".prompt" : ".txt"
}

function splitName(fileName: string) {
  const extension = NOTE_EXTENSIONS.find((item) => fileName.endsWith(item))
  if (!extension) return undefined

  const stem = fileName.slice(0, -extension.length)
  let encodedTitle = stem
  let encodedAgent = ""
  const separatorIndex = stem.lastIndexOf(TITLE_AGENT_SEPARATOR)
  if (separatorIndex >= 0) {
    encodedTitle = stem.slice(0, separatorIndex)
    encodedAgent = stem.slice(separatorIndex + TITLE_AGENT_SEPARATOR.length)
  } else if (stem.endsWith(".")) {
    encodedTitle = stem.slice(0, -1)
  }

  const title = decodePart(encodedTitle) || UNTITLED_NOTE_TITLE
  const agentId = encodedAgent ? decodePart(encodedAgent) : undefined
  return {
    title,
    agentId,
    kind: extension === ".prompt" ? "prompt" as const : "note" as const,
  }
}

function fileNameFor(title: string | undefined, agentId: string | undefined, kind: "note" | "prompt") {
  const encodedTitle = encodePart(title?.trim() || UNTITLED_NOTE_TITLE)
  const extension = extensionForKind(kind)
  if (!agentId) return `${encodedTitle}.${extension}`
  return `${encodedTitle}${TITLE_AGENT_SEPARATOR}${encodePart(agentId)}${extension}`
}

function uniqueFilePath(directory: string, preferredFileName: string) {
  const parsed = splitName(preferredFileName)
  let candidate = join(directory, preferredFileName)
  if (!parsed) return candidate

  let index = 1
  while (existsSync(candidate)) {
    candidate = join(
      directory,
      fileNameFor(`${parsed.title}${index}`, parsed.agentId, parsed.kind)
    )
    index += 1
  }
  return candidate
}

function fileToNote(directory: string, fileName: string): CrabChatNote | undefined {
  const parsed = splitName(fileName)
  if (!parsed) return undefined
  const path = join(directory, fileName)
  const stats = statSync(path)
  const content = readFileSync(path, "utf8")
  return {
    fileName,
    title: parsed.title === UNTITLED_NOTE_TITLE ? "" : parsed.title,
    displayTitle: parsed.title === UNTITLED_NOTE_TITLE ? UNTITLED_NOTE_TITLE : parsed.title,
    agentId: parsed.agentId,
    content,
    kind: parsed.kind,
    updatedAt: stats.mtime.toISOString(),
  }
}

export function listNotes(features?: Partial<CrabChatFeatures>): CrabChatNotesList {
  const directory = getNotesDirectory(features)
  const notes = listNoteFiles(directory)
    .map((file) => fileToNote(directory, file))
    .filter((note): note is CrabChatNote => Boolean(note))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  return { notes, storagePath: directory }
}

export function readNote(fileName: string, features?: Partial<CrabChatFeatures>) {
  const directory = getNotesDirectory(features)
  const note = fileToNote(directory, fileName)
  if (!note) throw new AppError("Note not found.", 404, "NOT_FOUND")
  return note
}

export function saveNote(input: NoteSaveInput, features?: Partial<CrabChatFeatures>) {
  const directory = getNotesDirectory(features)
  const kind = input.kind || "note"
  const title = input.title?.trim() || UNTITLED_NOTE_TITLE
  const nextFileName = fileNameFor(title, input.agentId, kind)
  const existingFileName = input.fileName
  const existingPath = existingFileName ? join(directory, existingFileName) : undefined
  mkdirSync(directory, { recursive: true })

  const preferredPath = join(directory, nextFileName)
  const targetPath =
    input.conflictResolution === "separate" ||
    ((!existingPath || existingPath !== preferredPath) && existsSync(preferredPath))
      ? uniqueFilePath(directory, nextFileName)
      : preferredPath

  if (
    existingPath &&
    existsSync(existingPath) &&
    input.conflictResolution !== "overwrite" &&
    input.conflictResolution !== "separate"
  ) {
    const diskContent = readFileSync(existingPath, "utf8")
    const diskUpdatedAt = statSync(existingPath).mtime.toISOString()
    const contentChanged = input.baseContent !== undefined && input.baseContent !== diskContent
    const timeChanged = input.baseUpdatedAt !== undefined && input.baseUpdatedAt !== diskUpdatedAt
    if (contentChanged || timeChanged) {
      if (!existingFileName) throw new AppError("Note not found.", 404, "NOT_FOUND")
      return {
        conflict: true as const,
        note: fileToNote(directory, existingFileName)!,
      }
    }
  }

  writeFileSync(targetPath, input.content)
  if (existingPath && existingPath !== targetPath && existsSync(existingPath)) {
    unlinkSync(existingPath)
  }
  return { note: fileToNote(directory, targetPath.split("/").pop()!)! }
}

export function deleteNote(fileName: string, features?: Partial<CrabChatFeatures>) {
  const directory = getNotesDirectory(features)
  const path = join(directory, fileName)
  if (existsSync(path)) unlinkSync(path)
  return { ok: true }
}
